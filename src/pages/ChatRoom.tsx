import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface Message {
  id: string; content: string; created_at: string;
  user_id: string; anonymous_username: string; optimistic?: boolean;
}
interface TypingUser { id: string; username: string; }
interface RoomMember { user_id: string; role: string; anonymous_username: string; }

const EMOJI_REACTIONS = ['❤️', '😂', '🔥', '👀', '😮', '👍'];
const COLORS = ['#7c3aed','#0891b2','#059669','#d97706','#dc2626','#be185d','#4338ca','#7c3aed'];
const getColor = (s: string) => COLORS[(s.charCodeAt(0) + s.charCodeAt(1) || 0) % COLORS.length];
const getInitials = (s: string) => s.slice(0, 2).toUpperCase();

export default function ChatRoom() {
  const { id: roomId } = useParams<{ id: string }>();
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<Message[]>([]);
  const [roomName, setRoomName] = useState('');
  const [roomCategory, setRoomCategory] = useState('');
  const [isArchived, setIsArchived] = useState(false);
  const [onlyAdminsCanMessage, setOnlyAdminsCanMessage] = useState(false);
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

  const bottomRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameCache = useRef<Map<string, string>>(new Map());
  const sending = useRef(false);

  useEffect(() => { if (!loading && !user) navigate('/join'); }, [user, loading, navigate]);

  // ── Fetch room name + messages (runs when user is ready, NOT waiting for profile) ──
  useEffect(() => {
    if (!roomId || !user) return;

    const loadRoomData = async () => {
      // 1. Fetch Room Data
      const { data: roomData } = await supabase.from('chat_rooms')
        .select('name, category, only_admins_can_message, is_archived, created_by')
        .eq('id', roomId).single();
        
      if (roomData) { 
        setRoomName(roomData.name); 
        setRoomCategory(roomData.category); 
        setOnlyAdminsCanMessage(roomData.only_admins_can_message); 
        setIsArchived(roomData.is_archived || false);
      } 

      // 2. Fetch User Role
      let { data: memberData } = await supabase
        .from('room_members')
        .select('role')
        .eq('room_id', roomId)
        .eq('user_id', user.id)
        .single();
      
      if (!memberData) {
        // Auto-join as member
        await supabase.from('room_members').insert({ room_id: roomId, user_id: user.id, role: 'member' });
        memberData = { role: 'member' };
      }
      
      // Safety Fallback: If you created the room, you are always the creator
      const finalRole = (roomData && roomData.created_by === user.id) ? 'creator' : memberData.role;
      setUserRole(finalRole);

      // 3. Fetch All Members
      const { data: allMembers } = await supabase
        .from('room_members')
        .select('user_id, role, users!inner(anonymous_username)')
        .eq('room_id', roomId);
        
      if (allMembers) {
        const rolesMap = new Map<string, string>();
        setMembers(allMembers.map(m => {
          rolesMap.set(m.user_id, m.role);
          return {
            user_id: m.user_id,
            role: m.role,
            anonymous_username: (m.users as any).anonymous_username
          };
        }));
        setUserRoles(rolesMap);
      }
    };

    loadRoomData();

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, content, created_at, user_id')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });

      if (error || !data) return;

      // Fetch all unique user names in one query
      const userIds = [...new Set(data.map(m => m.user_id))];
      if (userIds.length) {
        const { data: users } = await supabase.from('users').select('id, anonymous_username').in('id', userIds);
        users?.forEach(u => nameCache.current.set(u.id, u.anonymous_username));
      }

      setMessages(data.map(m => ({
        ...m,
        anonymous_username: nameCache.current.get(m.user_id) ?? '???'
      })));
    };

    fetchMessages();
  }, [roomId, user]);

  // ── Realtime subscription (separate from data fetch) ──
  useEffect(() => {
    if (!roomId || !user || !profile) return;

    // Cache own name immediately
    nameCache.current.set(user.id, profile.anonymous_username);

    const ch = supabase.channel(`room:${roomId}`, { config: { presence: { key: user.id } } });
    channelRef.current = ch;

    ch
      .on('presence', { event: 'sync' }, () => {
        setOnlineCount(Object.keys(ch.presenceState()).length || 1);
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const msg = payload.new as Omit<Message, 'anonymous_username'>;

          // Get username (from cache or fetch)
          let username = nameCache.current.get(msg.user_id);
          if (!username) {
            const { data } = await supabase.from('users').select('anonymous_username').eq('id', msg.user_id).single();
            username = data?.anonymous_username ?? '???';
            nameCache.current.set(msg.user_id, username);
          }

          setMessages(prev => {
            // If it's our own message, replace the optimistic placeholder
            if (msg.user_id === user.id) {
              const optIdx = prev.findIndex(m => m.optimistic);
              if (optIdx >= 0) {
                const next = [...prev];
                next[optIdx] = { ...msg, anonymous_username: username! };
                return next;
              }
            }
            // Avoid duplicate
            if (prev.find(m => m.id === msg.id)) return prev;
            return [...prev, { ...msg, anonymous_username: username! }];
          });
        }
      );

    // Only subscribe to typing/reactions if the room isn't archived to save bandwidth
    if (!isArchived) {
      ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.userId === user.id) return;
        setTypingUsers(prev => prev.find(u => u.id === payload.userId) ? prev : [...prev, { id: payload.userId, username: payload.username }]);
        setTimeout(() => setTypingUsers(prev => prev.filter(u => u.id !== payload.userId)), 3000);
      })
      .on('broadcast', { event: 'stop_typing' }, ({ payload }) => {
        setTypingUsers(prev => prev.filter(u => u.id !== payload.userId));
      })
      .on('broadcast', { event: 'msg_reaction' }, ({ payload }) => {
        setReactions(prev => {
          const r = { ...(prev[payload.msgId] ?? {}) };
          const who = r[payload.emoji] ?? [];
          if (who.includes(payload.userId)) return prev;
          r[payload.emoji] = [...who, payload.userId];
          return { ...prev, [payload.msgId]: r };
        });
      });
    }

    // Also listen for archiving events dynamically
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_rooms', filter: `id=eq.${roomId}` }, (payload) => {
      if (payload.new.is_archived) {
         setIsArchived(true);
      }
    });

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ username: profile.anonymous_username });
      }
    });

    return () => { supabase.removeChannel(ch); channelRef.current = null; };
  }, [roomId, user, profile]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const emitTyping = useCallback(() => {
    if (!channelRef.current || !profile || isArchived) return;
    channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { userId: user!.id, username: profile.anonymous_username } });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    setTimeout(() => {
      channelRef.current?.send({ type: 'broadcast', event: 'stop_typing', payload: { userId: user!.id } });
    }, 2000);
  }, [profile, user, isArchived]);

  const sendMessage = useCallback(() => {
    const content = text.trim();
    if (!content || !user || !roomId || !profile || sending.current || isArchived) return;

    // Check permissions
    if (onlyAdminsCanMessage && !['creator', 'admin'].includes(userRole)) return;

    sending.current = true;

    const tempId = `OPT_${Date.now()}_${Math.random()}`;
    // Add optimistic immediately — it will be replaced by the DB event
    setMessages(prev => [...prev, {
      id: tempId, content, created_at: new Date().toISOString(),
      user_id: user.id, anonymous_username: profile.anonymous_username, optimistic: true
    }]);
    
    setText('');
    if (typingTimer.current) clearTimeout(typingTimer.current);
    channelRef.current?.send({ type: 'broadcast', event: 'stop_typing', payload: { userId: user.id } });

    // Fire and forget the DB insert so the UI doesn't lag
    (async () => {
      const { data: savedMsg, error } = await supabase.from('messages')
        .insert({ content, user_id: user.id, room_id: roomId })
        .select().single();
        
      if (error) {
        console.error("Failed to send message:", error);
        setMessages(prev => prev.filter(m => m.id !== tempId));
      } else if (savedMsg) {
        // Update the optimistic message with the real data instantly
        setMessages(prev => prev.map(m => 
          m.id === tempId ? { ...savedMsg, anonymous_username: profile.anonymous_username, optimistic: false } : m
        ));
      }
      sending.current = false;
    })();
      
  }, [text, user, roomId, profile, isArchived, onlyAdminsCanMessage, userRole]);

  const reactToMessage = useCallback((msgId: string, emoji: string) => {
    if (!user || isArchived) return;
    setPicker(null);
    setReactions(prev => {
      const r = { ...(prev[msgId] ?? {}) };
      const who = r[emoji] ?? [];
      if (who.includes(user.id)) return prev;
      r[emoji] = [...who, user.id];
      return { ...prev, [msgId]: r };
    });
    channelRef.current?.send({ type: 'broadcast', event: 'msg_reaction', payload: { msgId, emoji, userId: user.id } });
  }, [user]);

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
          <Link to="/dashboard">
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
          {['creator', 'admin'].includes(userRole) && (
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
              const isMe = msg.user_id === user?.id;
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
                    </div>

                    {/* Reactions */}
                    {Object.keys(msgReactions).length > 0 && (
                      <div className={`flex gap-1 mt-1 flex-wrap ${isMe ? 'justify-end' : 'justify-start'}`}>
                        {Object.entries(msgReactions).map(([emoji, who]) => (
                          <button key={emoji} onClick={e => { e.stopPropagation(); reactToMessage(msg.id, emoji); }}
                            disabled={isArchived}
                            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-all ${
                              who.includes(user!.id)
                                ? 'border-violet-500/50 bg-violet-500/15 text-violet-300'
                                : 'border-white/10 text-slate-400'} ${!isArchived ? 'hover:border-violet-500/30' : 'cursor-default'}`}>
                            {emoji} {who.length}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Time + delivery */}
                    {msg.isLast && (
                      <span className={`text-[10px] mt-1 px-1 flex items-center gap-1 ${isMe ? 'text-slate-500 self-end' : 'text-slate-600 self-start'}`}>
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

      {/* Members Sidebar */}
      <AnimatePresence>
        {showMembers && (
          <motion.div
            className="w-64 border-l border-white/5 glass flex flex-col"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.2 }}>
            <div className="p-4 border-b border-white/5">
              <h3 className="font-semibold text-white">Members ({members.length})</h3>
            </div>
            <div className="flex-1 overflow-y-auto">
              {members.map(member => (
                <div key={member.user_id} className="flex items-center gap-3 p-3 hover:bg-white/5">
                  <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold text-white">
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
                      await supabase.from('chat_rooms').update({ only_admins_can_message: newValue }).eq('id', roomId);
                      setOnlyAdminsCanMessage(newValue);
                    }}
                    className="w-4 h-4"
                  />
                  <span className="text-white">Only admins can send messages</span>
                </label>
              </div>

              {userRole === 'creator' && !isArchived && (
                <div className="pt-4 border-t border-white/10">
                  <h3 className="text-red-400 font-bold mb-2 text-sm uppercase tracking-wider">Danger Zone</h3>
                  <p className="text-xs text-slate-400 mb-3">Archiving this room will make it read-only forever. Messages will be preserved in history, but no one can send new ones.</p>
                  <button 
                    onClick={async () => {
                      if(window.confirm('Are you absolutely sure you want to permanently archive this chat room?')) {
                        await supabase.from('chat_rooms').update({ is_archived: true }).eq('id', roomId);
                        setIsArchived(true);
                        setShowSettings(false);
                      }
                    }}
                    className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 py-2.5 rounded-xl text-sm font-bold transition">
                    Archive / Delete Room
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
    </div>

    </div>
  );
}
