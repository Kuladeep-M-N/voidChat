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
  ArrowLeft,
  Flame,
  Activity,
  History,
  TrendingUp,
  Clock,
  Layout,
  AlertTriangle,
  ShieldAlert
} from 'lucide-react';
import { useSystemConfig } from '../hooks/useSystemConfig';
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
  limit,
  serverTimestamp 
} from 'firebase/firestore';
import { db, rtdb } from '../lib/firebase';
import { 
  ref, 
  onValue, 
  off 
} from 'firebase/database';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';
import { toast } from 'sonner';
import ReportModal from '../components/ReportModal';

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
  const { config } = useSystemConfig();
  const safeMode = config.safeMode && !profile?.is_admin;
  const { unreadCounts, markAsActive, onlineCount } = useNotifications();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [pulseIntensity, setPulseIntensity] = useState(0.2); // Real-time pulse state
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [creating, setCreating] = useState(false);
  const [activityFeed, setActivityFeed] = useState<any[]>([]);
  const [reportingRoom, setReportingRoom] = useState<string | null>(null);

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
    }, (error) => {
      console.error("ChatCenter rooms listener error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // ── Real-Time Presence Listeners ──
  useEffect(() => {
    if (!user || rooms.length === 0) return;

    const listeners: Record<string, any> = {};

    rooms.forEach((room) => {
      const presenceRef = ref(rtdb, `rooms/${room.id}/presence`);
      listeners[room.id] = onValue(presenceRef, (snapshot) => {
        const data = snapshot.val() || {};
        const count = Object.keys(data).length;
        setMemberCounts(prev => ({ ...prev, [room.id]: count }));
      });
    });

    return () => {
      rooms.forEach((room) => {
        const presenceRef = ref(rtdb, `rooms/${room.id}/presence`);
        if (listeners[room.id]) {
          off(presenceRef);
        }
      });
    };
  }, [user, rooms]);

  // ── Activity Feed Aggregator ──
  useEffect(() => {
    if (!user || rooms.length === 0) return;

    // 1. Listen for new messages globally
    const msgQ = query(collection(db, 'messages'), orderBy('created_at', 'desc'), limit(5));
    const unsubMessages = onSnapshot(msgQ, (snap) => {
      const msgEvents = snap.docs.map(doc => ({
        id: doc.id,
        type: 'message',
        room_id: doc.data().room_id,
        room_path: `/room/${doc.data().room_id}`,
        timestamp: doc.data().created_at,
        text: `New message in "${rooms.find(r => r.id === doc.data().room_id)?.name || 'a room'}"`
      }));
      updateFeed(msgEvents, 'message');
    });

    // 2. Listen for new members (joins) globally
    const joinQ = query(collection(db, 'room_members'), orderBy('joined_at', 'desc'), limit(5));
    const unsubJoins = onSnapshot(joinQ, (snap) => {
      const joinEvents = snap.docs.map(doc => ({
        id: doc.id,
        type: 'join',
        room_id: doc.data().room_id,
        room_path: `/room/${doc.data().room_id}`,
        timestamp: doc.data().joined_at,
        text: `User joined "${rooms.find(r => r.id === doc.data().room_id)?.name || 'a room'}"`
      }));
      updateFeed(joinEvents, 'join');
    });

    // 3. Room creations are already in 'rooms' state, but let's treat them as events
    const roomEvents = rooms.slice(0, 5).map(room => ({
      id: room.id,
      type: 'create',
      room_id: room.id,
      room_path: `/room/${room.id}`,
      timestamp: room.created_at,
      text: `Room "${room.name}" created`
    }));

    const updateFeed = (newEvents: any[], type: string) => {
      setActivityFeed(prev => {
        const filtered = prev.filter(e => e.type !== type);
        const combined = [...filtered, ...newEvents].sort((a,b) => {
          const timeA = a.timestamp?.seconds || 0;
          const timeB = b.timestamp?.seconds || 0;
          return timeB - timeA;
        });

        // Whenever a new message or join arrives, spike the pulse!
        if (newEvents.length > 0 && (type === 'message' || type === 'join')) {
          setPulseIntensity(prev => Math.min(prev + 0.4, 1.2));
        }

        return combined.slice(0, 10);
      });
    };

    // Initialize with rooms
    updateFeed(roomEvents, 'create');

    return () => {
      unsubMessages();
      unsubJoins();
    };
  }, [user, rooms]);

  // ── Pulse Decay Effect ──
  useEffect(() => {
    const timer = setInterval(() => {
      setPulseIntensity(prev => {
        if (prev <= 0.2) return 0.2; // Base level idle pulse
        return prev - 0.05;
      });
    }, 200);
    return () => clearInterval(timer);
  }, []);

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
              className="lg:w-1/3 glass border border-white/10 rounded-3xl p-6 relative overflow-hidden group shadow-[0_0_50px_-12px_rgba(139,92,246,0.15)] h-[320px]"
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
                  onClick={() => {
                    if (safeMode) {
                      toast.error('Platform is in Safe Mode. Room creation is restricted.');
                      return;
                    }
                    setShowCreate(true);
                  }}
                  disabled={safeMode}
                  className="w-full group/btn relative flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold py-4 rounded-2xl shadow-[0_0_20px_rgba(139,92,246,0.3)] transition-all overflow-hidden disabled:opacity-50"
                  whileHover={safeMode ? {} : { scale: 1.02 }}
                  whileTap={safeMode ? {} : { scale: 0.98 }}
                >
                  {safeMode ? <ShieldAlert size={20} /> : <Plus size={20} />}
                  {safeMode ? 'Safe Mode Active' : 'New Chat Room'}
                </motion.button>

                {/* Message Activity Wave */}
                <div className="space-y-4 pt-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black tracking-widest text-slate-500 uppercase">Message Activity</p>
                    <div className="flex items-center gap-1">
                      <span className="w-1 h-1 rounded-full bg-violet-400 animate-pulse" />
                      <span className="text-[9px] font-bold text-violet-400/60 uppercase">Live Pulse</span>
                    </div>
                  </div>
                  
                  <div className="h-16 flex items-end gap-1.5 px-2 bg-white/5 border border-white/5 rounded-2xl overflow-hidden relative group">
                    <div className="absolute inset-0 bg-gradient-to-t from-violet-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    {[30, 45, 75, 90, 80, 60, 40, 30, 50, 70, 85, 65, 40].map((h, i) => (
                      <motion.div
                        key={i}
                        className="flex-1 bg-gradient-to-t from-violet-600/40 to-violet-400/60 rounded-t-[2px]"
                        initial={{ height: "20%" }}
                        animate={{ 
                          height: [`${(h * pulseIntensity) / 2}%`, `${h * pulseIntensity}%`, `${(h * pulseIntensity) / 2}%`],
                          opacity: [0.4 * pulseIntensity, 0.7 * pulseIntensity, 0.4 * pulseIntensity]
                        }}
                        transition={{ 
                          duration: (1.5 / pulseIntensity) + (i * 0.1), 
                          repeat: Infinity, 
                          ease: "easeInOut",
                          delay: i * 0.05
                        }}
                      />
                    ))}
                  </div>
                  <p className="text-[9px] text-slate-500 italic text-center">Ripples from the void indicate global chatter</p>
                </div>
              </div>
            </motion.div>

            {/* Replacement Stats: Trending & Live Activity */}
            <div className="lg:w-2/3 grid grid-cols-1 sm:grid-cols-2 gap-6">
               {/* 1. Trending Chat Room Card */}
               {(() => {
                 const trending = [...activeRoomsList].sort((a,b) => (memberCounts[b.id] || 0) - (memberCounts[a.id] || 0))[0];
                 return trending ? (
                   <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ y: -5, scale: 1.01 }}
                    className="glass border border-white/10 rounded-3xl p-6 flex flex-col justify-between bg-gradient-to-br from-orange-500/10 via-transparent to-transparent group cursor-pointer shadow-[0_0_30px_-5px_rgba(249,115,22,0.1)] h-[320px]"
                    onClick={() => navigate(`/room/${trending.id}`)}
                   >
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-10 rounded-2xl bg-orange-500/20 flex items-center justify-center text-orange-400">
                            <Flame size={20} className="animate-pulse" />
                          </div>
                          <span className="text-sm font-bold text-white italic tracking-tight">🔥 Trending Chat Room</span>
                        </div>
                        <div className="px-2 py-0.5 bg-orange-500/20 border border-orange-500/30 rounded-full text-[9px] font-black text-orange-400 uppercase tracking-widest animate-pulse">
                          Active
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <h3 className="text-xl font-black text-white group-hover:text-orange-400 transition-colors leading-tight">
                          {trending.name}
                        </h3>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-[10px] font-black text-slate-500 bg-white/5 border border-white/5 px-2 py-0.5 rounded uppercase tracking-widest">
                            {trending.category}
                          </span>
                          <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                            <User size={12} className="text-orange-500/60" />
                            <span className="font-bold text-slate-300">{memberCounts[trending.id] || 0} online</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/5 rounded-xl">
                          <TrendingUp size={12} className="text-emerald-400" />
                          <span className="text-[10px] font-bold text-emerald-400/80 uppercase">High engagement burst detected</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 flex items-center justify-between group-hover:translate-x-1 transition-transform">
                      <span className="text-xs font-black text-orange-400/80 uppercase tracking-widest flex items-center gap-2">
                        Join the void <ArrowLeft size={14} className="rotate-180" />
                      </span>
                    </div>
                   </motion.div>
                 ) : (
                   <div className="glass border border-white/5 rounded-3xl p-8 flex items-center justify-center text-slate-600 italic text-sm">
                     Waiting for the first spark...
                   </div>
                 );
               })()}

               {/* 2. Live Chat Activity Card */}
               <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass border border-white/10 rounded-3xl p-6 flex flex-col bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent shadow-[0_0_30px_-5px_rgba(99,102,241,0.1)] h-[320px] overflow-hidden"
               >
                  <div className="flex items-center gap-2 mb-6 shrink-0">
                    <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                      <Zap size={20} />
                    </div>
                    <span className="text-sm font-bold text-white italic tracking-tight">⚡ Live Chat Activity</span>
                  </div>

                  <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar relative">
                    <div className="space-y-4 pb-12">
                      {activityFeed.length > 0 ? (
                        activityFeed.map((event, idx) => (
                          <motion.div 
                            key={event.id}
                            initial={{ x: -10, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: idx * 0.1 }}
                            className="flex items-start gap-3 group/item cursor-pointer"
                            onClick={() => navigate(event.room_path)}
                          >
                            <div className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 group-hover:scale-150 transition-transform ${
                              event.type === 'message' ? 'bg-cyan-400' : 
                              event.type === 'join' ? 'bg-emerald-400' : 'bg-violet-400'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] text-slate-300 leading-tight group-hover:text-white transition-colors">
                                {event.text}
                              </p>
                              <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-500 uppercase mt-1">
                                <Clock size={10} />
                                {event.timestamp ? 
                                  (() => {
                                    const seconds = Math.floor((Date.now() - event.timestamp.toMillis()) / 1000);
                                    if (seconds < 60) return `${seconds}s ago`;
                                    if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
                                    return 'just now';
                                  })() : 'just now'}
                              </div>
                            </div>
                          </motion.div>
                        ))
                      ) : (
                        <div className="flex flex-col items-center justify-center h-40 text-slate-600 italic text-xs gap-3">
                          <div className="w-8 h-8 rounded-full border border-slate-700/50 border-t-indigo-500/50 animate-spin" />
                          Calibrating feed...
                        </div>
                      )}
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#07070f] to-transparent pointer-events-none" />
                  </div>
               </motion.div>
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
                      <motion.div key={room.id}
                        className={`glass-hover rounded-2xl p-5 cursor-pointer ${theme.bg} border ${theme.border} relative overflow-hidden group shadow-lg`}
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.25, delay: i * 0.04 }}
                        layout
                        whileHover={{ scale: 1.02, y: -4 }}>
                        <div 
                          className="absolute inset-x-0 top-0 bottom-12 bg-white/[0.04] opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center pointer-events-none z-10 backdrop-blur-[2px]"
                          onClick={() => navigate(`/room/${room.id}`)}
                        >
                          <div className="bg-indigo-600 border border-white/20 px-6 py-2 rounded-full text-xs font-black text-white shadow-[0_0_20px_rgba(79,70,229,0.4)]">JOIN VOID</div>
                        </div>
                        <div className="flex items-center gap-4 mb-4" onClick={() => navigate(`/room/${room.id}`)}>
                          <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-xl">{theme.icon}</div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-white text-base truncate">{room.name}</h3>
                            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">{room.category}</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-4 border-t border-white/5 text-slate-400 text-xs">
                          <div className="flex items-center gap-2">
                            <User size={14} className="text-violet-400" />
                            {memberCounts[room.id] || 0} online
                          </div>
                          <div className="flex items-center gap-2 z-20">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setReportingRoom(room.id);
                              }}
                              className="p-1 hover:text-amber-400 transition-colors"
                              title="Report Room"
                            >
                              <AlertTriangle size={14} />
                            </button>
                            {profile?.is_admin && (
                              <button onClick={(e) => permanentlyDeleteRoom(room.id, e)} className="p-1 hover:text-red-400 transition-colors">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
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
                  <div key={room.id} onClick={() => navigate(`/room/${room.id}`)} className="rounded-2xl p-5 border border-white/5 bg-white/[0.02] opacity-60 hover:opacity-100 transition-opacity cursor-pointer group/hist relative">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-white/80 text-base truncate">{room.name}</h3>
                        <p className="text-[10px] text-slate-600 mt-1">Archived</p>
                      </div>
                      {profile?.is_admin && (
                        <button 
                          onClick={(e) => permanentlyDeleteRoom(room.id, e)} 
                          className="p-2 text-slate-500 hover:text-red-400 opacity-0 group-hover/hist:opacity-100 transition-all z-20"
                          title="Permanently Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
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

      <ReportModal 
        isOpen={!!reportingRoom}
        onClose={() => setReportingRoom(null)}
        targetType="chat_room"
        targetId={reportingRoom || ''}
      />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(139, 92, 246, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(139, 92, 246, 0.4);
        }
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(139, 92, 246, 0.2) rgba(255, 255, 255, 0.02);
        }
      `}</style>
    </div>
  );
}
