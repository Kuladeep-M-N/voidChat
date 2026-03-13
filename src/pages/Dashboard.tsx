import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Search,
  MessageSquare,
  Settings,
  LogOut,
  MoreVertical,
  Trash2,
  Shield,
  Clock,
  CheckCircle2,
  AlertCircle,
  Archive,
  User,
  Star,
  Zap,
  Sparkles
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';

interface Room { id: string; name: string; category: string; created_at: string; is_archived?: boolean; }

const roomThemes = {
  general: { bg: 'bg-gradient-to-br from-blue-600/20 to-cyan-600/20', icon: '💬', border: 'border-blue-500/30' },
  gaming: { bg: 'bg-gradient-to-br from-purple-600/20 to-green-600/20', icon: '🎮', border: 'border-purple-500/30' },
  confessions: { bg: 'bg-gradient-to-br from-red-600/20 to-pink-600/20', icon: '🔥', border: 'border-red-500/30' },
  music: { bg: 'bg-gradient-to-br from-purple-600/20 to-cyan-600/20', icon: '🎵', border: 'border-purple-500/30' },
  qa: { bg: 'bg-gradient-to-br from-amber-600/20 to-yellow-600/20', icon: '❓', border: 'border-amber-500/30' },
  memes: { bg: 'bg-gradient-to-br from-pink-600/20 to-orange-600/20', icon: '😂', border: 'border-pink-500/30' },
};

const features = [
  { id: 'confessions', emoji: '🔥', label: 'Confessions', desc: 'Share anonymous secrets', path: '/confessions', color: 'from-orange-600/30 to-red-600/20', border: 'border-orange-500/20' },
  { id: 'polls', emoji: '📊', label: 'Polls', desc: 'Vote anonymously', path: '/polls', color: 'from-blue-600/30 to-cyan-600/20', border: 'border-blue-500/20' },
  { id: 'qna', emoji: 'Q&A', label: 'Q&A', desc: 'Ask and answer anonymously', path: '/qna', color: 'from-amber-600/30 to-yellow-600/20', border: 'border-amber-500/20' },
  { id: 'voice', emoji: '🎙️', label: 'Voice Rooms', desc: 'Talk live with others', path: '/voice', color: 'from-green-600/30 to-emerald-600/20', border: 'border-green-500/20' },
  { id: 'shoutouts', emoji: '📣', label: 'Shoutouts', desc: 'Send anonymous shoutouts', path: '/shoutouts', color: 'from-pink-600/30 to-rose-600/20', border: 'border-pink-500/20' },
];

