import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Zap,
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
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';



const features = [
  { id: 'chat-center', emoji: '💬', label: 'Chat Center', desc: 'Secure anonymous rooms', path: '/chat-center', color: 'from-violet-600/30 to-indigo-600/20', border: 'border-violet-500/20' },
  { id: 'confessions', emoji: '🔥', label: 'Confessions', desc: 'Share anonymous secrets', path: '/confessions', color: 'from-orange-600/30 to-red-600/20', border: 'border-orange-500/20' },
  { id: 'polls', emoji: '📊', label: 'Polls', desc: 'Vote anonymously', path: '/polls', color: 'from-blue-600/30 to-cyan-600/20', border: 'border-blue-500/20' },
  { id: 'qna', emoji: 'Q&A', label: 'Q&A', desc: 'Ask and answer anonymously', path: '/qna', color: 'from-amber-600/30 to-yellow-600/20', border: 'border-amber-500/20' },
  { id: 'voice', emoji: '🎙️', label: 'Voice Rooms', desc: 'Talk live with others', path: '/voice', color: 'from-green-600/30 to-emerald-600/20', border: 'border-green-500/20' },
  { id: 'shoutouts', emoji: '📣', label: 'Shoutouts', desc: 'Send anonymous shoutouts', path: '/shoutouts', color: 'from-pink-600/30 to-rose-600/20', border: 'border-pink-500/20' },
  { id: 'debate', emoji: '⚔️', label: 'Debate Arena', desc: 'Join anonymous debates', path: '/debate-arena', color: 'from-slate-600/30 to-slate-800/20', border: 'border-slate-500/20' },
  { id: 'whisper', emoji: '🤫', label: 'Whisper Space', desc: 'Stories, Theories & Situations', path: '/whisper', color: 'from-fuchsia-600/30 to-purple-600/20', border: 'border-fuchsia-500/20' },
];

export default function Dashboard() {
  const { user, profile, loading, signOut } = useAuth();
  const { unreadCounts, markAsActive, onlineCount } = useNotifications();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate('/join');
    if (user) markAsActive(null);
  }, [user, loading, navigate, markAsActive]);

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
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-white/5 rounded-full border border-white/10">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span className="text-xs font-medium text-slate-300">{onlineCount} Online</span>
            </div>
            <span className="text-slate-400 text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {profile?.anonymous_username || 'Anonymous'}
              {profile?.is_admin && (
                <Link 
                  to="/admin" 
                  className="ml-2 flex items-center gap-2 px-3 py-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-black rounded-full transition hover:bg-amber-500/20"
                >
                  <Shield size={12} />
                  MOD PANEL
                </Link>
              )}
            </span>
            <button 
              onClick={() => { if (window.confirm('Are you sure you want to leave the void?')) signOut(); }} 
              className="text-slate-500 hover:text-slate-300 text-sm transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
            >
              Leave
            </button>
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
        <motion.div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 mb-12" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          {features.map((f, i) => (
            <motion.button
              key={f.id}
              onClick={() => navigate(f.path)}
              className={`glass-hover rounded-2xl p-6 text-left bg-gradient-to-br ${f.color} border ${f.border} relative overflow-hidden group`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.05 * i }}
              whileHover={{ scale: 1.04, y: -4 }}
            >
              <div className="relative z-10">
                <div className="text-4xl mb-4 transform group-hover:scale-110 transition-transform">{f.emoji}</div>
                <div className="font-bold text-white text-lg mb-1">{f.label}</div>
                <div className="text-xs text-slate-400 leading-relaxed">{f.desc}</div>
              </div>
              <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                 <Zap size={16} className="text-white/20" />
              </div>
            </motion.button>
          ))}
        </motion.div>

        {/* Info Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
            <div className="glass border border-white/5 rounded-3xl p-8 bg-gradient-to-br from-indigo-500/5 to-transparent">
              <h2 className="text-lg font-bold text-white mb-3">Community First</h2>
              <p className="text-sm text-slate-400 leading-relaxed">VoidChat is built for the community. Respect others and maintain your anonymity while connecting.</p>
            </div>
            <div className="glass border border-white/5 rounded-3xl p-8 bg-gradient-to-br from-cyan-500/5 to-transparent">
              <h2 className="text-lg font-bold text-white mb-3">Secure & Private</h2>
              <p className="text-sm text-slate-400 leading-relaxed">All your communications are transient. We don't track your identity or store long-term logs.</p>
            </div>
        </div>
      </main>
    </div>
  );
}


