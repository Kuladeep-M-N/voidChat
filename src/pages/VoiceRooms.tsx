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
  try {
    const domain = import.meta.env.VITE_METERED_DOMAIN;
    const apiKey = import.meta.env.VITE_METERED_API_KEY;
    
    if (!domain || !apiKey) {
      console.warn('Metered credentials missing, falling back to STUN');
      return STUN_FALLBACK;
    }

    const response = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${apiKey}`);
    const data = await response.json();
    return data as RTCIceServer[];
  } catch (error) {
    console.warn('Failed to fetch TURN servers, falling back to STUN:', error);
    return STUN_FALLBACK;
  }
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

  // Create Peer Connection
  const createPeer = useCallback(async (remoteUserId: string, isInitiator: boolean) => {
    // Double check if peer already exists to prevent racing
    const existing = peersRef.current.get(remoteUserId);
    if (existing) return existing;

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
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
        console.warn(`Connection to ${remoteUserId} ${pc.connectionState}. Closing.`);
        pc.close();
        peersRef.current.delete(remoteUserId);
        const audio = remoteAudiosRef.current.get(remoteUserId);
        if (audio) {
          audio.srcObject = null;
          audio.remove();
        }
        remoteAudiosRef.current.delete(remoteUserId);
      }
    };

    peersRef.current.set(remoteUserId, pc);

    if (isInitiator && activeRoom) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const outRef = ref(rtdb, `signaling/${activeRoom.id}/${remoteUserId}`);
        push(outRef, { from: user!.uid, type: 'offer', data: offer });
      } catch (err) {
        console.error("Failed to create offer:", err);
      }
    }

    return pc;
  }, [user, activeRoom]);


  // 1. Presence Effect: Updates our state to others (muted, speaking, etc.)
  useEffect(() => {
    if (!user || !activeRoom) return;

    const roomId = activeRoom.id;
    const presenceRef = ref(rtdb, `presence/${roomId}/${user.uid}`);

    set(presenceRef, {
      username: profile?.anonymous_username ?? 'Anonymous',
      muted,
      role: myRole,
      handRaised,
      speaking: isSpeaking
    });

    onDisconnect(presenceRef).remove();

    return () => {
      remove(presenceRef);
    };
  }, [user, activeRoom, profile, muted, myRole, handRaised, isSpeaking]);

  // 2. Signaling Listener Effect: Handles incoming WebRTC signals
  useEffect(() => {
    if (!user || !activeRoom) return;

    const roomId = activeRoom.id;
    const signalingInRef = ref(rtdb, `signaling/${roomId}/${user.uid}`);

    const signalingUnsubscribe = onChildAdded(signalingInRef, async (snapshot) => {
      const val = snapshot.val();
      if (!val) return;
      
      const { from, type, data } = val;
      await remove(snapshot.ref); // Consume signal

      if (type === 'offer') {
        const pc = await createPeer(from, false);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const outRef = ref(rtdb, `signaling/${roomId}/${from}`);
          push(outRef, { from: user.uid, type: 'answer', data: answer });
        } catch (err) {
          console.error("Error handling offer:", err);
        }
      } else if (type === 'answer') {
        const pc = peersRef.current.get(from);
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
          } catch (err) {
            console.error("Error handling answer:", err);
          }
        }
      } else if (type === 'candidate') {
        const pc = peersRef.current.get(from);
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data));
          } catch (err) {
            console.error("Error handling candidate:", err);
          }
        }
      }
    });

    return () => {
      off(signalingInRef);
    };
  }, [user, activeRoom, createPeer]);

  // 3. Participants Listener Effect: Tracks who is in the room
  useEffect(() => {
    if (!user || !activeRoom) return;

    const roomId = activeRoom.id;
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

      // Deterministic Peer Creation: Only create peer if we are the initiator (UID < Remote UID)
      users.forEach(p => {
        if (p.userId !== user.uid && !peersRef.current.has(p.userId)) {
          const isInitiator = user.uid < p.userId;
          if (isInitiator) {
            createPeer(p.userId, true);
          }
        }
      });
    });

    return () => {
      off(participantsRef);
    };
  }, [user, activeRoom, createPeer]);

  // 4. Chat Listener Effect: Handles room messaging
  useEffect(() => {
    if (!user || !activeRoom) {
      setChatMessages([]);
      return;
    }

    const roomId = activeRoom.id;
    const chatRef = ref(rtdb, `chat/${roomId}`);
    
    // Clear messages for new room
    setChatMessages([{ id: '1', userId: 'sys', username: 'System', text: `Connected to ${activeRoom.name}.`, isSystem: true }]);

    const chatUnsubscribe = onChildAdded(chatRef, (snapshot) => {
      const msg = snapshot.val();
      if (msg) {
        setChatMessages(prev => {
          // Prevent duplicates by checking ID
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    });

    return () => {
      off(chatRef);
    };
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

  // ─────────────────────────── ACTIVE ROOM UI ───────────────────────────
  if (!user) return null;

  const stageUsers = participants.filter(p => !p.muted || p.speaking);
  const listenerUsers = participants.filter(p => p.muted && !p.speaking);

  if (!isVoiceRoute && activeRoom) {
    // Minimized Widget
    return (
      <div className="fixed bottom-6 right-6 z-50 font-display">
        <div className="bg-room-dark/95 backdrop-blur-xl border border-white/10 p-4 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-4 w-72">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center relative overflow-hidden shrink-0 border-2 ${isSpeaking && !muted ? 'border-accent-purple speaking-glow' : 'border-white/10'}`}>
            <span className="text-xl relative z-10">🎙️</span>
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-white font-bold text-sm truncate">{activeRoom.name}</h4>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary-voice animate-pulse" />
              <span className="text-accent-purple text-[10px] font-bold uppercase tracking-widest">{participants.length} Live</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button onClick={toggleMute} className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${muted ? 'bg-red-500/20 text-red-500' : 'bg-white/10 text-white hover:bg-white/20'}`}>
              <span className="material-symbols-outlined text-[20px]">{muted ? 'mic_off' : 'mic'}</span>
            </button>
            <button onClick={() => navigate('/voice')} className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition-all">
              <span className="material-symbols-outlined text-[20px]">open_in_full</span>
            </button>
            <button onClick={leaveRoom} className="w-9 h-9 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500 flex items-center justify-center transition-all" title="Leave">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isVoiceRoute && activeRoom) {
    return (
      <div className="font-display bg-[#0f1115] text-slate-800 dark:text-slate-200 h-screen w-full flex flex-col transition-colors duration-300 overflow-hidden"
           style={{
             backgroundImage: 'radial-gradient(circle at 15% 50%, rgba(139, 92, 246, 0.08), transparent 35%), radial-gradient(circle at 85% 30%, rgba(56, 189, 248, 0.08), transparent 35%)'
           }}>
        
        {/* Header */}
        <header className="px-6 py-4 flex justify-between items-center z-20 relative bg-[#1c1c24]/80 backdrop-blur-lg border-b border-white/5 shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-400 flex items-center justify-center shadow-[0_4px_10px_rgba(99,102,241,0.2)]">
              <span className="material-symbols-outlined text-white font-bold text-[22px]">graphic_eq</span>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">{activeRoom.name}</h1>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"></span>
                <span>Live • {participants.length} participants</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 border border-white/20 transition-colors text-sm font-semibold text-slate-200 shadow-sm">
              <span className="material-symbols-outlined text-lg">share</span> Share
            </button>
            <button 
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 border border-white/20 transition-colors text-sm font-semibold text-slate-200 shadow-sm"
            >
              <span className="material-symbols-outlined text-lg">expand_more</span> Minimize
            </button>
            <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-white font-bold border border-slate-600 shadow-sm">
               {profile?.anonymous_username?.slice(0, 2).toUpperCase() || 'AN'}
            </div>
          </div>
        </header>

        <main className="flex-1 flex relative overflow-hidden">
          {/* Main Stage Area */}
          <div className="flex-1 flex flex-col p-4 sm:p-8 overflow-y-auto pb-32 custom-scrollbar-voice">
            <div className="mb-12">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-sm font-bold tracking-widest uppercase text-slate-400">On Stage</h2>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
                  {stageUsers.length} Speakers
                </span>
              </div>
              <div className="flex flex-wrap gap-6 sm:gap-8 items-center justify-center sm:justify-start">
                {stageUsers.map((p) => {
                  const isMe = p.userId === user?.uid;
                  const active = p.speaking && !p.muted;
                  const isHost = p.userId === activeRoom.created_by;

                  return (
                    <div key={p.userId} className={`flex flex-col items-center gap-3 transition-opacity duration-300 ${!active && !isMe ? 'opacity-80 hover:opacity-100' : ''}`}>
                      <div className="relative">
                        <div className={`flex items-center justify-center text-3xl font-bold bg-slate-800 object-cover transition-all ${
                          active 
                            ? 'w-24 h-24 rounded-full border-[3px] border-sky-300 shadow-[0_0_15px_rgba(125,211,252,0.4),inset_0_0_10px_rgba(125,211,252,0.2)] text-white bg-slate-700 scale-105' 
                            : 'w-20 h-20 rounded-full border-2 border-slate-700 text-slate-400 hover:border-slate-500'
                        }`}>
                          {isHost && !active ? (
                            <div className="w-full h-full rounded-full bg-gradient-to-br from-indigo-500/80 to-purple-600/80 flex items-center justify-center text-white">
                              {p.username.slice(0, 2).toUpperCase()}
                            </div>
                          ) : (
                            p.username.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className={`absolute -bottom-1 -right-1 rounded-full border-2 bg-[#0f1115] flex items-center justify-center ${
                          active ? 'w-8 h-8 border-[#0f1115]' : 'w-7 h-7 border-[#0f1115]'
                        }`}>
                           <span className={`material-symbols-outlined drop-shadow-sm ${
                             p.muted ? 'text-rose-400 text-[14px]' : 'text-sky-300 text-[16px]'
                           }`}>
                             {p.muted ? 'mic_off' : 'mic'}
                           </span>
                        </div>
                      </div>
                      <span className={`${active ? 'font-semibold text-sm text-sky-100' : 'font-medium text-sm text-slate-400'}`}>
                        {isMe ? 'You' : p.username} {isHost && !isMe ? '★' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Listeners Section */}
            {listenerUsers.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4 w-full">
                    <h2 className="text-sm font-bold tracking-widest uppercase text-slate-400 whitespace-nowrap">Listeners</h2>
                    <div className="h-[1px] bg-white/10 w-full flex-1"></div>
                    <span className="text-xs text-slate-500 whitespace-nowrap font-medium">{listenerUsers.length} people listening</span>
                  </div>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-6">
                  {listenerUsers.map((p) => (
                    <div key={p.userId} className="flex flex-col items-center gap-2">
                       <div className="w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity cursor-pointer text-xs font-bold text-slate-300 border border-slate-700/50">
                          {p.username.slice(0, 2).toUpperCase()}
                       </div>
                       <span className="text-[11px] text-slate-400 truncate w-full text-center">
                         {p.userId === user?.uid ? 'You' : p.username}
                       </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Chat */}
          <aside className="hidden lg:flex w-96 bg-[#181820]/70 backdrop-blur-xl border-l border-white/5 flex-col relative z-10 shadow-[-10px_0_30px_rgba(0,0,0,0.2)]">
            <div className="p-6 border-b border-white/5">
              <h3 className="font-bold flex items-center gap-2 text-lg text-slate-100">
                <span className="material-symbols-outlined text-indigo-400">forum</span> Live Comments
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 custom-scrollbar-voice" ref={chatScrollRef}>
               {chatMessages.map(msg => {
                 if (msg.isSystem) {
                   return (
                     <div key={msg.id} className="flex justify-center">
                       <span className="text-[10px] font-semibold px-4 py-1.5 rounded-full bg-white/5 text-slate-400 border border-white/5">
                         {msg.text.toUpperCase()}
                       </span>
                     </div>
                   );
                 }
                 
                 const isMe = msg.userId === user?.uid;
                 return (
                   <div key={msg.id} className={`flex gap-3 max-w-full ${isMe ? 'flex-row-reverse' : ''}`}>
                     <div className={`w-8 h-8 rounded-full flex shrink-0 items-center justify-center text-xs font-bold text-white shadow-sm ${
                       isMe ? 'bg-indigo-500 border border-indigo-400/50' : 'bg-slate-600 border border-slate-500'
                     }`}>
                       {msg.username.slice(0, 2).toUpperCase()}
                     </div>
                     <div className={`flex flex-col min-w-0 flex-1 ${isMe ? 'items-end' : ''}`}>
                       <div className={`flex items-baseline gap-2 mb-1 ${isMe ? 'flex-row-reverse' : ''}`}>
                         <span className={`font-semibold text-sm ${isMe ? 'text-indigo-300' : 'text-slate-300'}`}>{isMe ? 'You' : msg.username}</span>
                         <span className="text-[10px] text-slate-500 shrink-0">Live</span>
                       </div>
                       <div className={isMe 
                            ? 'bg-indigo-500/20 border border-indigo-400/30 px-4 py-2 rounded-2xl rounded-tr-none text-slate-100 text-[13px] break-words whitespace-pre-wrap inline-block [word-break:break-word] shadow-sm' 
                            : 'text-[13px] text-slate-200 bg-white/5 px-4 py-2 rounded-2xl rounded-tl-none border border-white/5 break-words whitespace-pre-wrap inline-block [word-break:break-word] shadow-sm'}>
                         {msg.text}
                       </div>
                     </div>
                   </div>
                 );
               })}
            </div>
            
            <div className="p-4 border-t border-white/5 bg-[#181820]">
              <div className="relative flex items-center">
                <input 
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendChat()}
                  placeholder="Message..."
                  className="w-full bg-slate-800/80 border border-slate-700/50 rounded-full py-3.5 pl-5 pr-12 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 transition-all shadow-inner"
                />
                <button 
                  onClick={sendChat}
                  className="absolute right-2 w-9 h-9 rounded-full bg-indigo-500 flex items-center justify-center text-white hover:bg-indigo-400 transition-colors shadow-md"
                >
                  <span className="material-symbols-outlined text-[18px]">send</span>
                </button>
              </div>
            </div>
          </aside>

          {/* Floating Controls Bar */}
          <div className="absolute bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 bg-[#1c1c24]/90 backdrop-blur-xl rounded-full px-4 sm:px-6 py-2.5 flex items-center gap-2 sm:gap-3 shadow-[0_10px_30px_rgba(0,0,0,0.5)] border border-white/10 z-30 w-[95%] sm:w-auto overflow-x-auto custom-scrollbar-voice justify-center">
            <button 
              onClick={toggleMute}
              className={`w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-full flex items-center justify-center transition-all group ${
                muted ? 'bg-white/5 hover:bg-white/10 text-slate-300' : 'bg-white/10 hover:bg-white/20 text-sky-300 shadow-[0_0_15px_rgba(125,211,252,0.15)]'
              }`}
            >
              <span className={`material-symbols-outlined transition-colors text-[22px] ${!muted && 'text-sky-300'}`}>{muted ? 'mic_off' : 'mic'}</span>
            </button>
            <button 
              onClick={() => setHandRaised(!handRaised)}
              className={`w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-full flex items-center justify-center transition-all group ${
                handRaised ? 'bg-amber-400/20 text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.15)]' : 'bg-white/5 hover:bg-white/10 text-slate-300'
              }`}
            >
              <span className={`material-symbols-outlined transition-colors text-[22px] ${handRaised && 'text-amber-300'}`}>back_hand</span>
            </button>
            <button className="w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all group">
              <span className="material-symbols-outlined text-slate-300 group-hover:text-amber-300 transition-colors text-[22px]">add_reaction</span>
            </button>
            <button className="w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all group mr-0 sm:mr-2">
              <span className="material-symbols-outlined text-slate-300 transition-colors text-[22px]">settings</span>
            </button>
            <div className="hidden sm:block w-[1px] h-8 bg-white/10 shrink-0"></div>
            <button 
              onClick={leaveRoom}
              className="ml-0 sm:ml-2 px-4 sm:px-6 py-2.5 shrink-0 rounded-full bg-rose-500/80 hover:bg-rose-500 flex items-center gap-2 font-medium text-white shadow-sm transition-all text-sm"
            >
              <span className="material-symbols-outlined text-[18px]">logout</span> Leave
            </button>
            {(profile?.is_admin || user?.uid === activeRoom.created_by) && (
               <button 
                onClick={() => { if (confirm('End this room for everyone?')) endRoom(); }}
                className="ml-1 sm:ml-2 px-4 sm:px-6 py-2.5 shrink-0 rounded-full bg-slate-700/80 hover:bg-slate-700 flex items-center gap-2 font-medium text-white shadow-sm transition-all border border-white/5 text-sm"
              >
                <span className="material-symbols-outlined text-[18px]">cancel</span> End
              </button>
            )}
          </div>
        </main>
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
