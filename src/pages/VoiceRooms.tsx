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
      <div className="flex h-screen w-full flex-col bg-room-dark overflow-hidden font-display">
        {/* Header */}
        <div className="flex items-center bg-room-dark/80 backdrop-blur-md p-4 justify-between border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div 
              onClick={() => navigate('/dashboard')}
              className="text-slate-100 flex size-10 items-center justify-center rounded-full hover:bg-white/10 cursor-pointer transition-colors"
            >
              <span className="material-symbols-outlined">expand_more</span>
            </div>
            <div>
              <h2 className="text-slate-100 text-base font-bold leading-tight truncate max-w-[150px] sm:max-w-[300px]">
                {activeRoom.name}
              </h2>
              <div className="flex items-center gap-1.5">
                <span className="flex h-1.5 w-1.5 rounded-full bg-primary-voice animate-pulse"></span>
                <p className="text-accent-purple text-xs font-medium">Live • {participants.length} participants</p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="flex size-10 items-center justify-center rounded-full bg-white/10 text-slate-100 hover:bg-white/20 transition-colors">
              <span className="material-symbols-outlined text-[20px]">share</span>
            </button>
            {(user?.uid === activeRoom.created_by || profile?.is_admin) && (
              <button 
                onClick={() => { if (confirm('End this room for everyone?')) endRoom(); }}
                className="flex size-10 items-center justify-center rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                title="End Room"
              >
                <span className="material-symbols-outlined text-[20px]">cancel</span>
              </button>
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar-voice p-4 flex flex-col sm:flex-row gap-6">
          {/* Stage Area */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-6 px-2">
              <h4 className="text-accent-purple text-[10px] font-black uppercase tracking-[0.2em]">On Stage</h4>
              <span className="text-white/20 text-[10px] font-bold">{stageUsers.length} Active</span>
            </div>
            
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 sm:gap-8">
              {stageUsers.map((p) => {
                const isMe = p.userId === user?.uid;
                const active = p.speaking && !p.muted;
                return (
                  <motion.div 
                    key={p.userId} 
                    layout
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex flex-col items-center gap-3"
                  >
                    <div className="relative">
                      <div className={`size-20 sm:size-24 rounded-full flex items-center justify-center text-2xl font-bold transition-all duration-300 ${
                        active ? 'border-2 border-accent-purple speaking-glow scale-110 bg-accent-purple/10 text-white' : 'border-2 border-white/5 bg-white/5 text-white/40'
                      }`}>
                        {p.username.slice(0, 2).toUpperCase()}
                      </div>
                      <div className={`absolute -bottom-1 -right-1 size-7 rounded-full flex items-center justify-center border-2 border-room-dark shadow-lg ${
                        p.muted ? 'bg-slate-600 text-white' : 'bg-primary-voice text-white'
                      }`}>
                        <span className="material-symbols-outlined text-[14px] font-bold">
                          {p.muted ? 'mic_off' : 'mic'}
                        </span>
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-slate-100 text-sm font-bold truncate w-24 sm:w-32">
                        {isMe ? 'You' : p.username}
                        {p.userId === activeRoom.created_by && <span className="ml-1 text-primary-voice">★</span>}
                      </p>
                      <p className={`text-[9px] font-black uppercase tracking-widest ${active ? 'text-accent-purple' : 'text-slate-500'}`}>
                        {active ? 'Speaking' : 'Muted'}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Listeners List */}
            {listenerUsers.length > 0 && (
              <div className="mt-12 sm:mt-16 border-t border-white/5 pt-8">
                <div className="flex items-center justify-between mb-6 px-2">
                  <h3 className="text-slate-100 text-sm font-bold">Listeners ({listenerUsers.length})</h3>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-4 sm:gap-6">
                  {listenerUsers.map((p) => (
                    <div key={p.userId} className="flex flex-col items-center gap-2 group cursor-default">
                      <div className="size-12 rounded-full bg-white/5 border border-white/5 flex items-center justify-center text-xs font-bold text-white/30 group-hover:text-white/60 transition-colors">
                        {p.username.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-slate-400 text-[10px] truncate w-full text-center font-medium">
                        {p.userId === user?.uid ? 'You' : p.username}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Chat Side Panel (Desktop only - simplified for now, as original had mobile chat as a separate flow) */}
          <div className="hidden lg:flex flex-col w-80 bg-black/20 rounded-3xl border border-white/5 overflow-hidden">
             <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-slate-100 text-sm font-bold">Live Comments</h3>
             </div>
             <div className="flex-1 overflow-y-auto custom-scrollbar-voice p-4 space-y-4" ref={chatScrollRef}>
               {chatMessages.map(msg => (
                 <div key={msg.id} className={`flex flex-col ${msg.isSystem ? 'items-center' : ''}`}>
                    {msg.isSystem ? (
                      <span className="text-[10px] text-white/20 font-bold uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full text-center">
                        {msg.text}
                      </span>
                    ) : (
                      <div className="bg-white/5 rounded-2xl px-3 py-2 border border-white/5 w-fit max-w-full">
                        <p className="text-[10px] font-bold text-accent-purple mb-0.5">{msg.username}</p>
                        <p className="text-sm text-white/80 leading-snug">{msg.text}</p>
                      </div>
                    )}
                 </div>
               ))}
             </div>
             <div className="p-4 bg-black/20 border-t border-white/5 flex gap-2">
                <input 
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendChat()}
                  placeholder="Type a message..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-purple"
                />
                <button 
                  onClick={sendChat}
                  className="size-9 bg-accent-purple rounded-full flex items-center justify-center text-room-dark hover:scale-105 transition-transform"
                >
                  <span className="material-symbols-outlined text-[20px] font-bold">send</span>
                </button>
             </div>
          </div>
        </div>

        {/* Mobile Message Teaser / Overlay Toggle */}
        <div className="lg:hidden bg-room-dark/95 border-t border-white/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-white/5 border border-white/5 rounded-full px-4 py-2.5 flex items-center justify-between group"
                 onClick={() => { /* Potential: show mobile chat overlay */ }}>
              <p className="text-slate-400 text-sm truncate pr-2">
                {chatMessages.length > 0 ? 
                  `${chatMessages[chatMessages.length-1].username}: ${chatMessages[chatMessages.length-1].text}` : 
                  'Say something...'}
              </p>
            </div>
            <button className="size-11 flex items-center justify-center rounded-full bg-accent-purple/20 text-accent-purple border border-accent-purple/20">
              <span className="material-symbols-outlined">chat_bubble</span>
            </button>
          </div>
        </div>

        {/* Bottom Navigation Bar */}
        <div className="flex gap-1 border-t border-white/10 bg-room-dark px-4 pb-10 pt-3 shrink-0">
          <button 
            onClick={toggleMute}
            className="flex flex-1 flex-col items-center justify-center gap-1.5 group outline-none"
          >
            <div className={`flex h-12 w-12 items-center justify-center rounded-full transition-all group-active:scale-95 border ${
              muted ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-primary-voice/10 text-primary-voice border-primary-voice/20'
            }`}>
              <span className="material-symbols-outlined font-bold">
                {muted ? 'mic_off' : 'mic'}
              </span>
            </div>
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">{muted ? 'Unmute' : 'Mute'}</p>
          </button>

          <button 
            onClick={() => setHandRaised(!handRaised)}
            className="flex flex-1 flex-col items-center justify-center gap-1.5 group outline-none"
          >
            <div className={`flex h-12 w-12 items-center justify-center rounded-full transition-all group-active:scale-95 border ${
              handRaised ? 'bg-accent-purple/20 text-accent-purple border-accent-purple/30' : 'bg-white/5 text-slate-400 border-white/5'
            }`}>
              <span className={`material-symbols-outlined ${handRaised ? 'fill-1' : ''}`}>front_hand</span>
            </div>
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Hand</p>
          </button>

          <button className="flex flex-1 flex-col items-center justify-center gap-1.5 group outline-none">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-slate-400 border border-white/5 transition-all group-active:scale-95">
              <span className="material-symbols-outlined">settings</span>
            </div>
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Settings</p>
          </button>

          <button 
            onClick={leaveRoom}
            className="flex flex-1 flex-col items-center justify-center gap-1.5 group outline-none"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-500 border border-red-500/20 transition-all group-active:scale-95">
              <span className="material-symbols-outlined">call_end</span>
            </div>
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Leave</p>
          </button>
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
