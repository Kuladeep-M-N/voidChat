import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface Room { id: string; name: string; created_at: string; }

const features = [
  { id: 'confessions', emoji: '🔥', label: 'Confessions', desc: 'Share anonymous secrets', path: '/confessions', color: 'from-orange-600/30 to-red-600/20', border: 'border-orange-500/20' },
  { id: 'polls', emoji: '📊', label: 'Polls', desc: 'Vote anonymously', path: '/polls', color: 'from-blue-600/30 to-cyan-600/20', border: 'border-blue-500/20' },
  { id: 'qna', emoji: 'Q&A', label: 'Q&A', desc: 'Ask and answer anonymously', path: '/qna', color: 'from-amber-600/30 to-yellow-600/20', border: 'border-amber-500/20' },
  { id: 'voice', emoji: '🎙️', label: 'Voice Rooms', desc: 'Talk live with others', path: '/voice', color: 'from-green-600/30 to-emerald-600/20', border: 'border-green-500/20' },
  { id: 'shoutouts', emoji: '📣', label: 'Shoutouts', desc: 'Send anonymous shoutouts', path: '/shoutouts', color: 'from-pink-600/30 to-rose-600/20', border: 'border-pink-500/20' },
];

export default function Dashboard() {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate('/join');
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase.from('chat_rooms').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setRooms(data); });

    const channel = supabase.channel('rooms-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_rooms' }, (payload) => {
        setRooms(prev => [payload.new as Room, ...prev]);
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const createRoom = async () => {
    const name = newRoomName.trim();
    if (!name || !user) return;
    setCreating(true);
    await supabase.from('chat_rooms').insert({ name, created_by: user.id });
    setNewRoomName(''); setShowCreate(false); setCreating(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="ambient-blob w-[600px] h-[600px] bg-violet-600/10 top-[-200px] right-[-200px]" />
      <div className="ambient-blob w-[400px] h-[400px] bg-cyan-500/08 bottom-0 left-[-100px]" />

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 glass sticky top-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <motion.span className="text-xl font-bold text-gradient" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>VoidChat</motion.span>
          <div className="flex items-center gap-4">
            <span className="text-slate-400 text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {profile?.anonymous_username || 'Anonymous'}
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
        <div>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
              💬 Chat Rooms <span className="text-slate-500 text-sm font-normal">({rooms.length})</span>
            </h2>
            <motion.button onClick={() => setShowCreate(true)}
              className="btn-primary !w-auto px-5 py-2 rounded-xl text-sm"
              whileHover={{ scale: 1.05 }}>
              + New Room
            </motion.button>
          </div>

          {rooms.length === 0 ? (
            <motion.div className="text-center py-16 text-slate-500" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="text-5xl mb-4">🕳️</div>
              <p className="text-lg font-medium text-slate-400">No rooms yet</p>
              <p className="text-sm mt-1">Create the first room to start chatting</p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <AnimatePresence>
                {rooms.map((room, i) => (
                  <motion.div key={room.id} onClick={() => navigate(`/room/${room.id}`)}
                    className="glass-hover rounded-2xl p-5 cursor-pointer"
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.25, delay: i * 0.04 }}
                    layout>
                    <div className="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-lg mb-4">💬</div>
                    <h3 className="font-semibold text-white text-base mb-1 truncate">{room.name}</h3>
                    <p className="text-xs text-slate-500">
                      {new Date(room.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
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