export default function Dashboard() {
  const { user, profile, loading, signOut } = useAuth();
  const { unreadCounts, markAsActive, onlineCount } = useNotifications();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate('/join');
    if (user) markAsActive(null); // Not in any specific room on dashboard
  }, [user, loading, navigate, markAsActive]);

  useEffect(() => {
    if (!user) return;
    supabase.from('chat_rooms').select('id, name, category, created_at, is_archived').order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setRooms(data); });

    const channel = supabase.channel('rooms-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_rooms' }, (payload) => {
        const eventType = payload.eventType;
        if (eventType === 'INSERT') {
          setRooms(prev => [payload.new as Room, ...prev]);
        } else if (eventType === 'UPDATE') {
          setRooms(prev => prev.map(r => r.id === payload.new.id ? { ...r, ...payload.new } : r));
        } else if (eventType === 'DELETE') {
          setRooms(prev => prev.filter(r => r.id !== payload.old.id));
        }
      }).subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const createRoom = async () => {
    const name = newRoomName.trim();
    if (!name || !user) return;

    setCreating(true);

    // Check if room name exists
    const { data: existing } = await supabase.from('chat_rooms')
      .select('id')
      .eq('name', name)
      .eq('is_archived', false)
      .single();

    if (existing) {
      alert('A room with this name already exists and is active. Please choose a different name.');
      setCreating(false);
      return;
    }

    // Create the room
    const { data: room, error } = await supabase.from('chat_rooms')
      .insert({ name, created_by: user.id, category: 'general' })
      .select().single();

    if (room && !error) {
      await supabase.from('room_members').insert({ room_id: room.id, user_id: user.id, role: 'creator' });
      navigate(`/room/${room.id}`);
    } else {
      console.error('Create room error:', error);
      if (error?.code === '23505') {
        alert('This room name is already taken (even in history). Please use a unique name.');
      } else {
        alert(error?.message || 'Failed to create room. Please ensure the latest SQL script has been run.');
      }
    }

    setNewRoomName('');
    setShowCreate(false);
    setCreating(false);
  };

  const archiveRoom = async (roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Archive this room? it will be moved to history.')) return;
    const { error } = await supabase.from('chat_rooms').update({ is_archived: true }).eq('id', roomId);
    if (error) {
      console.error('Archive room error:', error);
      alert('Failed to archive room.');
    } else {
      setRooms(prev => prev.map(r => r.id === roomId ? { ...r, is_archived: true } : r));
    }
  };

  const permanentlyDeleteRoom = async (roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!profile?.is_admin) return;
    if (!window.confirm('PERMANENTLY delete this room and all its messages? This cannot be undone.')) return;
    
    const { error } = await supabase.from('chat_rooms').delete().eq('id', roomId);
    if (error) {
      console.error('Delete room error:', error);
      alert('Failed to delete room permanently.');
    } else {
      setRooms(prev => prev.filter(r => r.id !== roomId));
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;

  const activeRoomsList = rooms.filter(r => !r.is_archived);
  const pastRoomsList = rooms.filter(r => r.is_archived);

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="ambient-blob w-[600px] h-[600px] bg-violet-600/10 top-[-200px] right-[-200px]" />
      <div className="ambient-blob w-[400px] h-[400px] bg-cyan-500/08 bottom-0 left-[-100px]" />

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 glass sticky top-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <motion.span className="text-xl font-bold text-gradient" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>VoidChat</motion.span>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-white/5 rounded-full border border-white/10">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span className="text-xs font-medium text-slate-300">{onlineCount} Online</span>
            </div>
            <span className="text-slate-400 text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {profile?.anonymous_username || 'Anonymous'}
              {profile?.is_admin && <span className="text-[10px] font-black bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full border border-red-500/20 ml-1">ADMIN</span>}
            </span>
            <button onClick={signOut} className="text-slate-500 hover:text-slate-300 text-sm transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5">Leave</button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-10">
        {/* Welcome */}
        <motion.div className="mb-10" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold mb-1">Welcome, <span className="text-gradient">{profile?.anonymous_username || 'Anonymous'}</span></h1>
          <p className="text-slate-400">Your identity is hidden. Say what's on your mind.</p>
        </motion.div>

        {/* Feature Cards */}
        <motion.div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-12" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          {features.map((f, i) => (
            <motion.button
              key={f.id}
              onClick={() => navigate(f.path)}
              className={`glass-hover rounded-2xl p-5 text-left bg-gradient-to-br ${f.color} border ${f.border}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.05 * i }}
              whileHover={{ scale: 1.04 }}
            >
              <div className="text-3xl mb-3">{f.emoji}</div>
              <div className="font-semibold text-white text-base">{f.label}</div>
              <div className="text-xs text-slate-400 mt-0.5">{f.desc}</div>
            </motion.button>
          ))}
        </motion.div>

        {/* Chat Rooms */}
        <div className="space-y-12">
          {/* Active Rooms */}
          <section>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                💬 Active Chat Rooms <span className="text-slate-500 text-sm font-normal">({activeRoomsList.length})</span>
              </h2>
              <motion.button onClick={() => setShowCreate(true)}
                className="btn-primary !w-auto px-5 py-2 rounded-xl text-sm"
                whileHover={{ scale: 1.05 }}>
                + New Room
              </motion.button>
            </div>

            {activeRoomsList.length === 0 ? (
              <motion.div className="text-center py-16 text-slate-500 bg-white/5 border border-white/5 rounded-3xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="text-5xl mb-4">🕳️</div>
                <p className="text-lg font-medium text-slate-400">No active rooms</p>
                <p className="text-sm mt-1">Create the first room to start chatting</p>
              </motion.div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <AnimatePresence>
                  {activeRoomsList.map((room, i) => {
                    const theme = roomThemes[room.category as keyof typeof roomThemes] || roomThemes.general;
                    return (
                      <motion.div key={room.id} onClick={() => navigate(`/room/${room.id}`)}
                        className={`glass-hover rounded-2xl p-5 cursor-pointer ${theme.bg} border ${theme.border} relative overflow-hidden`}
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.25, delay: i * 0.04 }}
                        layout
                        whileHover={{ scale: 1.02, y: -2 }}
                        whileTap={{ scale: 0.98 }}>
                        <div className="absolute top-0 right-0 p-3 flex gap-2">
                          {unreadCounts[room.id] > 0 && (
                            <div className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold animate-pulse shadow-lg ring-2 ring-red-500/20">
                              {unreadCounts[room.id]} NEW
                            </div>
                          )}
                          <div className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold">LIVE</div>
                          {(profile?.is_admin || room.id) && (
                            profile?.is_admin && (
                              <button onClick={(e) => archiveRoom(room.id, e)} className="text-slate-400 hover:text-amber-400 transition-colors" title="Archive Room">
                                <Archive size={14} />
                              </button>
                            )
                          )}
                        </div>
                        <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-lg mb-4">{theme.icon}</div>
                        <h3 className="font-semibold text-white text-base mb-1 truncate">{room.name}</h3>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-slate-500">
                            {new Date(room.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </p>
                          <span className="text-xs text-slate-400 capitalize">{room.category}</span>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </section>

          {/* History Section */}
          {pastRoomsList.length > 0 && (
            <section>
              <h2 className="text-slate-500 text-sm font-semibold mb-4 flex items-center gap-2">
                📚 History <span className="text-slate-600 text-xs font-normal">({pastRoomsList.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <AnimatePresence>
                  {pastRoomsList.map((room, i) => {
                    const theme = roomThemes[room.category as keyof typeof roomThemes] || roomThemes.general;
                    return (
                      <motion.div key={room.id} onClick={() => navigate(`/room/${room.id}`)}
                        className={`rounded-2xl p-5 cursor-pointer border border-white/5 bg-white/[0.02] opacity-60 hover:opacity-100 transition-opacity`}
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 0.6, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.25, delay: i * 0.04 }}
                        layout>
                        <div className="flex items-center justify-between mb-4">
                          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-lg grayscale">{theme.icon}</div>
                          <div className="flex items-center gap-2">
                             {profile?.is_admin && (
                              <button 
                                onClick={(e) => permanentlyDeleteRoom(room.id, e)} 
                                className="text-slate-500 hover:text-red-400 transition-colors p-1"
                                title="Permanently Delete"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                            <span className="text-[9px] text-white/30 font-bold border border-white/5 px-2 py-0.5 rounded-full">Archived</span>
                          </div>
                        </div>
                        <h3 className="font-semibold text-white/80 text-base mb-1 truncate">{room.name}</h3>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-slate-600">
                            {new Date(room.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Create Room Modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}>
            <motion.div className="glass border border-white/10 rounded-3xl p-8 w-full max-w-md"
              initial={{ scale: 0.9, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
              <h2 className="text-xl font-semibold text-white mb-6">Create a Chat Room</h2>
              <input type="text" className="input-field mb-4" placeholder="Room name..." value={newRoomName}
                onChange={e => setNewRoomName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createRoom()}
                autoFocus maxLength={40} />
              <div className="flex gap-3">
                <button onClick={createRoom} className="btn-primary rounded-xl" disabled={creating || !newRoomName.trim()}>
                  {creating ? 'Creating...' : 'Create Room'}
                </button>
                <button onClick={() => setShowCreate(false)} className="btn-ghost rounded-xl px-4 py-2 border border-white/10">Cancel</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


