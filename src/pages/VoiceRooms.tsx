import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface VoiceRoom { id: string; name: string; created_at: string; }
interface ActiveUser { userId: string; username: string; }

export default function VoiceRooms() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<VoiceRoom[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeRoom, setActiveRoom] = useState<VoiceRoom | null>(null);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate('/join');
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase.from('voice_rooms').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setRooms(data); });

    const channel = supabase.channel('voice-rooms-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'voice_rooms' }, (payload) => {
        setRooms(prev => [payload.new as VoiceRoom, ...prev]);
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const createRoom = async () => {
    const name = newName.trim();
    if (!name || !user) return;
    setCreating(true);
    const { data } = await supabase.from('voice_rooms').insert({ name, created_by: user.id }).select().single();
    if (data) joinRoom(data as VoiceRoom);
    setNewName(''); setShowCreate(false); setCreating(false);
  };

  const joinRoom = (room: VoiceRoom) => {
    setActiveRoom(room);
    // Simulate presence with Supabase realtime broadcast
    const ch = supabase.channel(`voice:${room.id}`, { config: { presence: { key: user!.id } } });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ username: string }>();
      const users = Object.entries(state).map(([userId, data]) => ({ userId, username: (data[0] as any).username }));
      setActiveUsers(users);
    }).subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ username: profile?.anonymous_username ?? 'Anonymous' });
      }
    });
  };

  const leaveRoom = () => {
    setActiveRoom(null);
    setActiveUsers([]);
  };

  if (activeRoom) {
    return (
      <div className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center">
        <div className="ambient-blob w-[500px] h-[500px] bg-green-600/15 top-[-100px] left-[20%]" />
        <motion.div className="relative z-10 glass border border-green-500/20 rounded-3xl p-10 w-full max-w-lg text-center"
          initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <h1 className="text-2xl font-bold text-white mb-1">🎙️ {activeRoom.name}</h1>
          <p className="text-sm text-slate-400 mb-8">{activeUsers.length} participant{activeUsers.length !== 1 ? 's' : ''}</p>
          
          {/* Avatar grid */}
          <div className="flex flex-wrap justify-center gap-4 mb-10">
            {activeUsers.map(u => (
              <motion.div key={u.userId} className="flex flex-col items-center gap-2"
                initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-500/30 to-emerald-500/30 border-2 border-green-500/40 flex items-center justify-center text-2xl relative">
                  👤
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-500 border-2 border-[#070710]" />
                </div>
                <span className="text-xs text-slate-400 max-w-[80px] truncate">{u.username}</span>
              </motion.div>
            ))}
          </div>

          <div className="flex justify-center gap-4">
            <button onClick={() => setMuted(m => !m)}
              className={`w-14 h-14 rounded-full text-xl transition-all ${muted ? 'bg-red-600/30 border border-red-500/40 text-red-400' : 'bg-white/10 border border-white/15 text-white hover:bg-white/15'}`}>
              {muted ? '🔇' : '🎙️'}
            </button>
            <button onClick={leaveRoom}
              className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 text-white text-xl transition-all">
              📵
            </button>
          </div>
          <p className="text-xs text-slate-600 mt-6">Voice rooms use anonymous presence only · No actual audio in this demo</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="ambient-blob w-[500px] h-[500px] bg-green-600/10 top-[-100px] right-[10%]" />

      <header className="relative z-10 border-b border-white/5 glass sticky top-0">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex items-center gap-4">
            <Link to="/dashboard"><button className="btn-ghost rounded-xl p-2 text-slate-400">← Back</button></Link>
            <div>
              <h1 className="font-semibold text-white">🎙️ Voice Rooms</h1>
              <p className="text-xs text-slate-500">Talk live anonymously</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary !w-auto px-4 py-2 rounded-xl text-sm">+ New Room</button>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-4 py-8">
        {rooms.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🎙️</div>
            <p className="font-medium text-slate-400 text-lg">No voice rooms yet</p>
            <p className="text-sm text-slate-500 mt-1">Create one to start talking</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {rooms.map((room, i) => (
                <motion.div key={room.id} className="glass-hover rounded-2xl p-6 cursor-pointer border border-green-500/10"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  onClick={() => joinRoom(room)}>
                  <div className="w-12 h-12 rounded-xl bg-green-500/20 border border-green-500/30 flex items-center justify-center text-2xl mb-4">🎙️</div>
                  <h3 className="font-semibold text-white text-base mb-1">{room.name}</h3>
                  <p className="text-xs text-emerald-400 font-medium">● Live • Join</p>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      <AnimatePresence>
        {showCreate && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}>
            <motion.div className="glass border border-white/10 rounded-3xl p-8 w-full max-w-md"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
              <h2 className="text-xl font-semibold text-white mb-6">Create Voice Room</h2>
              <input type="text" className="input-field mb-4" placeholder="Room name..." value={newName}
                onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createRoom()}
                autoFocus maxLength={40} />
              <div className="flex gap-3">
                <button onClick={createRoom} className="btn-primary rounded-xl" disabled={creating || !newName.trim()}>
                  {creating ? 'Creating...' : 'Create & Join'}
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
