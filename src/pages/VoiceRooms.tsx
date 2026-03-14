import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Archive } from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs,
  serverTimestamp 
} from 'firebase/firestore';
import { 
  ref, 
  onValue, 
  set, 
  push, 
  onChildAdded, 
  remove, 
  off, 
  update, 
  onDisconnect 
} from 'firebase/database';
import { db, rtdb } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';

interface VoiceRoom {
  id: string;
  name: string;
  created_at: any;
  created_by: string;
  status?: 'active' | 'ended';
  ended_at?: any;
  creator_name?: string;
}

type Role = 'speaker' | 'audience';

interface Participant {
  userId: string;
  username: string;
  speaking: boolean;
  muted: boolean;
  role: Role;
  handRaised: boolean;
}

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  isSystem?: boolean;
}

const STUN_FALLBACK = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

async function getIceServers(): Promise<RTCIceServer[]> {
  // Logic for Firebase functions will be added in next phase
  // Falling back to STUN for now
  return STUN_FALLBACK;
}

function useSpeakingDetector(stream: MediaStream | null): boolean {
  const [speaking, setSpeaking] = useState(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (!stream) { setSpeaking(false); return; }
    const ctx = new window.AudioContext();
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
  const location = useLocation();
  const isVoiceRoute = location.pathname === '/voice';

  // Room list state
  const [rooms, setRooms] = useState<VoiceRoom[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Active room state
  const [activeRoom, setActiveRoom] = useState<VoiceRoom | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [myRole, setMyRole] = useState<Role>('audience');
  const [muted, setMuted] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // WebRTC refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const joiningRef = useRef<boolean>(false);

  const isSpeaking = useSpeakingDetector(localStreamRef.current);

  // Load rooms
  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, 'voice_rooms'), orderBy('created_at', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: VoiceRoom[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as VoiceRoom);
      });
      setRooms(items);
    });

    return () => unsubscribe();
  }, [user]);

  // Signaling and Presence via RTDB
  useEffect(() => {
    if (!user || !activeRoom) return;

    const roomId = activeRoom.id;
    const presenceRef = ref(rtdb, `presence/${roomId}/${user.uid}`);
    const signalingInRef = ref(rtdb, `signaling/${roomId}/${user.uid}`);

    // Update presence
    set(presenceRef, {
      username: profile?.anonymous_username ?? 'Anonymous',
      muted,
      role: myRole,
      handRaised,
      speaking: isSpeaking
    });
    onDisconnect(presenceRef).remove();

    // Listen to signaling
    const signalingUnsubscribe = onChildAdded(signalingInRef, async (snapshot) => {
      const { from, type, data } = snapshot.val();
      await remove(snapshot.ref); // Consume signal

      if (type === 'offer') {
        const pc = await createPeer(from, false);
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        const outRef = ref(rtdb, `signaling/${roomId}/${from}`);
        push(outRef, { from: user.uid, type: 'answer', data: answer });
      } else if (type === 'answer') {
        const pc = peersRef.current.get(from);
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data));
      } else if (type === 'candidate') {
        const pc = peersRef.current.get(from);
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });

    // Listen to participants
    const participantsRef = ref(rtdb, `presence/${roomId}`);
    const participantsUnsubscribe = onValue(participantsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const users: Participant[] = Object.entries(data).map(([uid, info]: [string, any]) => ({
        userId: uid,
        username: info.username,
        speaking: info.speaking,
        muted: info.muted,
        role: info.role,
        handRaised: info.handRaised
      }));
      setParticipants(users);

      // Create peers for new participants
      users.forEach(p => {
        if (p.userId !== user.uid && !peersRef.current.has(p.userId)) {
          createPeer(p.userId, true);
        }
      });
    });

    // Listen to chat
    const chatRef = ref(rtdb, `chat/${roomId}`);
    const chatUnsubscribe = onChildAdded(chatRef, (snapshot) => {
      setChatMessages(prev => [...prev, snapshot.val()]);
    });

    return () => {
      remove(presenceRef);
      off(signalingInRef);
      off(participantsRef);
      off(chatRef);
    };
  }, [user, activeRoom, muted, myRole, handRaised, isSpeaking]);

  // Create Peer Connection
  const createPeer = useCallback(async (remoteUserId: string, isInitiator: boolean) => {
    const existing = peersRef.current.get(remoteUserId);
    if (existing) return existing;

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    pc.ontrack = ({ streams }) => {
      let audio = remoteAudiosRef.current.get(remoteUserId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        remoteAudiosRef.current.set(remoteUserId, audio);
      }
      if (audio.srcObject !== streams[0]) {
        audio.srcObject = streams[0];
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && activeRoom) {
        const outRef = ref(rtdb, `signaling/${activeRoom.id}/${remoteUserId}`);
        push(outRef, { from: user!.uid, type: 'candidate', data: candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        pc.close();
        peersRef.current.delete(remoteUserId);
        remoteAudiosRef.current.get(remoteUserId)?.remove();
        remoteAudiosRef.current.delete(remoteUserId);
      }
    };

    peersRef.current.set(remoteUserId, pc);

    if (isInitiator && activeRoom) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const outRef = ref(rtdb, `signaling/${activeRoom.id}/${remoteUserId}`);
      push(outRef, { from: user!.uid, type: 'offer', data: offer });
    }

    return pc;
  }, [user, activeRoom]);

  const leaveRoom = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    remoteAudiosRef.current.forEach(a => a.remove());
    remoteAudiosRef.current.clear();
    setActiveRoom(null); setParticipants([]); setChatMessages([]); setHandRaised(false);
  }, []);

  const joinRoom = useCallback(async (room: VoiceRoom) => {
    if (joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true); setErrorMsg(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
      localStreamRef.current = stream;
      setMyRole('speaker');
      setMuted(true);
      setActiveRoom(room);
      setChatMessages([{ id: '1', userId: 'sys', username: 'System', text: `Connected to ${room.name}.`, isSystem: true }]);
    } catch (err) {
      console.warn('Microphone access denied, joining as listener only.');
      setMyRole('audience');
      setMuted(true);
      setActiveRoom(room);
    } finally {
      setJoining(false);
      joiningRef.current = false;
    }
  }, []);

  useEffect(() => () => { leaveRoom(); }, [leaveRoom]);

  const createRoom = async () => {
    const name = newName.trim();
    if (!name || !user) return;
    setCreating(true);
    try {
      const docRef = await addDoc(collection(db, 'voice_rooms'), {
        name,
        created_by: user.uid,
        status: 'active',
        created_at: serverTimestamp(),
        creator_name: profile?.anonymous_username || 'Anonymous'
      });
      const room = { id: docRef.id, name, created_by: user.uid, created_at: new Date() };
      joinRoom(room as VoiceRoom);
    } catch (err) {
      console.error('Create room error:', err);
    } finally {
      setNewName(''); setShowCreate(false); setCreating(false);
    }
  };

  const endRoom = async () => {
    if (!activeRoom) return;
    const roomId = activeRoom.id;
    try {
      await updateDoc(doc(db, 'voice_rooms', roomId), {
        status: 'ended',
        ended_at: serverTimestamp()
      });
      leaveRoom();
    } catch (err) {
      console.error('End room error:', err);
      // Fallback: delete if update fails
      await deleteDoc(doc(db, 'voice_rooms', roomId));
      leaveRoom();
    }
  };

  const sendChat = () => {
    if (!chatInput.trim() || !activeRoom) return;
    const chatRef = ref(rtdb, `chat/${activeRoom.id}`);
    const msg: ChatMessage = { 
      id: Date.now().toString(), 
      userId: user!.uid, 
      username: profile?.anonymous_username ?? 'Anon', 
      text: chatInput.trim() 
    };
    push(chatRef, msg);
    setChatInput('');
  };

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) track.enabled = muted;
    setMuted(m => !m);
  }, [muted]);



  // ─────────────────────────── ACTIVE ROOM UI ───────────────────────────
  // ─────────────────────────── RENDER LOGIC ───────────────────────────
  if (!user) return null;

  if (!isVoiceRoute && activeRoom) {
    // Minimized Widget
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="bg-[#111128]/90 backdrop-blur-xl border border-white/10 p-4 rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] flex items-center gap-4 w-72">
          {/* Audio Visualization / Status */}
          <div className="w-10 h-10 rounded-full bg-violet-500/10 flex items-center justify-center relative overflow-hidden shrink-0 border border-violet-500/20">
            {isSpeaking && !muted && (
              <div className="absolute inset-0 bg-violet-500/30 animate-pulse" />
            )}
            <span className="text-xl relative z-10">🎙️</span>
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-white font-bold text-sm truncate">{activeRoom.name}</h4>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-400 text-[9px] font-black uppercase tracking-widest break-normal">{participants.length} Active</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button onClick={toggleMute} className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition ${muted ? 'bg-red-500/20 text-red-500' : 'bg-white/10 text-white hover:bg-white/20'}`}>
              {muted ? '🔇' : '🎙️'}
            </button>
            <button onClick={() => navigate('/voice')} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition" title="Expand">
              ↗
            </button>
            <button onClick={leaveRoom} className="w-8 h-8 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500 flex items-center justify-center transition" title="Leave">
              ✕
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If we're on the Voice Route
  if (isVoiceRoute && activeRoom) {
    const stageUsers = participants.filter(p => p.role === 'speaker');
    const audienceUsers = participants.filter(p => p.role === 'audience');

    // Always ensure at least 8 slots visually on stage
    const stageSlots = Array.from({ length: 8 }).map((_, i) => stageUsers[i] || null);

    return (
      <div className="h-[100dvh] flex flex-col bg-[#14142b] overflow-hidden">
        {/* Top Header */}
        <div className="glass shrink-0 px-6 py-4 flex items-center justify-between z-20 border-b border-white/5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/dashboard')} title="Minimize" className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/5 hover:bg-white/10 text-white transition-all border border-white/5">
              ─
            </button>
            <button onClick={leaveRoom} title="Leave Group" className="w-10 h-10 flex items-center justify-center rounded-2xl bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-all border border-red-500/20">
              ✕
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-white font-bold text-lg leading-tight">{activeRoom.name}</h1>
                {profile?.is_admin && <span className="text-[10px] font-black bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full border border-red-500/20">ADMIN</span>}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-emerald-400 text-[9px] font-black uppercase tracking-widest">Live Open Lounge</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-white/5 px-4 py-2 rounded-2xl border border-white/5 flex items-center gap-2">
              <span className="text-violet-400 font-bold text-sm">{participants.length}</span>
              <span className="text-white/30 text-[9px] font-black uppercase tracking-widest">Online</span>
            </div>
            {(user?.uid === activeRoom.created_by || profile?.is_admin) && (
              <button
                onClick={() => { if (confirm('End this room for everyone?')) endRoom(); }}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-red-500/20"
              >
                End Session
              </button>
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-h-0 relative">
          {/* Participant Grid Section (Fixed Height or Scrollable if too large) */}
          <div className="shrink-0 max-h-[45vh] overflow-y-auto px-6 py-4 custom-scrollbar bg-black/10">
            <div className="max-w-xl mx-auto">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-4 gap-y-8 gap-x-6 py-4">
                {participants.map((p) => {
                  const isMe = p.userId === user?.uid;
                  return (
                    <motion.div key={p.userId}
                      className="flex flex-col items-center gap-2 relative"
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                      <div className="relative">
                        <div className={`w-16 h-16 rounded-3xl flex items-center justify-center text-xl font-bold text-white border-2 transition-all duration-300 shadow-lg ${p.speaking && !p.muted ? 'border-violet-500 bg-violet-500/10 shadow-[0_0_20px_rgba(139,92,246,0.5)] scale-110' : 'border-white/5 bg-white/5'
                          }`}>
                          {p.username.slice(0, 2).toUpperCase()}
                        </div>
                        {p.muted && (
                          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#14142b] border border-white/10 rounded-lg flex items-center justify-center text-[10px] shadow-lg">
                            🔇
                          </div>
                        )}
                      </div>
                      <span className={`text-[10px] font-bold truncate w-16 text-center transition-colors ${p.speaking && !p.muted ? 'text-violet-400' : 'text-white/40'}`}>
                        {isMe ? 'You' : p.username}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Chat Messages Section (Takes remaining space and scrolls) */}
          <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar" ref={chatScrollRef}>
            <div className="max-w-xl mx-auto space-y-3">
              {chatMessages.map(msg => (
                <div key={msg.id} className="flex flex-col">
                  {msg.isSystem ? (
                    <div className="bg-white/5 border border-white/5 text-white/30 text-[10px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full self-center">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="bg-white/5 border border-white/5 rounded-2xl px-3 py-2 text-sm text-white/90 max-w-[90%] w-fit shadow-md backdrop-blur-sm">
                      <span className="font-semibold text-white/50 text-xs mr-2">{msg.username}</span>
                      {msg.text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Bar: Chat Input & Controls */}
        <div className="shrink-0 bg-[#1a1a35] border-t border-white/10 p-3 flex flex-col gap-3 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20">
          {/* Quick controls row */}
          <div className="flex items-center justify-between px-2">
            <div className="flex gap-3">
              <button onClick={toggleMute} className={`w-10 h-10 rounded-full flex items-center justify-center text-lg shadow-md transition ${muted ? 'bg-red-500/20 border border-red-500 text-red-500' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
                {muted ? '🔇' : '🎙️'}
              </button>
            </div>
            <div className="flex gap-2 text-2xl">
              <button
                onClick={leaveRoom}
                className="bg-red-500/10 hover:bg-red-500/20 text-red-400 px-4 h-10 rounded-full font-semibold text-xs border border-red-500/20 transition"
              >
                Leave Room
              </button>
              <span className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-full cursor-pointer hover:bg-white/10 text-lg">⚙️</span>
            </div>
          </div>

          {/* Input row */}
          <div className="flex items-center gap-2 max-w-xl w-full mx-auto">
            <input
              type="text"
              className="flex-1 bg-black/40 border border-white/10 text-white rounded-full px-5 py-3 text-sm focus:outline-none focus:border-violet-500 placeholder-white/40 shadow-inner"
              placeholder="Comment..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
            />
            <button onClick={sendChat} className="w-12 h-12 bg-violet-600 hover:bg-violet-500 text-white rounded-full flex items-center justify-center shadow-lg shadow-violet-600/20 transition">
              ↗
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Otherwise render the Voice Lobby (room list) if we are on the voice route
  if (!isVoiceRoute) return null;

  const activeRoomsList = rooms.filter(r => !r.status || r.status === 'active');
  const pastRoomsList = rooms.filter(r => r.status === 'ended');

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#07070f]">
      <div className="ambient-blob w-[500px] h-[500px] bg-violet-600/10 top-[-100px] right-[10%]" />

      <header className="relative z-10 border-b border-white/5 glass sticky top-0">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex items-center gap-4">
            <Link to="/dashboard"><button className="btn-ghost rounded-xl p-2 text-slate-400">← Back</button></Link>
            <div>
              <h1 className="font-semibold text-white text-lg">🎙️ Voice Lounge</h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Anonymous Conversations</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary !w-auto px-5 py-2.5 rounded-2xl text-sm bg-violet-600 hover:bg-violet-500 border-none shadow-lg shadow-violet-600/20 font-bold transition-all">
            + Open Case
          </button>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-4 py-8">
        {errorMsg && (
          <motion.div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-2xl px-5 py-4 flex items-center gap-3"
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            ⚠️ {errorMsg}
          </motion.div>
        )}

        {joining && (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Entering room...</p>
          </div>
        )}

        {!joining && (
          <div className="space-y-12">
            {/* Active Rooms */}
            <section>
              <h2 className="text-white/40 text-xs font-black uppercase tracking-widest mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Live Hubs
              </h2>
              {activeRoomsList.length === 0 ? (
                <div className="bg-white/5 border border-white/5 rounded-3xl py-12 text-center">
                  <p className="text-slate-500 text-sm">No active discussions. Be the first to start one!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {activeRoomsList.map((room, i) => (
                    <motion.div
                      key={room.id}
                      onClick={() => joinRoom(room)}
                      className="glass-hover rounded-3xl p-6 cursor-pointer bg-gradient-to-br from-violet-600/10 to-indigo-600/5 border border-white/5 relative overflow-hidden group"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      whileHover={{ scale: 1.02, y: -4 }}>
                      <div className="absolute top-4 right-4 flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Live</span>
                        </div>
                        {profile?.is_admin && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                                if (window.confirm('Permanently delete this voice room and all its history?')) {
                                  try {
                                    await deleteDoc(doc(db, 'voice_rooms', room.id));
                                    setRooms(prev => prev.filter(r => r.id !== room.id));
                                  } catch (error: any) {
                                    alert('Failed to delete: ' + error.message);
                                  }
                                }
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-all opacity-0 group-hover:opacity-100"
                            title="Delete Permanently"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <div className="relative w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">
                        🎙️
                      </div>
                      <h3 className="font-bold text-white text-lg mb-1 truncate">{room.name}</h3>
                      <div className="flex items-center gap-2 mt-3">
                        <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-[10px] text-white/50 border border-white/10">
                          {room.creator_name?.slice(0, 1) || 'A'}
                        </div>
                        <span className="text-[10px] text-white/40 font-bold uppercase tracking-tighter">
                          Started by {room.creator_name || 'Anonymous'}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </section>

            {/* History Section */}
            {pastRoomsList.length > 0 && (
              <section>
                <h2 className="text-white/20 text-xs font-black uppercase tracking-widest mb-4">
                  Past Dialogues
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pastRoomsList.map((room, i) => (
                    <div key={room.id}
                      className="rounded-3xl p-5 border border-white/5 bg-white/[0.02] opacity-60">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-2xl grayscale">🎙️</span>
                        <div className="flex items-center gap-2">
                           {profile?.is_admin && (
                            <button 
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (window.confirm('Permanently delete this archived voice room?')) {
                                  try {
                                    await deleteDoc(doc(db, 'voice_rooms', room.id));
                                    setRooms(prev => prev.filter(r => r.id !== room.id));
                                  } catch (error: any) {
                                    alert('Failed to delete: ' + error.message);
                                  }
                                }
                              }} 
                              className="text-white/20 hover:text-red-400 transition-colors p-1"
                              title="Delete Permanently"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                          <span className="text-[9px] text-white/30 font-bold border border-white/5 px-2 py-0.5 rounded-full">Archive</span>
                        </div>
                      </div>
                      <h3 className="font-semibold text-white/80 text-base mb-1 truncate">{room.name}</h3>
                      <div className="space-y-1">
                        <p className="text-[10px] text-white/30 font-medium">
                          Opened by {room.creator_name || 'Anonymous'}
                        </p>
                        <p className="text-[9px] text-white/20">
                          Ended {new Date(room.ended_at || room.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      <AnimatePresence>
        {showCreate && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}>
            <motion.div className="glass border border-white/10 rounded-3xl p-8 w-full max-w-md bg-[#14142b]"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
              <h2 className="text-xl font-semibold text-white mb-2">Create a Voice Room</h2>
              <p className="text-sm text-slate-500 mb-6">Create a new voice lounge topic. Up to 18 people can join.</p>
              <input type="text" className="input-field mb-4 bg-black/40 placeholder-white/40 focus:border-violet-500" placeholder="Room topic..."
                value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createRoom()} autoFocus maxLength={40} />
              <div className="flex gap-3">
                <button onClick={createRoom} className="btn-primary rounded-xl bg-violet-600 hover:bg-violet-500 flex-1 border-none font-semibold" disabled={creating || !newName.trim()}>
                  {creating ? 'Starting...' : '🎙️ Open Room'}
                </button>
                <button onClick={() => setShowCreate(false)} className="btn-ghost rounded-xl px-4 py-2 border border-white/10 text-white/70 hover:bg-white/5">
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
