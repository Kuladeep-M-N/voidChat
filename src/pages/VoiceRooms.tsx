import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface VoiceRoom { id: string; name: string; created_at: string; }
interface Participant { userId: string; username: string; speaking: boolean; muted: boolean; }

// STUN-only fallback (used if Edge Function is unavailable)
const STUN_FALLBACK = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// Fetch production TURN + STUN credentials from Supabase Edge Function
async function getIceServers(): Promise<RTCIceServer[]> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-ice-servers`,
      {
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ''}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      }
    );
    if (!res.ok) throw new Error('ICE fetch failed');
    return await res.json();
  } catch {
    console.warn('Falling back to STUN-only ICE servers');
    return STUN_FALLBACK;
  }
}

// Detect if a stream is currently producing audio above a threshold
function useSpeakingDetector(stream: MediaStream | null): boolean {
  const [speaking, setSpeaking] = useState(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (!stream) { setSpeaking(false); return; }
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const check = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setSpeaking(avg > 8);
      animRef.current = requestAnimationFrame(check);
    };
    check();

    return () => {
      cancelAnimationFrame(animRef.current);
      src.disconnect();
      ctx.close();
    };
  }, [stream]);

  return speaking;
}

export default function VoiceRooms() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  // Room list state
  const [rooms, setRooms] = useState<VoiceRoom[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Active room state
  const [activeRoom, setActiveRoom] = useState<VoiceRoom | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [muted, setMuted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // WebRTC refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const remoteAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Detect if we're speaking
  const isSpeaking = useSpeakingDetector(localStreamRef.current);

  useEffect(() => {
    if (!loading && !user) navigate('/join');
  }, [user, loading, navigate]);

  // Load rooms list + realtime inserts
  useEffect(() => {
    if (!user) return;
    supabase.from('voice_rooms').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setRooms(data); });

    const ch = supabase.channel('voice-rooms-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'voice_rooms' }, (p) => {
        setRooms(prev => [p.new as VoiceRoom, ...prev]);
      }).subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [user]);

  // Keep own speaking status synced into participants list
  useEffect(() => {
    if (!user) return;
    setParticipants(prev => prev.map(p =>
      p.userId === user.id ? { ...p, speaking: isSpeaking, muted } : p
    ));
    // Broadcast mute state change
    channelRef.current?.send({
      type: 'broadcast', event: 'status',
      payload: { userId: user.id, muted, speaking: isSpeaking },
    });
  }, [isSpeaking, muted, user]);

  // ── Create a new RTCPeerConnection for a remote peer ──
  const createPeer = useCallback(async (remoteUserId: string, isInitiator: boolean) => {
    const existing = peersRef.current.get(remoteUserId);
    if (existing) return existing;

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });

    // Add local mic tracks
    localStreamRef.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!);
    });

    // Play remote audio
    pc.ontrack = ({ streams }) => {
      const audio = new Audio();
      audio.srcObject = streams[0];
      audio.autoplay = true;
      remoteAudiosRef.current.set(remoteUserId, audio);
    };

    // Send ICE candidates via Supabase broadcast
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        channelRef.current?.send({
          type: 'broadcast', event: 'ice-candidate',
          payload: { from: user!.id, to: remoteUserId, candidate },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        pc.close();
        peersRef.current.delete(remoteUserId);
        remoteAudiosRef.current.get(remoteUserId)?.remove();
        remoteAudiosRef.current.delete(remoteUserId);
        setParticipants(prev => prev.filter(p => p.userId !== remoteUserId));
      }
    };

    peersRef.current.set(remoteUserId, pc);

    // Initiator creates the offer
    if (isInitiator) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        channelRef.current?.send({
          type: 'broadcast', event: 'offer',
          payload: { from: user!.id, to: remoteUserId, offer },
        });
      });
    }

    return pc;
  }, [user]);

  // ── Join a voice room ──
  const joinRoom = useCallback(async (room: VoiceRoom) => {
    setJoining(true);
    setMicError(null);

    // Request microphone
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err: any) {
      setMicError(err.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow mic access in your browser.'
        : 'Could not access microphone. Make sure one is connected.');
      setJoining(false);
      return;
    }

    localStreamRef.current = stream;
    setActiveRoom(room);
    setJoining(false);

    // Subscribe to signaling channel
    const ch = supabase.channel(`voice:${room.id}`, {
      config: { presence: { key: user!.id } },
    });
    channelRef.current = ch;

    // ── Presence: who's in the room ──
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ username: string; muted: boolean }>();
      const users = Object.entries(state).map(([userId, data]) => {
        const info = (data[0] as any);
        return {
          userId,
          username: info.username,
          speaking: false,
          muted: info.muted ?? false,
        };
      });
      setParticipants(users);

      // Initiate WebRTC with peers who joined before us
      users.forEach(p => {
        if (p.userId !== user!.id && !peersRef.current.has(p.userId)) {
          createPeer(p.userId, true); // async — intentionally not awaited in forEach
        }
      });
    });

    ch.on('presence', { event: 'join' }, ({ key, newPresences }) => {
      const info = (newPresences[0] as any);
      setParticipants(prev => {
        if (prev.find(p => p.userId === key)) return prev;
        return [...prev, { userId: key, username: info.username, speaking: false, muted: info.muted ?? false }];
      });
    });

    ch.on('presence', { event: 'leave' }, ({ key }) => {
      peersRef.current.get(key)?.close();
      peersRef.current.delete(key);
      remoteAudiosRef.current.get(key)?.remove();
      remoteAudiosRef.current.delete(key);
      setParticipants(prev => prev.filter(p => p.userId !== key));
    });

    // ── WebRTC Signaling ──
    ch.on('broadcast', { event: 'offer' }, async ({ payload }) => {
      if (payload.to !== user!.id) return;
      const pc = await createPeer(payload.from, false);
      await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ch.send({
        type: 'broadcast', event: 'answer',
        payload: { from: user!.id, to: payload.from, answer },
      });
    });

    ch.on('broadcast', { event: 'answer' }, async ({ payload }) => {
      if (payload.to !== user!.id) return;
      const pc = peersRef.current.get(payload.from);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
    });

    ch.on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
      if (payload.to !== user!.id) return;
      const pc = peersRef.current.get(payload.from);
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    });

    // ── Remote mute/speaking status ──
    ch.on('broadcast', { event: 'status' }, ({ payload }) => {
      setParticipants(prev => prev.map(p =>
        p.userId === payload.userId
          ? { ...p, speaking: payload.speaking, muted: payload.muted }
          : p
      ));
    });

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ username: profile?.anonymous_username ?? 'Anonymous', muted: false });
      }
    });
  }, [user, profile, createPeer]);

  // ── Leave room ──
  const leaveRoom = useCallback(() => {
    // Stop mic
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;

    // Close all peer connections
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();

    // Remove audio elements
    remoteAudiosRef.current.forEach(a => a.remove());
    remoteAudiosRef.current.clear();

    // Unsubscribe signaling channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    setActiveRoom(null);
    setParticipants([]);
    setMuted(false);
    setMicError(null);
  }, []);

  // Clean up on unmount
  useEffect(() => () => { leaveRoom(); }, [leaveRoom]);

  // ── Mute toggle ──
  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = muted; // if currently muted, re-enable
    }
    setMuted(m => !m);
  }, [muted]);

  const createRoom = async () => {
    const name = newName.trim();
    if (!name || !user) return;
    setCreating(true);
    const { data } = await supabase.from('voice_rooms').insert({ name, created_by: user.id }).select().single();
    if (data) joinRoom(data as VoiceRoom);
    setNewName(''); setShowCreate(false); setCreating(false);
  };

  // ─────────────────────────── ACTIVE ROOM UI ───────────────────────────
  if (activeRoom) {
    const me = participants.find(p => p.userId === user?.id);
    return (
      <div className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center bg-[#07070f]">
        {/* Ambient glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 50%, rgba(16,185,129,0.1) 0%, transparent 70%)' }} />

        <motion.div className="relative z-10 w-full max-w-2xl px-4"
          initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}>

          {/* Room header */}
          <div className="text-center mb-10">
            <motion.div className="text-5xl mb-3"
              animate={{ scale: isSpeaking ? [1, 1.15, 1] : 1 }}
              transition={{ duration: 0.3, repeat: isSpeaking ? Infinity : 0 }}>
              🎙️
            </motion.div>
            <h1 className="text-2xl font-bold text-white">{activeRoom.name}</h1>
            <p className="text-sm text-emerald-400 mt-1">{participants.length} participant{participants.length !== 1 ? 's' : ''} · Live</p>
          </div>

          {/* Participants grid */}
          <div className="flex flex-wrap justify-center gap-6 mb-10">
            {participants.map(p => {
              const isMe = p.userId === user?.id;
              const actualSpeaking = isMe ? isSpeaking : p.speaking;
              return (
                <motion.div key={p.userId} className="flex flex-col items-center gap-2"
                  initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
                  {/* Avatar with speaking ring */}
                  <div className="relative">
                    {/* Speaking pulse ring */}
                    {actualSpeaking && !p.muted && (
                      <>
                        <motion.div className="absolute inset-0 rounded-full border-2 border-emerald-400"
                          animate={{ scale: [1, 1.4, 1], opacity: [0.8, 0, 0.8] }}
                          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }} />
                        <motion.div className="absolute inset-0 rounded-full border-2 border-emerald-300"
                          animate={{ scale: [1, 1.7, 1], opacity: [0.5, 0, 0.5] }}
                          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }} />
                      </>
                    )}
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold text-white border-2 transition-all ${
                      actualSpeaking && !p.muted
                        ? 'border-emerald-400 bg-gradient-to-br from-emerald-500/40 to-green-600/40'
                        : 'border-white/10 bg-gradient-to-br from-slate-600/30 to-slate-700/30'
                    }`}>
                      {p.username.slice(0, 2).toUpperCase()}
                    </div>
                    {/* Muted icon */}
                    {p.muted && (
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-red-500 border border-[#07070f] flex items-center justify-center text-[10px]">
                        🔇
                      </div>
                    )}
                    {/* Online indicator */}
                    {!p.muted && (
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-[#07070f]" />
                    )}
                  </div>
                  <span className="text-xs text-slate-300 font-medium max-w-[80px] truncate text-center">
                    {isMe ? `${p.username} (you)` : p.username}
                  </span>
                  {actualSpeaking && !p.muted && (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>●</motion.span>
                      speaking
                    </span>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Controls */}
          <div className="flex justify-center gap-4">
            {/* Mute toggle */}
            <motion.button
              onClick={toggleMute}
              className={`w-16 h-16 rounded-full text-2xl border-2 transition-all flex items-center justify-center ${
                muted
                  ? 'bg-red-500/20 border-red-500/60 text-red-400'
                  : 'bg-white/10 border-white/20 text-white hover:bg-white/15'
              }`}
              whileTap={{ scale: 0.9 }}
              title={muted ? 'Unmute' : 'Mute'}>
              {muted ? '🔇' : '🎙️'}
            </motion.button>

            {/* Leave */}
            <motion.button
              onClick={leaveRoom}
              className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 text-white text-2xl border-2 border-red-500/50 transition-all flex items-center justify-center"
              whileTap={{ scale: 0.9 }}
              title="Leave room">
              📵
            </motion.button>
          </div>

          <p className="text-center text-xs text-slate-600 mt-8">
            🔒 End-to-end encrypted · Anonymous · WebRTC
          </p>
        </motion.div>
      </div>
    );
  }

  // ─────────────────────────── ROOM LIST UI ───────────────────────────
  return (
    <div className="min-h-screen relative overflow-hidden bg-[#07070f]">
      <div className="ambient-blob w-[500px] h-[500px] bg-green-600/10 top-[-100px] right-[10%]" />

      <header className="relative z-10 border-b border-white/5 glass sticky top-0">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex items-center gap-4">
            <Link to="/dashboard"><button className="btn-ghost rounded-xl p-2 text-slate-400">← Back</button></Link>
            <div>
              <h1 className="font-semibold text-white">🎙️ Voice Rooms</h1>
              <p className="text-xs text-slate-500">Real-time anonymous voice chat</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary !w-auto px-4 py-2 rounded-xl text-sm">
            + New Room
          </button>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-4 py-8">
        {/* Mic error banner */}
        {micError && (
          <motion.div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-2xl px-5 py-4 flex items-center gap-3"
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            🎤 {micError}
          </motion.div>
        )}

        {joining && (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Connecting to room...</p>
          </div>
        )}

        {!joining && rooms.length === 0 ? (
          <div className="text-center py-24">
            <motion.div className="text-6xl mb-4 opacity-40"
              animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 2.5, repeat: Infinity }}>
              🎙️
            </motion.div>
            <p className="font-medium text-slate-400 text-lg mb-1">No voice rooms yet</p>
            <p className="text-sm text-slate-500">Create one to start talking</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {rooms.map((room, i) => (
                <motion.div key={room.id}
                  className="glass-hover rounded-2xl p-6 cursor-pointer border border-green-500/10 hover:border-green-500/30 group"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => joinRoom(room)}>
                  {/* Animated mic icon */}
                  <div className="relative w-12 h-12 rounded-xl bg-green-500/20 border border-green-500/30 flex items-center justify-center text-2xl mb-4 group-hover:bg-green-500/30 transition-all">
                    🎙️
                    <motion.span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500"
                      animate={{ opacity: [1, 0.3, 1], scale: [1, 1.3, 1] }}
                      transition={{ duration: 2, repeat: Infinity }} />
                  </div>
                  <h3 className="font-semibold text-white text-base mb-1">{room.name}</h3>
                  <p className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                    Live · Tap to join
                  </p>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Create Room Modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}>
            <motion.div className="glass border border-white/10 rounded-3xl p-8 w-full max-w-md"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
              <h2 className="text-xl font-semibold text-white mb-2">Create Voice Room</h2>
              <p className="text-sm text-slate-500 mb-6">Your mic will be requested when you join</p>
              <input type="text" className="input-field mb-4" placeholder="Room name..."
                value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createRoom()}
                autoFocus maxLength={40} />
              <div className="flex gap-3">
                <button onClick={createRoom} className="btn-primary rounded-xl" disabled={creating || !newName.trim()}>
                  {creating ? 'Creating...' : '🎙️ Create & Join'}
                </button>
                <button onClick={() => setShowCreate(false)}
                  className="btn-ghost rounded-xl px-4 py-2 border border-white/10">
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
