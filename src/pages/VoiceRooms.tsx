import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Archive, Users, Mic, Mic2, TrendingUp, Zap, Clock, MessageSquare, History, Plus, Play, Sparkles, ArrowLeft, Dices, Flame } from 'lucide-react';
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
  const [showNoRoomsOverlay, setShowNoRoomsOverlay] = useState(false);
  const [showChat, setShowChat] = useState(false); // Mobile sidebar toggle
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
  const liveHubsRef = useRef<HTMLDivElement>(null);

  // Reactions & Interactions
  const [floatingReactions, setFloatingReactions] = useState<{ id: string; emoji: string; userId: string }[]>([]);
  const [showReactionMenu, setShowReactionMenu] = useState(false);

  // Global Presence State (for the entire lounge)
  const [globalPresence, setGlobalPresence] = useState<Record<string, Record<string, any>>>({});

  // WebRTC refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
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

  // Global Presence Listener: Syncs total listeners and individual room counts across the lounge
  useEffect(() => {
    if (!user) return;
    const presenceRootRef = ref(rtdb, 'presence');
    const unsubscribe = onValue(presenceRootRef, (snapshot) => {
      setGlobalPresence(snapshot.val() || {});
    });
    return () => off(presenceRootRef, 'value', unsubscribe);
  }, [user]);

  // Derived Values
  const totalListeners = useMemo(() => {
    return Object.values(globalPresence).reduce((acc, roomParticipants) => {
      return acc + Object.keys(roomParticipants).length;
    }, 0);
  }, [globalPresence]);

  const roomsWithCounts = useMemo(() => {
    return rooms.map(room => ({
      ...room,
      participantCount: globalPresence[room.id] ? Object.keys(globalPresence[room.id]).length : 0
    }));
  }, [rooms, globalPresence]);

  const hotTopics = useMemo(() => {
    return roomsWithCounts
      .filter(r => r.status === 'active' || !r.status)
      .sort((a, b) => (b.participantCount || 0) - (a.participantCount || 0))
      .slice(0, 4);
  }, [roomsWithCounts]);

  // Create Peer Connection
  const createPeer = useCallback(async (remoteUserId: string, isInitiator: boolean) => {
    // Double check if peer already exists to prevent racing
    const existing = peersRef.current.get(remoteUserId);
    if (existing) return existing;

    console.log(`[WebRTC] Creating peer for ${remoteUserId}, initiator: ${isInitiator}`);
    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.ontrack = ({ streams }) => {
      console.log(`[WebRTC] Receiving remote track from ${remoteUserId}`);
      let audio = remoteAudiosRef.current.get(remoteUserId);
      if (!audio) {
        audio = new Audio();
        audio.id = `audio-${remoteUserId}`;
        audio.autoplay = true;
        // Keep it hidden but in DOM
        audio.style.display = 'none';
        document.getElementById('remote-audio-container')?.appendChild(audio);
        remoteAudiosRef.current.set(remoteUserId, audio);
      }
      
      if (audio.srcObject !== streams[0]) {
        audio.srcObject = streams[0];
        // Explicit play call as some browsers block autoplay
        audio.play().catch(e => console.warn(`[WebRTC] Autoplay blocked for ${remoteUserId}:`, e));
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && activeRoom) {
        const outRef = ref(rtdb, `signaling/${activeRoom.id}/${remoteUserId}`);
        push(outRef, { from: user!.uid, type: 'candidate', data: candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state with ${remoteUserId}: ${pc.iceConnectionState}`);
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state with ${remoteUserId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn(`Connection to ${remoteUserId} ${pc.connectionState}. Closing.`);
        pc.close();
        peersRef.current.delete(remoteUserId);
        pendingCandidatesRef.current.delete(remoteUserId);
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

  // Hand Raise Toggle (Manually controlled by user)

  // Reactions Listener
  useEffect(() => {
    if (!user || !activeRoom) return;

    const roomId = activeRoom.id;
    const reactionsRef = ref(rtdb, `reactions/${roomId}`);

    const unsubscribe = onChildAdded(reactionsRef, (snapshot) => {
      const data = snapshot.val();
      // Only show reactions from the last 5 seconds to avoid flooding on join
      if (data && data.timestamp && (Date.now() - data.timestamp < 5000)) {
        console.log(`[Interaction] Received reaction: ${data.emoji} from ${data.userId}`);
        const id = snapshot.key || Math.random().toString();
        setFloatingReactions(prev => [...prev, { id, emoji: data.emoji, userId: data.userId }]);
        setTimeout(() => {
          setFloatingReactions(prev => prev.filter(r => r.id !== id));
        }, 4000);
      }
    });

    return () => off(reactionsRef);
  }, [user, activeRoom]);

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
          
          // Process queued candidates
          const queued = pendingCandidatesRef.current.get(from) || [];
          for (const cand of queued) {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          }
          pendingCandidatesRef.current.delete(from);
        } catch (err) {
          console.error("Error handling offer:", err);
        }
      } else if (type === 'answer') {
        const pc = peersRef.current.get(from);
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            
            // Process queued candidates
            const queued = pendingCandidatesRef.current.get(from) || [];
            for (const cand of queued) {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            }
            pendingCandidatesRef.current.delete(from);
          } catch (err) {
            console.error("Error handling answer:", err);
          }
        }
      } else if (type === 'candidate') {
        const pc = peersRef.current.get(from);
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data));
          } catch (err) {
            console.error("Error handling candidate:", err);
          }
        } else {
          // Queue candidate
          const queued = pendingCandidatesRef.current.get(from) || [];
          queued.push(data);
          pendingCandidatesRef.current.set(from, queued);
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

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);


  const leaveRoom = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    remoteAudiosRef.current.forEach(a => a.remove());
    remoteAudiosRef.current.clear();
    setActiveRoom(null); setParticipants([]); setChatMessages([]); setHandRaised(false);
  }, []);

  const [activityFeed, setActivityFeed] = useState<any[]>([]);

  // Simulation of real-time stats (based on actual Firestore data)
  const activeRoomsCount = rooms.filter(r => r.status === 'active' || !r.status).length;
  const trendingRoom = useMemo(() => {
    return roomsWithCounts
      .filter(r => r.status === 'active' || !r.status)
      .sort((a, b) => (b.participantCount || 0) - (a.participantCount || 0))[0];
  }, [roomsWithCounts]);

  // Aggregate activity from rooms
  useEffect(() => {
    if (rooms.length > 0) {
      const activeOnly = rooms.filter(r => r.status === 'active' || !r.status);
      const latest = activeOnly.slice(0, 3).map(r => {
        let timeStr = 'Just now';
        if (r.created_at) {
          const date = r.created_at.toDate ? r.created_at.toDate() : new Date(r.created_at?.seconds * 1000);
          timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        }
        
        return {
          id: `act-${r.id}`,
          text: `Room "${r.name}" is looking for listeners`,
          time: timeStr,
          icon: <Mic2 size={12} className="text-violet-400" />
        };
      });
      setActivityFeed(latest);
    } else {
      setActivityFeed([]);
    }
  }, [rooms]);

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
    if (!name || !user) {
      toast.error('Please enter a room name');
      return;
    }
    
    setCreating(true);
    const toastId = toast.loading('Synchronizing voice field...');
    
    try {
      const docRef = await addDoc(collection(db, 'voice_rooms'), {
        name,
        created_by: user.uid,
        status: 'active',
        created_at: serverTimestamp(),
        creator_name: profile?.anonymous_username || 'Anonymous'
      });
      
      const room = { 
        id: docRef.id, 
        name, 
        created_by: user.uid, 
        created_at: new Date(),
        status: 'active'
      };
      
      await joinRoom(room as VoiceRoom);
      toast.success('Broadcast started!', { id: toastId });
      setNewName(''); 
      setShowCreate(false);
    } catch (err) {
      console.error('Create room error:', err);
      toast.error('Failed to initialize voice field', { id: toastId });
    } finally {
      setCreating(false);
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
    const newId = Date.now().toString();
    const msg: ChatMessage = { 
      id: newId, 
      userId: user!.uid, 
      username: profile?.anonymous_username ?? 'Anon', 
      text: chatInput.trim() 
    };
    
    // Optimistic Update
    setChatMessages(prev => [...prev, msg]);
    setChatInput('');

    const chatRef = ref(rtdb, `chat/${activeRoom.id}`);
    push(chatRef, msg); // Push with the same ID used locally
  };

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) track.enabled = muted;
    setMuted(m => !m);
  }, [muted]);

  const sendReaction = (emoji: string) => {
    if (!user || !activeRoom) return;
    console.log(`[Interaction] Sending reaction: ${emoji}`);
    const reactionsRef = ref(rtdb, `reactions/${activeRoom.id}`);
    push(reactionsRef, {
      emoji,
      userId: user.uid,
      timestamp: Date.now()
    });
    setShowReactionMenu(false);
  };



  // ------------------------------------ RENDER LOGIC ------------------------------------
  if (!user) return null;

  const stageUsers = participants.filter(p => !p.muted || p.speaking);
  const listenerUsers = participants.filter(p => p.muted && !p.speaking);

  if (!isVoiceRoute && activeRoom) {
    // Minimized Widget
    return (
      <div className="fixed bottom-6 right-6 z-50 font-display">
        <div className="bg-room-dark/95 backdrop-blur-xl border border-white/10 p-4 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-4 w-72">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center relative overflow-hidden shrink-0 border-2 ${isSpeaking && !muted ? 'border-accent-purple speaking-glow' : 'border-white/10'}`}>
            <Mic size={20} className="relative z-10 text-white" />
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
            <button 
              onClick={() => { if (window.confirm('Leave this room?')) leaveRoom(); }} 
              className="w-9 h-9 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500 flex items-center justify-center transition-all" 
              title="Leave"
            >
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
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">{activeRoom.name}</h1>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"></span>
                <span>Live • {participants.length} participants</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
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
                        {p.handRaised && (
                          <motion.div 
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center border-2 border-[#0f1115] z-10"
                          >
                            <span className="material-symbols-outlined text-black text-[16px] font-bold">back_hand</span>
                          </motion.div>
                        )}
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
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-x-4 gap-y-8">
                  {listenerUsers.map((p) => {
                    const isMe = p.userId === user?.uid;
                    return (
                      <div key={p.userId} className="flex flex-col items-center gap-2 group">
                        <div className="relative">
                          <div className="w-14 h-14 rounded-2xl bg-slate-800/80 flex items-center justify-center text-sm font-bold text-slate-300 border border-white/5 group-hover:border-indigo-500/50 group-hover:bg-slate-700/80 transition-all duration-300 shadow-sm relative overflow-hidden">
                             {p.username.slice(0, 2).toUpperCase()}
                             <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                          
                          {p.handRaised && (
                            <motion.div 
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-amber-400 flex items-center justify-center border-2 border-[#0f1115] z-10 shadow-lg"
                            >
                              <span className="material-symbols-outlined text-black text-[12px] font-bold">back_hand</span>
                            </motion.div>
                          )}
                        </div>
                        <span className="text-[11px] font-medium text-slate-400 truncate w-full text-center group-hover:text-slate-200 transition-colors">
                          {isMe ? 'You' : p.username}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Inline Chat for Mobile */}
            <div className="lg:hidden mt-8 px-6 py-4 rounded-3xl bg-[#1c1c24]/50 border border-white/5 shadow-2xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-indigo-400">forum</span>
                  <h3 className="font-bold text-slate-100 uppercase tracking-widest text-[11px]">Live Comments</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Live Pulse</span>
                </div>
              </div>

              {/* Scrollable Message Area */}
              <div 
                className="flex-1 overflow-y-auto pr-2 mb-4 flex flex-col gap-5 custom-scrollbar-voice max-h-[380px]" 
                ref={chatScrollRef}
              >
                {chatMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-600 gap-3">
                    <span className="material-symbols-outlined text-4xl opacity-20">bubble_chart</span>
                    <p className="text-[11px] font-medium uppercase tracking-widest">Quiet in the void...</p>
                  </div>
                ) : (
                  chatMessages.map(msg => {
                    if (msg.isSystem) {
                      return (
                        <div key={msg.id} className="flex justify-center my-1">
                          <span className="text-[10px] font-semibold px-3 py-1 rounded-full bg-white/5 text-slate-500 border border-white/5 uppercase tracking-tighter">
                            {msg.text}
                          </span>
                        </div>
                      );
                    }
                    
                    const isMe = msg.userId === user?.uid;
                    return (
                      <div key={msg.id} className={`flex gap-3 max-w-full ${isMe ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-full flex shrink-0 items-center justify-center text-xs font-bold text-white shadow-sm ${
                          isMe ? 'bg-indigo-500 border border-indigo-400/50' : 'bg-slate-700/80 border border-slate-600'
                        }`}>
                          {(msg.username || "??").slice(0, 2).toUpperCase()}
                        </div>
                        <div className={`flex flex-col min-w-0 flex-1 ${isMe ? 'items-end' : ''}`}>
                          <div className={`flex items-baseline gap-2 mb-1 ${isMe ? 'flex-row-reverse' : ''}`}>
                            <span className={`font-semibold text-[11px] ${isMe ? 'text-indigo-300' : 'text-slate-400'}`}>{isMe ? 'You' : msg.username}</span>
                            <span className="text-[9px] text-slate-600 shrink-0 font-bold">12:00</span>
                          </div>
                          <div className={isMe 
                               ? 'bg-indigo-600/30 border border-indigo-500/20 px-4 py-2 rounded-2xl rounded-tr-none text-slate-200 text-[13px] break-words whitespace-pre-wrap shadow-sm' 
                               : 'text-[13px] text-slate-300 bg-white/[0.03] px-4 py-2 rounded-2xl rounded-tl-none border border-white/5 break-words whitespace-pre-wrap shadow-sm'}>
                            {msg.text}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              
              {/* Still Input Bar */}
              <div className="relative flex items-center bg-black/40 rounded-2xl p-1 border border-white/5 shadow-inner">
                <input 
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendChat()}
                  placeholder="Enter the void..."
                  className="w-full bg-transparent py-3 pl-4 pr-12 text-sm text-slate-100 placeholder-slate-600 focus:outline-none transition-all"
                />
                <button 
                  onClick={sendChat}
                  className="absolute right-1 w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white hover:bg-indigo-500 transition-colors shadow-lg active:scale-95"
                >
                  <span className="material-symbols-outlined text-[20px]">send</span>
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar Chat (Desktop Only) */}
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
                       {(msg.username || "??").slice(0, 2).toUpperCase()}
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
          <div className="absolute bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 bg-[#1c1c24]/90 backdrop-blur-xl rounded-full px-4 sm:px-6 py-2.5 flex items-center gap-2 sm:gap-3 shadow-[0_10px_30px_rgba(0,0,0,0.5)] border border-white/10 z-30 w-max max-w-[95vw] justify-center">
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
            <div className="relative">
              <button 
                onClick={() => setShowReactionMenu(!showReactionMenu)}
                className={`w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all group ${showReactionMenu ? 'bg-indigo-500/20 text-indigo-300' : ''}`}
              >
                <span className="material-symbols-outlined text-slate-300 group-hover:text-amber-300 transition-colors text-[22px]">add_reaction</span>
              </button>
              
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 pointer-events-none z-[60] mb-2">
                <AnimatePresence>
                  {floatingReactions.map(r => (
                    <motion.div
                      key={r.id}
                      initial={{ y: 0, opacity: 1, scale: 0.5, x: (Math.random() - 0.5) * 40 }}
                      animate={{ y: -150 - Math.random() * 50, opacity: 0, scale: 1.5 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 2 + Math.random(), ease: "easeOut" }}
                      className="absolute bottom-0 text-3xl drop-shadow-md"
                    >
                      {r.emoji}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              <AnimatePresence>
                {showReactionMenu && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.9 }}
                    className="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 bg-[#1c1c24] border border-white/10 rounded-2xl p-2 flex gap-2 shadow-2xl z-50"
                  >
                    {['❤️', '🔥', '👍', '😂', '😮', '🙌'].map(emoji => (
                      <button 
                        key={emoji}
                        onClick={() => sendReaction(emoji)}
                        className="w-10 h-10 flex items-center justify-center text-xl hover:bg-white/5 rounded-xl transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              

            </div>
            <div className="hidden sm:block w-[1px] h-8 bg-white/10 shrink-0"></div>
            <button 
              onClick={() => { if (window.confirm('Leave this room?')) leaveRoom(); }}
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
          {/* Hidden container for remote WebRTC audio elements */}
          <div id="remote-audio-container" style={{ display: 'none' }} />
        </main>
      </div>
    );
  }

  // Otherwise render the Voice Lobby (room list) if we are on the voice route
  if (!isVoiceRoute) return null;

  const activeRoomsList = rooms.filter(r => !r.status || r.status === 'active');
  const pastRoomsList = rooms.filter(r => r.status === 'ended');

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#07070f] text-slate-200 font-sans selection:bg-violet-500/30">
      {/* Background Elements */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] bg-violet-600/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/10 blur-[100px] rounded-full" />
        <div className="absolute top-[30%] left-[20%] w-[300px] h-[300px] bg-fuchsia-600/5 blur-[80px] rounded-full animate-pulse" />
      </div>

      <header className="relative z-50 border-b border-white/5 bg-[#07070f]/80 backdrop-blur-xl sticky top-0 group">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-6">
            <Link to="/dashboard" className="transition-transform active:scale-90">
              <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all group/back">
                <ArrowLeft size={18} className="group-hover/back:-translate-x-0.5 transition-transform" />
              </div>
            </Link>
            <div className="space-y-0.5">
              <div className="flex items-center gap-3">
                <h1 className="font-black text-2xl tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400">
                  Voice Lounge
                </h1>
                <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">{activeRoomsCount} Live</span>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-bold flex items-center gap-2">
                <Users size={10} /> {totalListeners} Listeners Connected
              </p>
            </div>
          </div>

          <motion.button 
            onClick={() => setShowCreate(true)} 
            className="group relative px-6 py-2.5 rounded-2xl bg-violet-600/10 backdrop-blur-md border border-violet-400/30 text-white font-bold text-sm transition-all flex items-center gap-3 overflow-hidden shadow-[0_0_20px_rgba(139,92,246,0.1)]"
            whileHover={{ y: -2, boxShadow: "0 0 30px rgba(139,92,246,0.2)" }}
            whileTap={{ scale: 0.98 }}
          >
            {/* Hover Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-r from-violet-500/10 to-indigo-600/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            
            <div className="relative flex items-center gap-2">
              <div className="relative">
                <Mic size={18} className="relative z-10" />
                {/* Animated Soundwave Dots */}
                <div className="absolute -right-1 -top-1 flex gap-[1px]">
                  {[1, 2].map((_, i) => (
                    <motion.div 
                      key={i}
                      className="w-[2px] bg-violet-400 rounded-full"
                      animate={{ height: ["2px", "6px", "2px"] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.2 }}
                    />
                  ))}
                </div>
              </div>
              <span className="tracking-tight">Start Voice Room</span>
            </div>
          </motion.button>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          
          {/* Left Column: Dashboard Content */}
          <div className="lg:col-span-9 space-y-12">
            
            {/* Overview Stats Row */}
            {/* Interactive Engagement Cards */}
            <div className="grid grid-cols-3 gap-2 md:gap-4 lg:gap-6">
              {/* Card 1: Start Room */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative overflow-hidden group rounded-[1.2rem] border border-white/5 bg-gradient-to-br from-violet-500/10 to-transparent p-3 shadow-lg backdrop-blur-xl transition-all md:rounded-[1.6rem] md:p-6 glass-hover"
              >
                <div className="relative flex flex-col items-center text-center gap-1 md:flex-row md:items-start md:justify-between md:text-left md:gap-4">
                  <div className="order-2 md:order-1">
                    <p className="font-mono text-[8px] uppercase tracking-wider text-white/38 md:hidden">Start</p>
                    <p className="hidden font-mono text-[11px] uppercase tracking-[0.26em] text-white/38 md:block">Host</p>
                    <h3 className="mt-0.5 text-[10px] font-bold text-white md:mt-3 md:text-lg">Start a Voice Room</h3>
                    <p className="hidden mt-2 text-sm text-slate-500 leading-relaxed md:block">Host a topic and invite people to join the conversation.</p>
                    <p className="mt-1 text-[8px] text-slate-500 md:hidden">Host a topic</p>
                    
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowCreate(true);
                      }}
                      className="relative z-20 mt-2 w-full py-1.5 rounded-lg bg-violet-500/10 hover:bg-violet-500 text-violet-400 hover:text-white border border-violet-500/20 font-bold text-[8px] transition-all flex items-center justify-center gap-1.5 group/btn md:mt-6 md:py-2.5 md:rounded-xl md:text-xs cursor-pointer"
                    >
                      <span>Create</span>
                      <div className="w-1 h-1 rounded-full bg-violet-400 group-hover/btn:bg-white animate-pulse md:w-1.5 md:h-1.5" />
                    </button>
                  </div>
                  
                  <div className="order-1 mb-1 rounded-lg border border-violet-500/20 bg-violet-500/10 p-2 md:order-2 md:mb-0 md:rounded-2xl md:p-3">
                    <Mic2 className="h-3.5 w-3.5 text-violet-400 md:h-5 md:w-5" />
                    <div className="absolute inset-0 bg-violet-400/20 blur-lg rounded-full animate-pulse opacity-50" />
                  </div>
                </div>
              </motion.div>

              {/* Card 2: Hot Topics */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="relative overflow-hidden group rounded-[1.2rem] border border-white/5 bg-gradient-to-br from-blue-500/10 to-transparent p-3 shadow-lg backdrop-blur-xl transition-all md:rounded-[1.6rem] md:p-6 glass-hover"
              >
                <div className="relative flex flex-col items-center text-center gap-1 md:flex-row md:items-start md:justify-between md:text-left md:gap-4">
                  <div className="order-2 md:order-1 w-full">
                    <p className="font-mono text-[8px] uppercase tracking-wider text-white/38 md:hidden">Live</p>
                    <p className="hidden font-mono text-[11px] uppercase tracking-[0.26em] text-white/38 md:block">Trending</p>
                    <h3 className="mt-0.5 text-[10px] font-bold text-white md:mt-3 md:text-lg">Hot Topics</h3>
                    
                    <div className="mt-2 flex flex-wrap justify-center gap-1 md:mt-4 md:justify-start md:gap-2">
                      {hotTopics.length > 0 ? (
                        hotTopics.slice(0, 2).map((room, idx) => (
                          <button 
                            key={room.id}
                            onClick={() => joinRoom(room)}
                            className="px-1.5 py-0.5 rounded-md bg-white/5 border border-white/5 text-[7px] font-medium text-slate-400 hover:text-blue-300 hover:bg-blue-500/10 hover:border-blue-500/30 transition-all flex items-center gap-1 group/topic md:px-3 md:py-1.5 md:rounded-lg md:text-[10px]"
                          >
                            <MessageSquare size={8} className="group-hover/topic:text-blue-400 transition-colors md:size-10" />
                            <span className="truncate max-w-[40px] md:max-w-none">{room.name}</span>
                          </button>
                        ))
                      ) : (
                        <p className="text-[7px] text-slate-600 font-medium italic md:text-[10px]">Scanning...</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="order-1 mb-1 rounded-lg border border-blue-500/20 bg-blue-500/10 p-2 md:order-2 md:mb-0 md:rounded-2xl md:p-3">
                    <Flame className="h-3.5 w-3.5 text-blue-400 md:h-5 md:w-5" />
                  </div>
                </div>
              </motion.div>

              {/* Card 3: Join Random */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="relative overflow-hidden group rounded-[1.2rem] border border-white/5 bg-gradient-to-br from-amber-500/10 to-transparent p-3 shadow-lg backdrop-blur-xl transition-all md:rounded-[1.6rem] md:p-6 glass-hover"
              >
                <div className="relative flex flex-col items-center text-center gap-1 md:flex-row md:items-start md:justify-between md:text-left md:gap-4">
                  <div className="order-2 md:order-1">
                    <p className="font-mono text-[8px] uppercase tracking-wider text-white/38 md:hidden">Random</p>
                    <p className="hidden font-mono text-[11px] uppercase tracking-[0.26em] text-white/38 md:block">Shuffle</p>
                    <h3 className="mt-0.5 text-[10px] font-bold text-white md:mt-3 md:text-lg">Join Random</h3>
                    <p className="hidden mt-2 text-sm text-slate-500 leading-relaxed md:block">Jump into a random live discussion happening now.</p>
                    <p className="mt-1 text-[8px] text-slate-500 md:hidden">Jump in</p>
                    
                    <button 
                      onClick={() => {
                        const activeRooms = rooms.filter(r => !r.status || r.status === 'active');
                        if (activeRooms.length > 0) {
                          joinRoom(activeRooms[Math.floor(Math.random() * activeRooms.length)]);
                        } else {
                          setShowNoRoomsOverlay(true);
                        }
                      }}
                      className="mt-2 w-full py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-white border border-amber-500/20 font-bold text-[8px] transition-all flex items-center justify-center gap-1.5 group/dice md:mt-6 md:py-2.5 md:rounded-xl md:text-xs"
                    >
                      <Dices size={10} className="group-hover/dice:rotate-180 transition-transform duration-500 md:size-14" />
                      <span>Shuffle</span>
                    </button>
                  </div>
                  
                  <div className="order-1 mb-1 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 md:order-2 md:mb-0 md:rounded-2xl md:p-3">
                    <Dices className="h-3.5 w-3.5 text-amber-400 md:h-5 md:w-5" />
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Trending Room Highlight */}
            {trendingRoom && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative group cursor-pointer"
                onClick={() => joinRoom(trendingRoom)}
              >
                <div className="absolute -inset-1 bg-gradient-to-r from-violet-600 to-indigo-600 rounded-[34px] blur opacity-20 group-hover:opacity-40 transition duration-500" />
                <div className="relative p-8 rounded-[32px] bg-[#14142b]/80 border border-white/10 flex flex-col md:flex-row items-center gap-8 overflow-hidden backdrop-blur-xl">
                  {/* Refined Trending Icon */}
                  <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                    <div className="absolute inset-0 bg-violet-400/5 blur-3xl opacity-50" />
                    <div className="relative w-full h-full rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center shadow-2xl backdrop-blur-md group-hover:border-violet-500/30 transition-colors">
                      <Flame size={42} className="text-violet-300 opacity-80" />
                      <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-400/10 via-transparent to-indigo-400/10" />
                    </div>
                  </div>

                  <div className="flex-1 space-y-4">
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-[10px] font-black text-violet-400 uppercase tracking-widest">
                        Trending Now
                      </span>
                      <div className="flex -space-x-2">
                        {[1, 2, 3].map(v => (
                          <div key={v} className="w-6 h-6 rounded-full border border-slate-800 bg-slate-700 flex items-center justify-center text-[8px] font-bold">
                            {String.fromCharCode(64 + v)}
                          </div>
                        ))}
                        <div className="w-6 h-6 rounded-full border border-slate-800 bg-violet-600/50 flex items-center justify-center text-[8px] font-bold">
                          +12
                        </div>
                      </div>
                    </div>
                    <div>
                      <h2 className="text-3xl font-black text-white tracking-tighter mb-2 group-hover:text-violet-400 transition-colors">
                        {trendingRoom.name}
                      </h2>
                      <p className="text-slate-400 text-sm font-medium line-clamp-1 max-w-xl">
                        Hosted by <span className="text-indigo-300">@{trendingRoom.creator_name || 'anonymous'}</span> • Join over {trendingRoom.participantCount || 0} people discussing this topic in real-time.
                      </p>
                    </div>
                  </div>

                  <button className="px-8 py-4 rounded-2xl bg-white text-black font-black text-sm hover:bg-slate-100 active:scale-95 transition-all shadow-xl shadow-white/10 flex items-center gap-3">
                    <Play fill="currentColor" size={16} />
                    QUICK JOIN
                  </button>
                </div>
              </motion.div>
            )}

            {/* Live Hubs Section */}
            <section ref={liveHubsRef} className="space-y-6 scroll-mt-24">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Sparkles size={16} className="text-emerald-400" />
                  </div>
                  <h2 className="text-lg font-black text-white tracking-tight uppercase">Live Hubs</h2>
                </div>
                <div className="h-px flex-1 bg-white/5 mx-6" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Real-time signal</span>
              </div>

              {roomsWithCounts.filter(r => r.status === 'active' || !r.status).length === 0 ? (
                <div className="relative group overflow-hidden rounded-[32px] p-12 text-center border border-white/5 bg-white/[0.02]">
                  <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="w-20 h-20 rounded-full bg-slate-800/50 border border-white/5 flex items-center justify-center mx-auto mb-6">
                    <Mic2 size={32} className="text-slate-600" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-300 mb-2">The Void is Quiet...</h3>
                  <p className="text-slate-500 max-w-sm mx-auto text-sm leading-relaxed">
                    No active discussions found. Start a new voice lounge topic and invite others to join the whisper.
                  </p>
                  <button 
                    onClick={() => setShowCreate(true)}
                    className="mt-8 px-8 py-3 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-sm hover:bg-white/10 transition-all"
                  >
                    Host a Room
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {roomsWithCounts.filter(r => r.status === 'active' || !r.status).map((room, i) => (
                    <motion.div
                      key={room.id}
                      onClick={() => joinRoom(room)}
                      className="group relative p-6 rounded-[32px] bg-[#14142b]/40 border border-white/5 cursor-pointer overflow-hidden backdrop-blur-sm transition-all hover:bg-[#1c1c3d]/60"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      whileHover={{ y: -8 }}>
                      
                      {/* Hover Glow */}
                      <div className="absolute -inset-[2px] bg-gradient-to-r from-violet-600/50 to-indigo-600/50 rounded-[34px] opacity-0 group-hover:opacity-100 blur-[2px] transition-opacity duration-500" />
                      <div className="absolute inset-0 bg-[#0c0c14] rounded-[32px]" />

                      <div className="relative z-10 space-y-5">
                        <div className="flex items-start justify-between">
                          <div className="w-12 h-12 rounded-2xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-500 overflow-hidden">
                            <div className="absolute inset-0 bg-violet-500/5 animate-[pulse_3s_infinite]" />
                            <Mic2 size={24} className="text-violet-400 relative z-10" />
                          </div>
                          <div className="flex items-center gap-2">
                             <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
                              <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Live</span>
                            </div>
                            {profile?.is_admin && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (window.confirm('Delete this voice room permanently?')) {
                                    try {
                                      await deleteDoc(doc(db, 'voice_rooms', room.id));
                                      setRooms(prev => prev.filter(r => r.id !== room.id));
                                    } catch (error: any) { alert('Failed: ' + error.message); }
                                  }
                                }}
                                className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white transition-all shadow-lg"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <h3 className="font-black text-xl text-white tracking-tight line-clamp-1 group-hover:text-violet-400 transition-colors">
                            {room.name}
                          </h3>
                          <div className="flex items-center gap-2 text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                            <Users size={12} />
                            <span>{room.participantCount || 0} LISTENERS</span>
                            <span className="mx-1 opacity-20">•</span>
                            <span>Live Now</span>
                          </div>
                        </div>

                        <div className="pt-2 flex items-center justify-between border-t border-white/5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-white/10 flex items-center justify-center text-[10px] font-bold text-slate-300">
                              {room.creator_name?.slice(0, 1).toUpperCase() || 'V'}
                            </div>
                            <span className="text-[11px] font-bold text-slate-400">@{room.creator_name || 'host'}</span>
                          </div>
                          <div className="flex -space-x-1.5">
                            {[1,2,3].map(v => (
                              <div key={v} className="w-5 h-5 rounded-full border-2 border-[#0c0c14] bg-slate-800" />
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Activity Panel */}
          <div className="lg:col-span-3 space-y-8">
             <div className="sticky top-24 space-y-8">
                {/* Voice Pulse Panel */}
                <div className="p-6 rounded-[32px] bg-[#14142b]/60 border border-white/5 backdrop-blur-md">
                  <div className="flex items-center gap-2 mb-6">
                    <div className="w-6 h-6 rounded bg-violet-500/20 flex items-center justify-center">
                      <Zap size={12} className="text-violet-400" />
                    </div>
                    <h3 className="text-xs font-black text-white tracking-widest uppercase">Voice Pulse</h3>
                  </div>
                  
                  <div className="space-y-6">
                    {activityFeed.map((act, i) => (
                      <motion.div 
                        key={act.id}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="flex gap-4 group cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-full bg-white/5 border border-white/5 flex items-center justify-center shrink-0 group-hover:border-violet-500/50 transition-colors">
                          {act.icon}
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[11px] font-bold text-slate-300 leading-tight group-hover:text-white transition-colors">
                            {act.text}
                          </p>
                          <span className="text-[9px] text-slate-600 font-bold uppercase tracking-wider">{act.time}</span>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  <button 
                    onClick={() => liveHubsRef.current?.scrollIntoView({ behavior: 'smooth' })}
                    className="w-full mt-8 py-3 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all"
                  >
                    View Live Events
                  </button>
                </div>

                {/* Info Card */}
                <div className="p-6 rounded-[32px] bg-gradient-to-br from-blue-600/10 to-violet-600/10 border border-white/5">
                  <h4 className="text-xs font-black text-white uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Sparkles size={14} className="text-blue-400" />
                    Pro Tip
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                    Open discussions with specific topics tend to attract 40% more listeners in the first 10 minutes. 
                  </p>
                </div>
             </div>
          </div>
        </div>

        {/* Universal History Section (Absolute Bottom) */}
        {pastRoomsList.length > 0 && (
          <section className="mt-20 pt-12 border-t border-white/5 space-y-10">
            <div className="flex items-center justify-between opacity-50">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-slate-500/10 border border-slate-500/20 flex items-center justify-center">
                  <History size={20} className="text-slate-400" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white tracking-tight uppercase">Past Dialogues</h2>
                  <p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase mt-1">Recently closed sessions</p>
                </div>
              </div>
              <div className="h-px flex-1 bg-gradient-to-r from-white/5 to-transparent mx-8 hidden md:block" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {pastRoomsList.sort((a,b) => (b.ended_at?.seconds || 0) - (a.ended_at?.seconds || 0)).slice(0, 8).map((room, i) => (
                <div key={room.id}
                  className="group relative p-6 rounded-[2rem] border border-white/5 bg-[#14142b]/40 hover:bg-[#1c1c3d]/60 transition-all opacity-60 hover:opacity-100 glass-hover">
                  <div className="flex items-center justify-between mb-5">
                    <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center grayscale opacity-50 group-hover:grayscale-0 group-hover:opacity-100 transition-all shadow-inner">
                      <Mic2 size={20} className="text-slate-400" />
                    </div>
                    <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest border border-white/10 px-3 py-1.5 rounded-full bg-black/20">Archived</span>
                  </div>
                  <h3 className="font-bold text-slate-200 text-sm mb-3 truncate group-hover:text-white transition-colors">{room.name}</h3>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase tracking-tight pt-4 border-t border-white/5">
                    <div className="flex items-center gap-2">
                       <Clock size={10} className="text-slate-600" />
                       <span>{new Date(room.created_at?.seconds * 1000).toLocaleDateString()}</span>
                    </div>
                    {profile?.is_admin && (
                      <button 
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (window.confirm('Delete archive?')) {
                            try {
                              await deleteDoc(doc(db, 'voice_rooms', room.id));
                              setRooms(prev => prev.filter(r => r.id !== room.id));
                            } catch (error: any) { alert(error.message); }
                          }
                        }} 
                        className="w-8 h-8 flex items-center justify-center rounded-xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <AnimatePresence>
        {showCreate && (
          <motion.div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/80 backdrop-blur-md"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}>
            <motion.div className="relative border border-white/10 rounded-[40px] p-10 w-full max-w-md bg-[#14142b] overflow-hidden"
              initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}>
              
              <div className="absolute top-0 right-0 w-32 h-32 bg-violet-600/20 blur-3xl -translate-y-1/2 translate-x-1/2" />
              
              <div className="relative z-10">
                <motion.div 
                  className="relative w-20 h-20 rounded-[28px] bg-slate-900/40 backdrop-blur-xl border border-violet-500/30 flex items-center justify-center shadow-[0_0_30px_rgba(139,92,246,0.2)] mb-8 mx-auto group"
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                >
                  <div className="absolute inset-0 rounded-[28px] bg-gradient-to-br from-violet-500/20 to-indigo-600/20 opacity-50 transition-opacity" />
                  
                  <div className="absolute left-1 flex items-end gap-[2px] h-6">
                    {[0.4, 0.7, 0.5].map((h, i) => (
                      <motion.div 
                        key={`left-${i}`}
                        className="w-[3px] bg-violet-400 rounded-full"
                        animate={{ height: ["4px", `${h * 20}px`, "4px"] }}
                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.1, ease: "easeInOut" }}
                      />
                    ))}
                  </div>

                  <Mic size={32} className="text-white relative z-10 drop-shadow-[0_0_8px_rgba(167,139,250,0.5)]" />

                  <div className="absolute right-1 flex items-end gap-[2px] h-6">
                    {[0.6, 0.8, 0.4].map((h, i) => (
                      <motion.div 
                        key={`right-${i}`}
                        className="w-[3px] bg-violet-400 rounded-full"
                        animate={{ height: ["4px", `${h * 20}px`, "4px"] }}
                        transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
                      />
                    ))}
                  </div>
                </motion.div>
                
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-black text-white tracking-tighter mb-2">Initialize Voice Field</h2>
                  <p className="text-slate-400 text-sm font-medium">
                    Enter a frequency topic for your anonymous lounge.
                  </p>
                </div>

                <div className="space-y-6">
                  <div className="relative group">
                    <input 
                      type="text" 
                      className="w-full bg-black/40 border-2 border-white/5 rounded-2xl py-4 flex items-center justify-center text-center font-bold text-white placeholder-slate-700 focus:outline-none focus:border-violet-500/50 transition-all"
                      placeholder="e.g. Late Night Philosophies"
                      value={newName} 
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && createRoom()} 
                      autoFocus 
                      maxLength={40} 
                    />
                  </div>

                  <div className="flex gap-4 mt-8">
                     <button 
                      onClick={() => setShowCreate(false)} 
                      className="flex-1 py-4 rounded-2xl bg-slate-800 text-slate-400 font-black text-xs uppercase tracking-widest hover:bg-slate-700 transition-all border border-white/5"
                    >
                      Abort
                    </button>
                    <button 
                      onClick={createRoom} 
                      className="flex-[2] py-4 rounded-2xl bg-white text-black font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all shadow-xl shadow-white/5 disabled:opacity-50"
                      disabled={creating || !newName.trim()}
                    >
                      {creating ? 'SYNCHRONIZING...' : 'START BROADCAST'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showNoRoomsOverlay && (
          <motion.div 
            className="fixed inset-0 z-[110] flex items-center justify-center px-4 bg-black/80 backdrop-blur-xl"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowNoRoomsOverlay(false); }}
          >
            <motion.div 
              className="relative border border-white/10 rounded-[40px] p-10 w-full max-w-lg bg-[#14142b]/90 overflow-hidden text-center"
              initial={{ scale: 0.9, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 30 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 blur-3xl -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-amber-500/5 blur-3xl translate-y-1/2 -translate-x-1/2" />

              <div className="relative z-10 space-y-8">
                <div className="w-20 h-20 rounded-[28px] bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-2xl shadow-amber-500/20 mx-auto">
                  <Dices size={40} className="text-white" />
                </div>

                <div className="space-y-3">
                  <h2 className="text-3xl font-black text-white tracking-tighter">The Void is Quiet...</h2>
                  <p className="text-slate-400 text-base font-medium max-w-sm mx-auto">
                    No active voice rooms were found. Be the first to break the silence and start a conversation.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 pt-4">
                  <button 
                    onClick={() => setShowNoRoomsOverlay(false)} 
                    className="flex-1 py-4 rounded-2xl bg-white/5 text-slate-400 font-black text-xs uppercase tracking-widest hover:bg-white/10 transition-all border border-white/5 active:scale-95"
                  >
                    Maybe Later
                  </button>
                  <button 
                    onClick={() => {
                      setShowNoRoomsOverlay(false);
                      setShowCreate(true);
                    }} 
                    className="flex-[2] py-4 rounded-2xl bg-amber-500 text-black font-black text-xs uppercase tracking-widest hover:bg-amber-400 transition-all shadow-xl shadow-amber-500/20 active:scale-95"
                  >
                    Initialize Voice Field
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden container for remote WebRTC audio elements (Fallback) */}
      <div id="remote-audio-container" style={{ display: 'none' }} />
    </div>
  );
}

