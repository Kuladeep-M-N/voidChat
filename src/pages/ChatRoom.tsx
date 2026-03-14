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
import { AlertTriangle } from 'lucide-react';
import { containsInappropriateContent } from '../lib/filter';
import ReportModal from '../components/ReportModal';
import { toast } from 'sonner';

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
  const [showSettings, setShowSettings] = useState(false);
  const [reportingContent, setReportingContent] = useState<{ type: 'message' | 'user'; id: string } | null>(null);

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

  // ── Fetch room data ──
  useEffect(() => {
    if (!roomId) return;

    const roomRef = doc(db, 'chat_rooms', roomId);
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const roomData = snapshot.data();
        setRoomName(roomData.name);
        setRoomCategory(roomData.category);
        setOnlyAdminsCanMessage(roomData.only_admins_can_message);
        setIsArchived(roomData.is_archived || false);
        setRoomCreatorId(roomData.created_by);
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  // ── Fetch user role and all members ──
  useEffect(() => {
    if (!roomId || !user || !profile) return;

    const loadUserRoleAndMembers = async () => {
      // 1. Fetch User Role
      const memberQuery = query(collection(db, 'room_members'), where('room_id', '==', roomId), where('user_id', '==', user.uid));
      const memberSnapshot = await getDocs(memberQuery);
      
      let finalRole = 'member';
      if (memberSnapshot.empty) {
        // Auto-join
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

      // 2. Fetch All Members (limited to prevent massive payload)
      const allMembersQuery = query(collection(db, 'room_members'), where('room_id', '==', roomId), limit(100));
      const unsubscribeMembers = onSnapshot(allMembersQuery, (snapshot) => {
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
      return unsubscribeMembers;
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

  // ── Realtime Messages ──
  useEffect(() => {
    if (!roomId || !user) return;

    const q = query(
      collection(db, 'messages'), 
      where('room_id', '==', roomId)
      // orderBy removed to avoid composite index requirement
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const dbMessages: Message[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        dbMessages.push({ 
          id: doc.id, 
          ...data,
          anonymous_username: nameCache.current.get(data.user_id) || data.anonymous_username || 'Anonymous'
        } as Message);
      });
      
      // Sort in memory and limit to latest 100
      const sorted = dbMessages.sort((a, b) => {
          const timeA = a.created_at?.toMillis?.() || a.created_at?.seconds * 1000 || Date.now();
          const timeB = b.created_at?.toMillis?.() || b.created_at?.seconds * 1000 || Date.now();
          
          if (timeA === timeB) return 0;
          return timeA - timeB;
      }).slice(-100);
      
      setMessages(sorted);
    }, (err) => {
      console.error("Messages sync error:", err);
    });

    return () => unsubscribe();
  }, [roomId, user]);

  // ── Realtime Presence / Typing / Reactions (RTDB) ──
  useEffect(() => {
    if (!roomId || !user || !profile || isArchived) return;

    const presenceRef = ref(rtdb, `rooms/${roomId}/presence/${user.uid}`);
    const typingRef = ref(rtdb, `rooms/${roomId}/typing/${user.uid}`);
    const roomPresenceRef = ref(rtdb, `rooms/${roomId}/presence`);
    const roomTypingRef = ref(rtdb, `rooms/${roomId}/typing`);
    const roomReactionsRef = ref(rtdb, `rooms/${roomId}/reactions`);

    // Presence
    rtdbSet(presenceRef, {
      user_id: user.uid,
      username: profile.anonymous_username,
      online_at: new Date().toISOString()
    });
    onDisconnect(presenceRef).remove();

    const unsubPresence = onValue(roomPresenceRef, (snapshot) => {
      const data = snapshot.val() || {};
      setOnlineCount(Object.keys(data).length || 1);
    });

    // Typing
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

    // Reactions
    const unsubReactions = onValue(roomReactionsRef, (snapshot) => {
      const data = snapshot.val() || {};
      setReactions(data);
    });

    return () => {
      rtdbRemove(presenceRef);
      rtdbRemove(typingRef);
      unsubPresence();
      unsubTyping();
      unsubReactions();
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
    if (!content || !user || !roomId || !profile || sending.current || isArchived) return;

    // Check permissions
    if (onlyAdminsCanMessage && !['creator', 'admin'].includes(userRole)) return;

    if (containsInappropriateContent(content).matches) {
      toast.error('Your message contains inappropriate content and cannot be sent.');
      return;
    }

    sending.current = true;
    
    // Optimistic Update
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Message = {
      id: tempId,
      content,
      user_id: user.uid,
      anonymous_username: profile.anonymous_username,
      created_at: { toDate: () => new Date() }, // Mock timestamp
      optimistic: true
    };
    
    setMessages(prev => [...prev, optimisticMsg]);
    setText('');
    
    const typingRef = ref(rtdb, `rooms/${roomId}/typing/${user.uid}`);
    rtdbRemove(typingRef);

    try {
      await addDoc(collection(db, 'messages'), {
        content,
        user_id: user.uid,
        room_id: roomId,
        anonymous_username: profile.anonymous_username, // Denormalize name for instant display
        created_at: serverTimestamp()
      });
    } catch (error) {
      console.error("Failed to send message:", error);
      toast.error("Failed to send message");
      // Remove optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setText(content); // Restore text
    } finally {
      sending.current = false;
    }
  }, [text, user, roomId, profile, isArchived, onlyAdminsCanMessage, userRole]);

  const reactToMessage = useCallback((msgId: string, emoji: string) => {
    if (!user || !roomId || isArchived) return;
    setPicker(null);
    
    const reactionRef = ref(rtdb, `rooms/${roomId}/reactions/${msgId}/${emoji}`);
    onValue(reactionRef, (snapshot) => {
      const uids = snapshot.val() || [];
      if (!uids.includes(user.uid)) {
        rtdbSet(reactionRef, [...uids, user.uid]);
      }
    }, { onlyOnce: true });
  }, [user, roomId, isArchived]);

  // Group consecutive messages by user
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
    : `${typingUsers.length} people are typing...`;

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  return (
    <div className="h-screen flex bg-[#07070f]" onClick={() => setPicker(null)}>
      {/* Main Chat Area */}
      <div className={`flex flex-col ${showMembers ? 'flex-1' : 'w-full'}`}>
      {/* Header */}
      <header className="border-b border-white/5 glass shrink-0 z-50">
        <div className="max-w-3xl mx-auto flex items-center gap-3 px-4 py-3">
          <Link to="/chat-center">
            <button className="btn-ghost rounded-xl p-2 text-slate-400 shrink-0">←</button>
          </Link>
          <div className="w-9 h-9 rounded-full bg-violet-500/30 border border-violet-500/40 flex items-center justify-center font-bold text-violet-300 shrink-0">
            {roomName ? roomName[0].toUpperCase() : '#'}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-white leading-tight flex items-center gap-2">
              {roomName || <span className="text-slate-500">Loading...</span>}
              {isArchived && <span className="text-[9px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest border border-red-500/20">Archived</span>}
            </h1>
            <p className={`text-xs flex items-center gap-1 ${isArchived ? 'text-slate-500' : 'text-emerald-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isArchived ? 'bg-slate-500' : 'bg-emerald-400 animate-pulse'}`} />
              {isArchived ? 'Room is read-only' : `${onlineCount} online`}
            </p>
          </div>
          <button onClick={() => setShowMembers(!showMembers)} className="btn-ghost rounded-xl p-2 text-slate-400 shrink-0">
            👥
          </button>
          {(['creator', 'admin'].includes(userRole) || profile?.is_admin) && (
            <button onClick={() => setShowSettings(true)} className="btn-ghost rounded-xl p-2 text-slate-400 shrink-0">
              ⚙️
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 max-w-3xl mx-auto w-full">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 py-20">
            <div className="text-5xl mb-4 opacity-40">💬</div>
            <p className="text-slate-400 font-medium">No messages yet</p>
            <p className="text-sm mt-1">Say hello!</p>
          </div>
        ) : (
          <>
            {grouped.map((msg) => {
              const isMe = msg.user_id === user?.uid;
              const color = getColor(msg.anonymous_username);
              const msgReactions = reactions[msg.id] ?? {};

              return (
                <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} ${msg.isFirst ? 'mt-5' : 'mt-1'}`}>
                  {/* Avatar — others only */}
                  {!isMe && (
                    <div className="w-8 shrink-0 mr-2 self-end mb-1">
                      {msg.isLast && (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                          style={{ background: color }}>
                          {getInitials(msg.anonymous_username)}
                        </div>
                      )}
                    </div>
                  )}

                  <div className={`max-w-[68%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                    {/* Name shown on first bubble of group */}
                    {msg.isFirst && (
                      <div className="flex items-center gap-1 mb-1 px-1">
                        <span className="text-[11px] font-semibold"
                          style={{ color: isMe ? '#a78bfa' : color }}>
                          {isMe ? `You (${profile?.anonymous_username ?? ''})` : msg.anonymous_username}
                        </span>
                        {(() => {
                          const role = userRoles.get(msg.user_id);
                          if (role === 'creator') return <span className="text-xs bg-yellow-500/20 text-yellow-300 px-1 rounded">👑</span>;
                          if (role === 'admin') return <span className="text-xs bg-blue-500/20 text-blue-300 px-1 rounded">⭐</span>;
                          return null;
                        })()}
                      </div>
                    )}

                    {/* Bubble */}
                    <div className="relative group">
                      <div
                        onClick={(e) => { e.stopPropagation(); setPicker(picker === msg.id ? null : msg.id); }}
                        className={`rounded-2xl px-4 py-2 text-sm leading-relaxed break-words cursor-pointer select-text
                          ${isMe
                            ? `bg-gradient-to-br from-violet-600 to-violet-700 text-white ${msg.isFirst ? 'rounded-tr-sm' : ''}`
                            : `glass border border-white/10 text-slate-100 ${msg.isFirst ? 'rounded-tl-sm' : ''}`
                          }
                          ${msg.optimistic ? 'opacity-70' : ''}`}>
                        {msg.content}
                      </div>

                      {/* Reaction picker */}
                      <AnimatePresence>
                        {!isArchived && picker === msg.id && (
                          <motion.div
                            className={`absolute bottom-full ${isMe ? 'right-0' : 'left-0'} mb-2 flex gap-1 glass border border-white/15 rounded-2xl px-3 py-2 z-30 shadow-xl`}
                            initial={{ opacity: 0, scale: 0.7, y: 8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.7 }}
                            transition={{ duration: 0.1 }}
                            onClick={e => e.stopPropagation()}>
                            {EMOJI_REACTIONS.map(emoji => (
                              <button key={emoji} onClick={() => reactToMessage(msg.id, emoji)}
                                className="text-xl hover:scale-125 transition-transform px-1 py-0.5 rounded-lg hover:bg-white/10">
                                {emoji}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Report button */}
                      {!isMe && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setReportingContent({ type: 'message', id: msg.id });
                          }}
                          className="absolute -right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-amber-500/40 hover:text-amber-500"
                          title="Report Message"
                        >
                          <AlertTriangle size={14} />
                        </button>
                      )}
                    </div>

                    {/* Reactions */}
                    {Object.keys(msgReactions).length > 0 && (
                      <div className={`flex gap-1 mt-1 flex-wrap ${isMe ? 'justify-end' : 'justify-start'}`}>
                        {Object.entries(msgReactions).map(([emoji, who]) => (
                          <button key={emoji} onClick={e => { e.stopPropagation(); reactToMessage(msg.id, emoji); }}
                            disabled={isArchived}
                            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-all ${
                              (who as string[]).includes(user!.uid)
                                ? 'border-violet-500/50 bg-violet-500/15 text-violet-300'
                                : 'border-white/10 text-slate-400'} ${!isArchived ? 'hover:border-violet-500/30' : 'cursor-default'}`}>
                            {emoji} {(who as string[]).length}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Time + delivery */}
                    {msg.isLast && (
                      <span className={`text-[10px] mt-1 px-1 flex items-center gap-1 ${isMe ? 'text-slate-500 self-end' : 'text-slate-600 self-start'}`}>
                        {msg.created_at?.toDate ? msg.created_at.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
                        {isMe && (
                          <span className={msg.optimistic ? 'text-slate-600' : 'text-violet-400'}>
                            {msg.optimistic ? '○' : '✓✓'}
                          </span>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Own avatar */}
                  {isMe && (
                    <div className="w-8 shrink-0 ml-2 self-end mb-1">
                      {msg.isLast && (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                          style={{ background: getColor(profile?.anonymous_username ?? 'me') }}>
                          {getInitials(profile?.anonymous_username ?? 'Me')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Typing indicator */}
      <AnimatePresence>
        {typingText && (
          <motion.div className="max-w-3xl mx-auto w-full px-6 pb-1 shrink-0"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="flex gap-0.5">
                {[0,1,2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: `${i*150}ms` }} />
                ))}
              </span>
              {typingText}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input */}
      <div className="border-t border-white/5 glass shrink-0 relative">
        {isArchived && (
          <div className="absolute inset-0 z-20 bg-[#07070f]/80 backdrop-blur-sm flex items-center justify-center">
             <span className="text-red-400/80 font-bold uppercase tracking-widest text-xs border border-red-500/20 px-4 py-1.5 rounded-full bg-red-500/10">
               Conversation Archived
             </span>
          </div>
        )}
        <div className="max-w-3xl mx-auto flex items-center gap-3 px-4 py-3 relative z-10">
          <input
            type="text"
            className="input-field flex-1 py-2.5 rounded-2xl"
            placeholder={onlyAdminsCanMessage && !['creator', 'admin'].includes(userRole) ? "Only admins can message" : "Message..."}
            value={text}
            onChange={e => { setText(e.target.value); if (e.target.value) emitTyping(); }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            maxLength={2000}
            disabled={onlyAdminsCanMessage && !['creator', 'admin'].includes(userRole)}
          />
          <motion.button
            onClick={sendMessage}
            disabled={!text.trim() || (onlyAdminsCanMessage && !['creator', 'admin'].includes(userRole))}
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-all"
            style={{ background: text.trim() && !(onlyAdminsCanMessage && !['creator', 'admin'].includes(userRole)) ? 'linear-gradient(135deg, #7c3aed, #5b21b6)' : 'rgba(255,255,255,0.05)' }}
            whileTap={{ scale: 0.88 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={text.trim() ? 'white' : '#64748b'} strokeWidth="2.5">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </motion.button>
        </div>
      </div>
    </div>

      {/* Members Sidebar (Moved outside the flex-col of main chat area) */}
      <AnimatePresence>
        {showMembers && (
          <motion.div
            className="w-64 border-l border-white/5 glass flex flex-col shrink-0"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}>
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <h3 className="font-semibold text-white">Members ({members.length})</h3>
              <button onClick={() => setShowMembers(false)} className="md:hidden text-slate-400">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {members.map(member => (
                <div key={member.user_id} className="flex items-center gap-3 p-3 hover:bg-white/5">
                  <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold text-white"
                    style={{ background: getColor(member.anonymous_username) }}>
                    {member.anonymous_username.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{member.anonymous_username}</div>
                    <div className="text-xs text-slate-400 capitalize flex items-center gap-1">
                      {member.role === 'creator' && '👑'}
                      {member.role === 'admin' && '⭐'}
                      {member.role}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
    <AnimatePresence>
      {showSettings && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
          <motion.div className="glass border border-white/10 rounded-3xl p-8 w-full max-w-md"
            initial={{ scale: 0.9, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 20, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
            <h2 className="text-xl font-semibold text-white mb-6">Room Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={onlyAdminsCanMessage}
                    onChange={async (e) => {
                      const newValue = e.target.checked;
                      if (!roomId) return;
                      await updateDoc(doc(db, 'chat_rooms', roomId), { only_admins_can_message: newValue });
                      setOnlyAdminsCanMessage(newValue);
                    }}
                    className="w-4 h-4"
                  />
                  <span className="text-white">Only admins can send messages</span>
                </label>
              </div>

              {(userRole === 'creator' || profile?.is_admin) && !isArchived && (
                <div className="pt-4 border-t border-white/10">
                  <h3 className="text-red-400 font-bold mb-2 text-sm uppercase tracking-wider">Moderation</h3>
                  <p className="text-xs text-slate-400 mb-3">
                    Deleting or archiving this room will move it to the history section and make it read-only for everyone.
                  </p>
                  <button 
                    onClick={async () => {
                      if(window.confirm('Are you sure you want to Delete/Archive this chat room? It will be moved to history and become read-only.')) {
                        if (!roomId) return;
                        try {
                          await updateDoc(doc(db, 'chat_rooms', roomId), { is_archived: true });
                          navigate('/chat-center');
                        } catch (error) {
                          alert('Failed to archive room.');
                        }
                      }
                    }}
                    className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 py-2.5 rounded-xl text-sm font-bold transition">
                    Delete/Archive Room
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowSettings(false)} className="btn-primary rounded-xl flex-1">Close</button>
            </div>
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
