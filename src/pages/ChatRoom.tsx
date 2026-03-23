import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  getDoc, 
  getDocs,
  serverTimestamp,
  setDoc,
  deleteDoc,
  limit
} from 'firebase/firestore';
import { 
  ref, 
  onValue, 
  set as rtdbSet, 
  onDisconnect, 
  push,
  onChildAdded,
  remove as rtdbRemove
} from 'firebase/database';
import { db, rtdb } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';
import { AlertTriangle, Users, Settings, Info, ChevronLeft, Smile, Paperclip, Activity, History, ShieldCheck, MoreVertical, Send, Reply as ReplyIcon, ShieldAlert, X } from 'lucide-react';
import { containsInappropriateContent } from '../lib/filter';
import ReportModal from '../components/ReportModal';
import { toast } from 'sonner';
import { useSystemConfig } from '../hooks/useSystemConfig';
import { sanitizeContent } from '../lib/sanitize';
import VoidBackground from '../components/VoidBackground';

interface Message {
  id: string; content: string; created_at: any;
  user_id: string; anonymous_username: string; optimistic?: boolean;
}
interface TypingUser { id: string; username: string; }
interface RoomMember { user_id: string; role: string; anonymous_username: string; }

const EMOJI_REACTIONS = ['❤️', '😂', '🔥', '👀', '😮', '👍'];
const COLORS = ['#7c3aed','#0891b2','#059669','#d97706','#dc2626','#be185d','#4338ca','#7c3aed'];
const getColor = (s: string) => {
  if (!s) return COLORS[0];
  const charSum = (s.charCodeAt(0) || 0) + (s.charCodeAt(1) || 0);
  return COLORS[charSum % COLORS.length];
};
const getInitials = (s: string) => (s || '??').slice(0, 2).toUpperCase();

