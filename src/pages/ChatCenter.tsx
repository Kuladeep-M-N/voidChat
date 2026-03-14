import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  MessageSquare,
  Trash2,
  Shield,
  Star,
  User,
  Sparkles,
  Zap,
  ArrowLeft
} from 'lucide-react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  where,
  getDocs,
  getCountFromServer,
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';

interface Room { 
  id: string; 
  name: string; 
  category: string; 
  created_at: any; 
  is_archived?: boolean; 
  memberCount?: number;
  messageCount?: number;
}

const roomThemes = {
  general: { bg: 'bg-gradient-to-br from-blue-600/20 to-cyan-600/20', icon: '💬', border: 'border-blue-500/30' },
  gaming: { bg: 'bg-gradient-to-br from-purple-600/20 to-green-600/20', icon: '🎮', border: 'border-purple-500/30' },
  confessions: { bg: 'bg-gradient-to-br from-red-600/20 to-pink-600/20', icon: '🔥', border: 'border-red-500/30' },
  music: { bg: 'bg-gradient-to-br from-purple-600/20 to-cyan-600/20', icon: '🎵', border: 'border-purple-500/30' },
  qa: { bg: 'bg-gradient-to-br from-amber-600/20 to-yellow-600/20', icon: '❓', border: 'border-amber-500/30' },
  memes: { bg: 'bg-gradient-to-br from-pink-600/20 to-orange-600/20', icon: '😂', border: 'border-pink-500/30' },
};

export default function ChatCenter() {
  const { user, profile, loading } = useAuth();
  const { unreadCounts, markAsActive, onlineCount } = useNotifications();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate('/join');
    if (user) markAsActive(null);
  }, [user, loading, navigate, markAsActive]);

  useEffect(() => {
    if (!user) return;
    
    const q = query(collection(db, 'chat_rooms'), orderBy('created_at', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: Room[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Room));
      
      setRooms(items);
      
      // Enrichment: Fetch member counts in background to avoid blocking initial render
      snapshot.docs.forEach((roomDoc) => {
        const memQ = query(collection(db, 'room_members'), where('room_id', '==', roomDoc.id));
        getCountFromServer(memQ).then(countSnap => {
          const count = countSnap.data().count;
          setMemberCounts(prev => ({ ...prev, [roomDoc.id]: count }));
        }).catch(err => console.error("Enrichment error for room:", roomDoc.id, err));
      });
    }, (error) => {
      console.error("ChatCenter rooms listener error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  const createRoom = async () => {
    const name = newRoomName.trim();
    if (!name || !user) return;

    setCreating(true);

    try {
      const q = query(collection(db, 'chat_rooms'), where('name', '==', name), where('is_archived', '==', false));
      const existing = await getDocs(q);

      if (!existing.empty) {
        alert('A room with this name already exists and is active. Please choose a different name.');
        setCreating(false);
        return;
      }

      const roomRef = await addDoc(collection(db, 'chat_rooms'), {
        name,
        created_by: user.uid,
        category: 'general',
        is_archived: false,
        created_at: serverTimestamp()
      });

      await addDoc(collection(db, 'room_members'), {
        room_id: roomRef.id,
        user_id: user.uid,
        role: 'creator',
        joined_at: serverTimestamp()
      });

      navigate(`/room/${roomRef.id}`);
    } catch (error: any) {
      console.error('Create room error:', error);
      alert(error.message || 'Failed to create room.');
    } finally {
      setNewRoomName('');
      setShowCreate(false);
      setCreating(false);
    }
  };

  const permanentlyDeleteRoom = async (roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!profile?.is_admin) return;
    if (!window.confirm('PERMANENTLY delete this room and all its messages? This cannot be undone.')) return;
    
    try {
      await deleteDoc(doc(db, 'chat_rooms', roomId));
    } catch (error) {
      console.error('Delete room error:', error);
      alert('Failed to delete room permanently.');
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
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/dashboard')} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft size={20} className="text-slate-400" />
            </button>
            <motion.span className="text-xl font-bold text-gradient" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Chat Center</motion.span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-white/5 rounded-full border border-white/10">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-slate-300">{onlineCount} Online</span>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-10">
        <div className="space-y-12">
          {/* Top Section: Control Panel & Highlights */}
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Chat Central Module Panel */}
            <motion.div 
              className="lg:w-1/3 glass border border-white/10 rounded-3xl p-6 relative overflow-hidden group shadow-[0_0_50px_-12px_rgba(139,92,246,0.15)]"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="absolute inset-0 pointer-events-none">
                <motion.div animate={{ y: [0, -20, 0], opacity: [0.1, 0.3, 0.1] }} transition={{ duration: 4, repeat: Infinity }} className="absolute top-10 left-10 w-1 h-1 bg-violet-400 rounded-full blur-[1px]" />
                <motion.div animate={{ y: [0, -30, 0], opacity: [0.2, 0.4, 0.2] }} transition={{ duration: 5, repeat: Infinity, delay: 1 }} className="absolute bottom-20 right-10 w-1 h-1 bg-cyan-400 rounded-full blur-[1px]" />
              </div>

              <div className="relative z-10 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <MessageSquare className="text-violet-400" size={20} />
                    Management
                  </h2>
                </div>

                <motion.button 
                  onClick={() => setShowCreate(true)}
                  className="w-full group/btn relative flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold py-4 rounded-2xl shadow-[0_0_20px_rgba(139,92,246,0.3)] transition-all overflow-hidden"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Plus size={20} />
                  New Chat Room
                </motion.button>

                {/* Trending Room */}
                <div className="space-y-3">
                  <p className="text-[10px] font-black tracking-widest text-slate-500 uppercase">Featured Buzz</p>
                  {activeRoomsList.length > 0 ? (
                    (() => {
                      const trending = [...activeRoomsList].sort((a,b) => (memberCounts[b.id] || 0) - (memberCounts[a.id] || 0))[0];
                      return (
                        <motion.div onClick={() => navigate(`/room/${trending.id}`)} className="p-4 rounded-2xl bg-white/5 border border-white/10 cursor-pointer hover:bg-white/10 transition-colors relative" whileHover={{ scale: 1.02 }}>
                          <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-0.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full text-[9px] font-black">
                            <Star size={10} fill="currentColor" />
                            TRENDING
                          </div>
                          <h4 className="font-bold text-slate-100 text-sm mb-1 pr-16 truncate">{trending.name}</h4>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400">
                            <span className="flex items-center gap-1"><User size={12} className="text-violet-400" />{memberCounts[trending.id] || 0} active</span>
                            <span className="flex items-center gap-1"><MessageSquare size={12} className="text-cyan-400" />Live</span>
                          </div>
                        </motion.div>
                      );
                    })()
                  ) : <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-slate-600 text-[11px] italic">No rooms active</div>}
                </div>
              </div>
            </motion.div>

            {/* Stats/Highlights */}
            <div className="lg:w-2/3 grid grid-cols-1 sm:grid-cols-2 gap-4">
               <div className="glass border border-white/5 rounded-3xl p-8 flex flex-col justify-center gap-4 bg-gradient-to-br from-indigo-500/5 to-transparent">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center">
                    <Sparkles size={24} className="text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-100 mb-1">Total Rooms</h3>
                    <p className="text-3xl font-black text-indigo-400">{activeRoomsList.length}</p>
                  </div>
               </div>
               <div className="glass border border-white/5 rounded-3xl p-8 flex flex-col justify-center gap-4 bg-gradient-to-br from-cyan-500/5 to-transparent">
                  <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center">
                    <Zap size={24} className="text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-100 mb-1">Active Now</h3>
                    <p className="text-3xl font-black text-cyan-400">{activeRoomsList.reduce((acc, r) => acc + (memberCounts[r.id] || 0), 0)}</p>
                  </div>
               </div>
            </div>
          </div>

          {/* Active Rooms Grid */}
          <section>
            <h2 className="text-lg font-bold text-slate-200 mb-6 flex items-center gap-2 px-2">
              <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
              Active Chat Rooms
            </h2>

            {activeRoomsList.length === 0 ? (
              <div className="text-center py-16 text-slate-500 bg-white/5 border border-white/5 rounded-3xl">
                <div className="text-5xl mb-4">🕳️</div>
                <p className="text-lg font-medium text-slate-400">The void is silent</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <AnimatePresence>
                  {activeRoomsList.map((room, i) => {
                    const theme = roomThemes[room.category as keyof typeof roomThemes] || roomThemes.general;
                    return (
                      <motion.div key={room.id} onClick={() => navigate(`/room/${room.id}`)}
                        className={`glass-hover rounded-2xl p-5 cursor-pointer ${theme.bg} border ${theme.border} relative overflow-hidden group shadow-lg`}
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.25, delay: i * 0.04 }}
                        layout
                        whileHover={{ scale: 1.02, y: -4 }}>
                        <div className="absolute inset-0 bg-white/[0.04] opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center pointer-events-none z-10 backdrop-blur-[2px]">
                          <div className="bg-indigo-600 border border-white/20 px-6 py-2 rounded-full text-xs font-black text-white shadow-[0_0_20px_rgba(79,70,229,0.4)]">JOIN VOID</div>
                        </div>
                        <div className="flex items-center gap-4 mb-4">
                          <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-xl">{theme.icon}</div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-white text-base truncate">{room.name}</h3>
                            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">{room.category}</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-4 border-t border-white/5 text-slate-400 text-xs text-xs">
                          <div className="flex items-center gap-2">
                            <User size={14} className="text-violet-400" />
                            {memberCounts[room.id] || 0} active
                          </div>
                          {profile?.is_admin && (
                            <button onClick={(e) => permanentlyDeleteRoom(room.id, e)} className="p-1 hover:text-red-400 transition-colors z-20">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </section>

          {/* History */}
          {pastRoomsList.length > 0 && (
            <section>
              <h2 className="text-slate-500 text-sm font-semibold mb-4">📚 History ({pastRoomsList.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {pastRoomsList.map((room) => (
                  <div key={room.id} onClick={() => navigate(`/room/${room.id}`)} className="rounded-2xl p-5 border border-white/5 bg-white/[0.02] opacity-60 hover:opacity-100 transition-opacity cursor-pointer">
                    <h3 className="font-semibold text-white/80 text-base truncate">{room.name}</h3>
                    <p className="text-[10px] text-slate-600 mt-1">Archived</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}>
            <motion.div className="glass border border-white/10 rounded-3xl p-8 w-full max-w-md"
              initial={{ scale: 0.9, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}>
              <h2 className="text-xl font-semibold text-white mb-6">Create a Chat Room</h2>
              <input type="text" className="input-field mb-4" placeholder="Room name..." value={newRoomName}
                onChange={e => setNewRoomName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createRoom()}
                autoFocus maxLength={40} />
              <div className="flex gap-3">
                <button onClick={createRoom} className="btn-primary rounded-xl px-6 py-2" disabled={creating || !newRoomName.trim()}>
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