export default function ChatRoom() {
  const { id: roomId } = useParams<{ id: string }>();
  const { user, profile, loading } = useAuth();
  const { config } = useSystemConfig();
  const safeMode = config.safeMode && !profile?.is_admin;
  const { markAsActive } = useNotifications();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<Message[]>([]);
  const [roomName, setRoomName] = useState('');
  const [roomCategory, setRoomCategory] = useState('');
  const [isArchived, setIsArchived] = useState(false);
  const [onlyAdminsCanMessage, setOnlyAdminsCanMessage] = useState(false);
  const [roomCreatorId, setRoomCreatorId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>('member');
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [userRoles, setUserRoles] = useState<Map<string, string>>(new Map());
  const [onlineCount, setOnlineCount] = useState(1);
  const [text, setText] = useState('');
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>({});
  const [picker, setPicker] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [reportingContent, setReportingContent] = useState<{ type: 'message' | 'user'; id: string } | null>(null);

  // Auto-show sidebar on desktop
  useEffect(() => {
    const checkWidth = () => {
      if (window.innerWidth >= 1280) {
        setShowInfo(true);
        setShowMembers(true);
      } else if (window.innerWidth >= 1024) {
        setShowInfo(true);
        setShowMembers(false);
      } else {
        setShowInfo(false);
        setShowMembers(false);
      }
    };
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameCache = useRef<Map<string, string>>(new Map());
  const sending = useRef(false);

  useEffect(() => { if (!loading && !user) navigate('/join'); }, [user, loading, navigate]);

  useEffect(() => {
    if (user && roomId) {
      markAsActive(roomId);
      return () => markAsActive(null);
    }
  }, [user, roomId, markAsActive]);

  useEffect(() => {
    if (!roomId) return;
    const roomRef = doc(db, 'chat_rooms', roomId);
    return onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const roomData = snapshot.data();
        setRoomName(roomData.name);
        setRoomCategory(roomData.category);
        setOnlyAdminsCanMessage(roomData.only_admins_can_message);
        setIsArchived(roomData.is_archived || false);
        setRoomCreatorId(roomData.created_by);
      }
    });
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !user || !profile) return;
    const loadUserRoleAndMembers = async () => {
      const memberQuery = query(collection(db, 'room_members'), where('room_id', '==', roomId), where('user_id', '==', user.uid));
      const memberSnapshot = await getDocs(memberQuery);
      let finalRole = 'member';
      if (memberSnapshot.empty) {
        await addDoc(collection(db, 'room_members'), {
          room_id: roomId,
          user_id: user.uid,
          role: 'member',
          anonymous_username: profile.anonymous_username,
          joined_at: serverTimestamp()
        });
      } else {
        finalRole = memberSnapshot.docs[0].data().role;
      }
      setUserRole(finalRole);
      const allMembersQuery = query(collection(db, 'room_members'), where('room_id', '==', roomId), limit(100));
      return onSnapshot(allMembersQuery, (snapshot) => {
        const rolesMap = new Map<string, string>();
        const membersList: RoomMember[] = [];
        const seen = new Set<string>();
        snapshot.forEach((doc) => {
          const m = doc.data();
          if (seen.has(m.user_id)) return;
          seen.add(m.user_id);
          rolesMap.set(m.user_id, m.role);
          membersList.push({
            user_id: m.user_id,
            role: m.role,
            anonymous_username: m.anonymous_username || 'Anonymous'
          });
          nameCache.current.set(m.user_id, m.anonymous_username || 'Anonymous');
        });
        setMembers(membersList);
        setUserRoles(rolesMap);
      });
    };
    let isMounted = true;
    let unsub: (() => void) | undefined;
    loadUserRoleAndMembers().then(u => {
      if (isMounted) unsub = u;
      else u?.();
    });
    return () => { 
      isMounted = false; 
      if (unsub) unsub(); 
    };
  }, [roomId, user, profile]);

  useEffect(() => {
    if (!roomId || !user) return;
    const q = query(collection(db, 'messages'), where('room_id', '==', roomId));
    return onSnapshot(q, (snapshot) => {
      const dbMessages: Message[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        dbMessages.push({ 
          id: doc.id, 
          ...data,
          anonymous_username: nameCache.current.get(data.user_id) || data.anonymous_username || 'Anonymous'
        } as Message);
      });
      const sorted = dbMessages.sort((a, b) => {
          const timeA = a.created_at?.toMillis?.() || a.created_at?.seconds * 1000 || Date.now();
          const timeB = b.created_at?.toMillis?.() || b.created_at?.seconds * 1000 || Date.now();
          return timeA - timeB;
      }).slice(-100);
      setMessages(sorted);
    });
  }, [roomId, user]);

  const [onlineUsers, setOnlineUsers] = useState<TypingUser[]>([]);
  const [fluxLogs, setFluxLogs] = useState<{ id: string; text: string; color: string }[]>([]);

  useEffect(() => {
    if (!roomId || !user || !profile || isArchived) return;
    const presenceRef = ref(rtdb, `rooms/${roomId}/presence/${user.uid}`);
    const typingRef = ref(rtdb, `rooms/${roomId}/typing/${user.uid}`);
    const roomPresenceRef = ref(rtdb, `rooms/${roomId}/presence`);
    const roomTypingRef = ref(rtdb, `rooms/${roomId}/typing`);
    const roomReactionsRef = ref(rtdb, `rooms/${roomId}/reactions`);
    const fluxRef = ref(rtdb, `rooms/${roomId}/flux`);
    
    // Manifested Log
    const manifestRef = push(fluxRef);
    rtdbSet(manifestRef, {
      text: `${profile.anonymous_username} manifested.`,
      color: 'text-emerald-400',
      timestamp: Date.now()
    });

    rtdbSet(presenceRef, {
      user_id: user.uid,
      username: profile.anonymous_username,
      online_at: new Date().toISOString()
    });
    onDisconnect(presenceRef).remove();
    
    const unsubPresence = onValue(roomPresenceRef, (snapshot) => {
      const data = snapshot.val() || {};
      const online: TypingUser[] = Object.entries(data).map(([uid, val]: [string, any]) => ({
        id: uid,
        username: val.username
      }));
      setOnlineUsers(online);
      setOnlineCount(online.length || 1);
    });

    const unsubTyping = onValue(roomTypingRef, (snapshot) => {
      const data = snapshot.val() || {};
      const typers: TypingUser[] = [];
      Object.entries(data).forEach(([uid, val]: [string, any]) => {
        if (uid !== user.uid) {
          typers.push({ id: uid, username: val.username });
        }
      });
      setTypingUsers(typers);
    });

    const unsubReactions = onValue(roomReactionsRef, (snapshot) => {
      const data = snapshot.val() || {};
      setReactions(data);
    });

    const unsubFlux = onValue(fluxRef, (snapshot) => {
      const data = snapshot.val() || {};
      const logs = Object.entries(data)
        .map(([id, val]: [string, any]) => ({ id, ...val }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5);
      setFluxLogs(logs);
    });

    return () => {
      rtdbRemove(presenceRef);
      rtdbRemove(typingRef);
      unsubPresence();
      unsubTyping();
      unsubReactions();
      unsubFlux();
    };
  }, [roomId, user, profile, isArchived]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const emitTyping = useCallback(() => {
    if (!roomId || !user || !profile || isArchived) return;
    const typingRef = ref(rtdb, `rooms/${roomId}/typing/${user.uid}`);
    rtdbSet(typingRef, { username: profile.anonymous_username });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      rtdbRemove(typingRef);
    }, 2000);
  }, [roomId, user, profile, isArchived]);

  const sendMessage = useCallback(async () => {
    const content = text.trim();
    if (!content || !user || !roomId || !profile || sending.current || isArchived || safeMode) return;
    if (onlyAdminsCanMessage && !['creator', 'admin'].includes(userRole)) return;
    if (containsInappropriateContent(content).matches) {
      toast.error('Your message contains inappropriate content.');
      return;
    }
    sending.current = true;
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Message = {
      id: tempId, content, user_id: user.uid, anonymous_username: profile.anonymous_username,
      created_at: { toDate: () => new Date() }, optimistic: true
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setText('');
    const typingRef = ref(rtdb, `rooms/${roomId}/typing/${user.uid}`);
    rtdbRemove(typingRef);
    try {
      await addDoc(collection(db, 'messages'), {
        content, user_id: user.uid, room_id: roomId,
        anonymous_username: profile.anonymous_username, created_at: serverTimestamp()
      });

      // Flux Log: Transmission
      const fluxRef = ref(rtdb, `rooms/${roomId}/flux`);
      const transmissionRef = push(fluxRef);
      rtdbSet(transmissionRef, {
        text: `${profile.anonymous_username} transmitted.`,
        color: 'text-violet-400',
        timestamp: Date.now()
      });
    } catch (error) {
      toast.error("Failed to send message");
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setText(content);
    } finally {
      sending.current = false;
    }
  }, [text, user, roomId, profile, isArchived, onlyAdminsCanMessage, userRole, safeMode]);

  const reactToMessage = useCallback((msgId: string, emoji: string) => {
    if (!user || !roomId || isArchived || safeMode) return;
    setPicker(null);
    const reactionRef = ref(rtdb, `rooms/${roomId}/reactions/${msgId}/${emoji}`);
    onValue(reactionRef, (snapshot) => {
      const uids = snapshot.val() || [];
      if (!uids.includes(user.uid)) {
        rtdbSet(reactionRef, [...uids, user.uid]);
      }
    }, { onlyOnce: true });
  }, [user, roomId, isArchived, safeMode]);

  const grouped = messages.map((msg, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    return {
      ...msg,
      isFirst: !prev || prev.user_id !== msg.user_id,
      isLast: !next || next.user_id !== msg.user_id,
    };
  });

  const typingText = typingUsers.length === 0 ? null
    : typingUsers.length === 1 ? `${typingUsers[0].username} is typing...`
    : `${typingUsers.length} entities are typing...`;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07070f]">
        <VoidBackground />
        <div className="w-12 h-12 border-4 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col relative overflow-hidden bg-[#07070f] text-slate-200" onClick={() => { setPicker(null); setShowEmojiPicker(false); }}>
      <VoidBackground />
      
      {/* Top Header */}
      <header className="h-16 shrink-0 z-50 glass-premium border-b border-white/5 flex items-center justify-between px-6">
        <div className="flex items-center gap-2 sm:gap-4">
          <Link to="/chat-center" className="hover:scale-110 transition-transform">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl glass-premium flex items-center justify-center hover:bg-white/10">
              <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400" />
            </div>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-lg font-bold tracking-tight text-white glow-text-violet truncate max-w-[120px] sm:max-w-none">
                {roomName || 'Void Chamber'}
              </h1>
              <span className="text-[8px] sm:text-[10px] font-black bg-violet-500/20 text-violet-400 px-1.5 sm:px-2 py-0.5 rounded-full border border-violet-500/20 uppercase tracking-widest leading-none shrink-0">
                {roomCategory || 'Lobby'}
              </span>
            </div>
            <p className="text-[9px] sm:text-[10px] text-emerald-400 font-bold flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              {onlineCount} ENTITIES
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={() => { setShowInfo(!showInfo); if (!showInfo && window.innerWidth < 1024) setShowMembers(false); }} 
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center transition-all ${showInfo ? 'bg-violet-500/20 text-violet-400' : 'glass-premium text-slate-400 hover:text-white'}`}>
            <Info className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <button onClick={() => { setShowMembers(!showMembers); if (!showMembers && window.innerWidth < 1024) setShowInfo(false); }} 
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center transition-all ${showMembers ? 'bg-cyan-500/20 text-cyan-400' : 'glass-premium text-slate-400 hover:text-white'}`}>
            <Users className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          {(['creator', 'admin'].includes(userRole) || profile?.is_admin) && (
            <button onClick={() => setShowSettings(true)} className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl glass-premium text-slate-400 hover:text-white flex items-center justify-center transition-all">
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile Backdrop */}
        <AnimatePresence>
          {(showInfo || showMembers) && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => { 
                if (window.innerWidth < 1024) setShowInfo(false); 
                if (window.innerWidth < 1280) setShowMembers(false); 
              }}
              className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-30"
            />
          )}
        </AnimatePresence>

        {/* Left Panel: Room Info */}
        <AnimatePresence>
          {showInfo && (
            <motion.aside
              initial={{ x: -400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -400, opacity: 0 }}
              className="fixed lg:relative top-0 bottom-0 left-0 w-[280px] lg:w-72 flex flex-col glass-premium border-r border-white/5 lg:m-4 lg:rounded-[2rem] p-6 pt-20 lg:pt-6 space-y-8 z-40"
            >
              <div className="flex items-center justify-between lg:hidden mb-4">
                <h2 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Dimensions</h2>
                <button onClick={() => setShowInfo(false)} className="w-8 h-8 rounded-full glass-premium flex items-center justify-center text-slate-400"><X className="w-4 h-4" /></button>
              </div>
              <div>
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4">Space Genesis</h3>
                <div className="glass-premium rounded-2xl p-4 border-white/5">
                  <p className="text-xs text-slate-400 leading-relaxed italic">
                    "This chamber was manifested to facilitate anonymous discourse within the {roomCategory} frequency."
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Protocol</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 p-2 rounded-xl glass-premium border-white/5">
                    <ShieldCheck className="w-4 h-4 text-violet-400" />
                    <span className="text-xs font-medium">Encryption Active</span>
                  </div>
                  <div className="flex items-center gap-3 p-2 rounded-xl glass-premium border-white/5">
                    <History className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-medium">Auto-purge Enabled</span>
                  </div>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Center: Chat Window */}
        <main className="flex-1 flex flex-col items-center relative z-10 px-4">
          <div className="w-full max-w-2xl flex-col h-full flex pt-6 pb-4">
            {/* Scrollable Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar-voice pb-24 pr-2">
              <AnimatePresence initial={false}>
                {messages.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4"
                  >
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl sm:rounded-[2.5rem] glass-premium flex items-center justify-center text-3xl sm:text-4xl animate-pulse">
                      🛸
                    </div>
                    <p className="font-bold tracking-widest text-[10px] uppercase text-center">The void is silent...</p>
                  </motion.div>
                ) : (
                  grouped.map((msg, index) => {
                    const isMe = msg.user_id === user?.uid;
                    const color = getColor(msg.anonymous_username);
                    const msgReactions = reactions[msg.id] ?? {};
                    const role = userRoles.get(msg.user_id);

                    return (
                      <motion.div 
                        key={msg.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className={`flex gap-2.5 px-1 ${isMe ? 'flex-row-reverse' : 'flex-row'} ${msg.isFirst ? 'mt-1.5' : 'mt-[2px]'}`}
                      >
                        {/* Avatar Column */}
                        <div className="w-7 shrink-0">
                          {msg.isFirst ? (
                            <div 
                              className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black text-white relative group transition-all ring-1 ring-white/10"
                              style={{ background: `linear-gradient(135deg, ${color}, ${color}dd)` }}
                            >
                              {getInitials(msg.anonymous_username)}
                              {!isMe && (
                                <div className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-500 rounded-full border border-[#07070f]" />
                              )}
                            </div>
                          ) : (
                            <div className="w-7" />
                          )}
                        </div>

                        {/* Message Block Column */}
                        <div className={`flex flex-col max-w-[65%] ${isMe ? 'items-end' : 'items-start'}`}>
                          {msg.isFirst && (
                            <div className={`flex items-center gap-1.5 mb-1 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                              <span className={`text-[10px] font-bold uppercase tracking-widest ${isMe ? 'text-violet-400/80' : 'text-slate-500'}`}>
                                {msg.anonymous_username}
                              </span>
                              {role === 'creator' && <span className="text-[6px] font-black px-1 py-0.5 rounded bg-yellow-400/5 text-yellow-400/60 border border-yellow-400/10">MASTER_ENTITY</span>}
                            </div>
                          )}

                          <div className="group relative">
                            <motion.div
                              className={`
                                px-3 py-1.5 text-[13px] leading-[1.4] relative transition-all duration-150
                                ${isMe
                                  ? 'bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 text-[#ede9fe] backdrop-blur-md'
                                  : 'bg-white/5 border border-white/10 text-slate-100 backdrop-blur-md'
                                }
                                ${msg.optimistic ? 'opacity-50' : 'opacity-100'}
                                ${isMe 
                                  ? 'rounded-[14px_10px_10px_14px]' 
                                  : 'rounded-[10px_14px_14px_10px]'
                                }
                                hover:border-white/20
                              `}
                            >
                              <div 
                                dangerouslySetInnerHTML={{ __html: sanitizeContent(msg.content) }}
                                className="break-words select-text"
                              />
                            </motion.div>

                            {/* Hover Actions Dock - Even more compact */}
                            <div className={`
                              absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-150 z-20 flex items-center gap-1 scale-90 group-hover:scale-100
                              ${isMe ? 'right-full mr-2' : 'left-full ml-2'}
                            `}>
                              <button 
                                onClick={(e) => { e.stopPropagation(); setPicker(msg.id); }}
                                className="w-6 h-6 rounded-md glass-premium border border-white/5 flex items-center justify-center hover:bg-white/10 text-slate-500 hover:text-white transition-colors"
                              >
                                <Smile className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Reaction Picker - Faster transition */}
                            <AnimatePresence>
                              {picker === msg.id && (
                                <motion.div
                                  initial={{ opacity: 0, scale: 0.98 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.98 }}
                                  className={`absolute z-30 -top-10 glass-premium border border-white/10 rounded-lg p-1 flex gap-0.5 shadow-2xl ${isMe ? 'right-0' : 'left-0'}`}
                                  onClick={e => e.stopPropagation()}
                                >
                                  {EMOJI_REACTIONS.map(emoji => (
                                    <button 
                                      key={emoji} 
                                      onClick={() => reactToMessage(msg.id, emoji)}
                                      className="w-7 h-7 flex items-center justify-center hover:bg-white/10 rounded-md transition-transform hover:scale-110"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>

                          {/* Reactions Display - Compact */}
                          {Object.keys(msgReactions).length > 0 && (
                            <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                              {Object.entries(msgReactions).map(([emoji, who]) => {
                                const hasReacted = (who as string[]).includes(user?.uid || '');
                                return (
                                  <button
                                    key={emoji}
                                    onClick={(e) => { e.stopPropagation(); reactToMessage(msg.id, emoji); }}
                                    className={`
                                      flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold transition-all border
                                      ${hasReacted 
                                        ? 'bg-violet-500/10 border-violet-500/20 text-violet-300' 
                                        : 'bg-white/5 border-white/10 text-slate-500 hover:border-white/20'}
                                    `}
                                  >
                                    <span>{emoji}</span>
                                    <span className="opacity-60">{(who as string[]).length}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Simplified Delivered Check */}
                          {isMe && msg.isLast && !msg.optimistic && (
                            <div className="mt-0.5 px-1 text-[8px] font-bold text-slate-600 uppercase tracking-tighter">
                              Delivered
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
              <div ref={bottomRef} />
            </div>

            {/* Floating Input Dock */}
            <div className="absolute bottom-4 sm:bottom-6 left-0 right-0 flex flex-col gap-2 z-20">
              <AnimatePresence>
                {typingText && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                    className="flex justify-center px-4"
                  >
                    <div className="glass-premium rounded-full px-3 py-1 sm:px-4 sm:py-1.5 border-white/5 flex items-center gap-2 sm:gap-3">
                      <div className="flex gap-1">
                        <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-violet-400 rounded-full animate-bounce" />
                      </div>
                      <span className="text-[8px] sm:text-[10px] font-bold text-slate-300 uppercase tracking-widest">{typingText}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="relative glass-premium rounded-2xl sm:rounded-[2.5rem] p-1.5 sm:p-2 border-white/10 group focus-within:border-violet-500/50 focus-within:shadow-[0_0_30px_rgba(139,92,246,0.15)] transition-all mx-2 sm:mx-0">
                {(isArchived || safeMode) && (
                  <div className="absolute inset-0 z-20 bg-black/80 rounded-2xl sm:rounded-[2.5rem] flex items-center justify-center backdrop-blur-sm">
                    <div className="flex items-center gap-2 text-red-400 text-[8px] sm:text-[10px] font-black uppercase tracking-widest">
                       {safeMode ? <ShieldAlert className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <History className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                       {safeMode ? 'Safe Mode Restricted' : 'Chamber Deactivated'}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-1 sm:gap-2 px-1 sm:px-2">
                  <button className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-slate-500 hover:text-cyan-400 transition-colors">
                    <Paperclip className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                  <input
                    type="text"
                    value={text}
                    onChange={e => { setText(e.target.value); if (e.target.value) emitTyping(); }}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder={isArchived ? "Archived" : "Transmit..."}
                    className="flex-1 bg-transparent border-0 outline-none text-sm sm:text-[15px] placeholder:text-slate-600 py-2 sm:py-3"
                    disabled={safeMode || isArchived}
                  />
                  <div className="flex items-center gap-0.5 sm:gap-1 relative">
                    <button 
                      onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(!showEmojiPicker); }}
                      className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors ${showEmojiPicker ? 'text-yellow-400 bg-yellow-400/10' : 'text-slate-500 hover:text-yellow-400'}`}
                    >
                      <Smile className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                    
                    <AnimatePresence>
                      {showEmojiPicker && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: 10 }}
                          className="absolute bottom-full right-0 mb-4 z-50 p-2 glass-premium border border-white/10 rounded-2xl shadow-2xl min-w-[200px]"
                        >
                          <div className="grid grid-cols-6 gap-1">
                            {['❤️', '😂', '🔥', '👀', '😮', '👍', '✨', '🙌', '💯', '🚀', '💀', '🎉', '💜', '💙', '✅', '❌', '🤔', '😎'].map(emoji => (
                              <button
                                key={emoji}
                                onClick={() => {
                                  setText(prev => prev + emoji);
                                  setShowEmojiPicker(false);
                                }}
                                className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-lg transition-transform hover:scale-125 active:scale-90 text-lg"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <motion.button
                      onClick={sendMessage}
                      whileTap={{ scale: 0.9 }}
                      disabled={!text.trim() || safeMode || isArchived}
                      className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-violet-500 to-violet-700 text-white shadow-lg shadow-violet-500/20 disabled:scale-90 disabled:opacity-0 transition-all"
                    >
                      <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </motion.button>
                  </div>
                </div>
              </div>
              <div className="text-center">
                <span className="text-[8px] sm:text-[9px] font-bold text-slate-600 uppercase tracking-[0.3em]">Enter to Transmit</span>
              </div>
            </div>
          </div>
        </main>

        {/* Right Panel: Presence & Activity */}
        <AnimatePresence>
          {showMembers && (
            <motion.aside
              initial={{ x: 400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 400, opacity: 0 }}
              className="fixed lg:relative top-0 bottom-0 right-0 w-[280px] lg:w-72 flex flex-col glass-premium border-l border-white/5 lg:m-4 lg:rounded-[2rem] p-6 pt-20 lg:pt-6 space-y-8 z-40"
            >
              <div className="flex-1 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between mb-4 lg:mb-6">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Active Entities</h3>
                  <button onClick={() => setShowMembers(false)} className="w-8 h-8 rounded-full glass-premium flex items-center justify-center text-slate-400 lg:hidden"><X className="w-4 h-4" /></button>
                  <Activity className="hidden lg:block w-3 h-3 text-emerald-400 animate-pulse" />
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar-voice space-y-3">
                  {onlineUsers.map(online => (
                    <motion.div 
                      key={online.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-3 p-2.5 rounded-2xl glass-premium border-white/5 hover:bg-white/5 transition-colors group cursor-default"
                    >
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black text-white"
                        style={{ background: getColor(online.username) }}>
                        {getInitials(online.username)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
                          {online.username}
                        </div>
                      </div>
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="h-48 border-t border-white/5 pt-6">
                 <div className="flex items-center gap-2 mb-4">
                    <History className="w-4 h-4 text-slate-500" />
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Flux Log</h3>
                 </div>
                 <div className="space-y-3 opacity-50 grayscale hover:grayscale-0 hover:opacity-100 transition-all">
                    {fluxLogs.map(log => (
                      <p key={log.id} className="text-[10px] font-medium leading-relaxed">
                        {log.text.split(' ').map((word, i) => (
                           <span key={i} className={i === 0 ? log.color : ''}>{word} </span>
                        ))}
                      </p>
                    ))}
                    {fluxLogs.length === 0 && <p className="text-[10px] text-slate-600 italic">No recent activity</p>}
                 </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showSettings && (
          <motion.div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/80 backdrop-blur-md"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
            <motion.div className="glass-premium border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-10 w-full max-w-lg shadow-[0_0_100px_rgba(0,0,0,0.5)]"
              initial={{ scale: 0.9, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}>
              <h2 className="text-xl sm:text-2xl font-black text-white mb-6 sm:mb-8 tracking-tighter uppercase">Chamber configuration</h2>
              <div className="space-y-6">
                <div className="glass-premium p-4 rounded-xl sm:rounded-2xl border-white/5">
                  <label className="flex items-center justify-between cursor-pointer group">
                    <div className="space-y-1">
                      <span className="text-sm font-bold text-white group-hover:text-violet-400 transition-colors">Restrict Transmission</span>
                      <p className="text-[10px] text-slate-500 font-medium">Only Masters and Overseers.</p>
                    </div>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={onlyAdminsCanMessage}
                        onChange={async (e) => {
                          const newValue = e.target.checked;
                          if (!roomId) return;
                          await updateDoc(doc(db, 'chat_rooms', roomId), { only_admins_can_message: newValue });
                          setOnlyAdminsCanMessage(newValue);
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-400 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
                    </div>
                  </label>
                </div>
                {(userRole === 'creator' || profile?.is_admin) && !isArchived && (
                  <div className="pt-6 border-t border-white/5 space-y-4">
                    <h3 className="text-[10px] font-black text-red-500 uppercase tracking-[0.2em]">Danger Zone</h3>
                    <button 
                      onClick={async () => {
                        if(window.confirm('Initiate deactivation?')) {
                          if (!roomId) return;
                          try {
                            await updateDoc(doc(db, 'chat_rooms', roomId), { is_archived: true });
                            navigate('/chat-center');
                          } catch (error) {
                            toast.error('Failed to archive chamber');
                          }
                        }
                      }}
                      className="w-full bg-red-500/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-500/20 py-3 sm:py-4 rounded-xl sm:rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">
                      DEACTIVATE CHAMBER
                    </button>
                  </div>
                )}
              </div>
              <button onClick={() => setShowSettings(false)} className="mt-8 w-full py-3 sm:py-4 rounded-xl sm:rounded-2xl font-black text-[10px] uppercase tracking-widest glass-premium border-white/10 hover:bg-white/5 transition-all">
                ABORT CONFIG
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ReportModal 
        isOpen={!!reportingContent}
        onClose={() => setReportingContent(null)}
        targetType={reportingContent?.type || 'message'}
        targetId={reportingContent?.id || ''}
      />
    </div>
  );
}
