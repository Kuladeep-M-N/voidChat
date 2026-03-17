import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, 
  MessageSquare, 
  TrendingUp, 
  Clock, 
  Users, 
  Filter,
  ArrowLeft,
  Sparkles,
  Zap,
  Sword,
  Scale,
  Lock,
  Trash2,
  History,
  AlertTriangle,
  ShieldAlert
} from 'lucide-react';
import { useSystemConfig } from '../hooks/useSystemConfig';
import FeatureDisabledBanner from '../components/FeatureDisabledBanner';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp,
  where,
  limit,
  deleteDoc,
  doc,
  updateDoc
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';
import { toast } from 'sonner';
import ReportModal from '../components/ReportModal';

interface Debate {
  id: string;
  title: string;
  description: string;
  category: string;
  created_by: string;
  created_at: any;
  expires_at?: any;
  side_a_label: string;
  side_b_label: string;
  votes_a: number;
  votes_b: number;
  status: string;
  participantCount?: number;
  argumentCount?: number;
  winner?: 'A' | 'B' | 'Draw';
}

const CATEGORIES = ['Tech', 'Campus', 'Fun', 'Life', 'Random'];

export default function DebateArena() {
  const { user, profile, loading } = useAuth();
  const { config } = useSystemConfig();
  const isDisabled = config.disableDebates && !profile?.is_admin;
  const safeMode = (config.safeMode || isDisabled) && !profile?.is_admin;
  const { markAsActive, onlineCount } = useNotifications();
  const navigate = useNavigate();
  
  const [debates, setDebates] = useState<Debate[]>([]);
  const [filter, setFilter] = useState('Hot');
  const [showCreate, setShowCreate] = useState(false);
  
  // Create Modal State
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('Random');
  const [sideA, setSideA] = useState('Support');
  const [sideB, setSideB] = useState('Oppose');
  const [creating, setCreating] = useState(false);
  const [reportingDebate, setReportingDebate] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate('/join');
    if (user) markAsActive(null);
  }, [user, loading, navigate, markAsActive]);

  useEffect(() => {
    if (!user) return;

    let q = query(collection(db, 'debates'));
    
    if (filter === 'Closed') {
      q = query(collection(db, 'debates'), where('status', '==', 'closed'), orderBy('created_at', 'desc'));
    } else if (filter === 'New' || filter === 'Hot') {
      q = query(collection(db, 'debates'), where('status', '!=', 'closed'), orderBy('created_at', 'desc'));
    } else if (filter === 'Most Participants') {
      q = query(collection(db, 'debates'), where('status', '!=', 'closed'), orderBy('participantCount', 'desc'));
    } else {
      q = query(collection(db, 'debates'), where('status', '!=', 'closed'), orderBy('created_at', 'desc'));
    }

    let unsubFunction = () => {};

    const setupFallback = () => {
      console.warn("Falling back to un-ordered query due to missing index...");
      const fallbackQ = query(collection(db, 'debates'));
      return onSnapshot(fallbackQ, (snapshot) => {
        let items: Debate[] = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Debate));

        // Re-apply filter and sort in memory
        if (filter === 'Closed') {
          items = items.filter(d => d.status === 'closed');
        } else {
          items = items.filter(d => d.status !== 'closed');
        }

        items.sort((a, b) => {
          if (filter === 'Most Participants') {
            return (b.participantCount || 0) - (a.participantCount || 0);
          }
          const timeA = a.created_at?.seconds || 0;
          const timeB = b.created_at?.seconds || 0;
          return timeB - timeA;
        });

        setDebates(items);
      });
    };

    const unsubscribe = onSnapshot(q, {
      next: (snapshot) => {
        const items: Debate[] = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Debate));
        setDebates(items);
      },
      error: (err) => {
        console.error("Debates Snapshot Error:", err);
        if (err.code === 'failed-precondition') {
          unsubFunction(); // Cleanup initial attempt
          unsubFunction = setupFallback();
        } else {
          toast.error("Failed to connect to the arena");
        }
      }
    });

    unsubFunction = unsubscribe;

    return () => unsubFunction();
  }, [user, filter]);

  const createDebate = async () => {
    if (!newTitle.trim() || !user || creating || isDisabled) return;
    setCreating(true);

    try {
      const docRef = await addDoc(collection(db, 'debates'), {
        title: newTitle.trim(),
        description: newDesc.trim(),
        category: newCategory,
        side_a_label: sideA.trim() || 'Support',
        side_b_label: sideB.trim() || 'Oppose',
        votes_a: 0,
        votes_b: 0,
        participantCount: 0,
        argumentCount: 0,
        status: 'active',
        created_by: user.uid,
        created_at: serverTimestamp(),
      });
      setShowCreate(false);
      navigate(`/debate-arena/${docRef.id}`);
    } catch (error) {
      console.error('Error creating debate:', error);
    } finally {
      setCreating(false);
    }
  };

  const deleteDebate = async (e: React.MouseEvent, debateId: string) => {
    e.stopPropagation();
    if (!window.confirm('Wipe this debate from existence? This cannot be undone.')) return;
    
    try {
      await deleteDoc(doc(db, 'debates', debateId));
      toast.success('Debate erased from the void.');
    } catch (error: any) {
      console.error('Error deleting debate:', error);
      toast.error('Failed to erase debate: ' + error.message);
    }
  };

  const closeDebate = async (e: React.MouseEvent, debate: Debate) => {
    e.stopPropagation();
    const confirm = window.confirm('Are you sure you want to close this debate? This will determine the winner and lock further arguments.');
    if (!confirm) return;

    const winner = debate.votes_a > debate.votes_b ? 'A' : 
                   debate.votes_b > debate.votes_a ? 'B' : 'Draw';
    
    try {
      await updateDoc(doc(db, 'debates', debate.id), {
        status: 'closed',
        winner
      });
      toast.success('Debate has been closed');
    } catch (e: any) {
      toast.error('Failed to close debate: ' + e.message);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" /></div>;

  const trendingDebate = [...debates].sort((a, b) => {
    const scoreA = (a.votes_a + a.votes_b) + (a.argumentCount || 0);
    const scoreB = (b.votes_a + b.votes_b) + (b.argumentCount || 0);
    if (scoreA === scoreB) return (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0);
    return scoreB - scoreA;
  })[0];

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#07070f]">
      <div className="ambient-blob w-[600px] h-[600px] bg-slate-600/10 top-[-200px] right-[-200px]" />
      <div className="ambient-blob w-[400px] h-[400px] bg-blue-500/08 bottom-0 left-[-100px]" />

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 glass sticky top-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/dashboard')} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft size={20} className="text-slate-400" />
            </button>
            <motion.span className="text-xl font-bold text-gradient">Debate Arena</motion.span>
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
        {config.disableDebates && <FeatureDisabledBanner featureName="Debate Arena" />}
        <div className="space-y-12">
          {/* Top Section */}
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Action Panel */}
            <motion.div 
              className="lg:w-1/3 glass border border-white/10 rounded-3xl p-6 relative overflow-hidden group shadow-[0_0_50px_-12px_rgba(100,116,139,0.15)]"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="relative z-10 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Sword className="text-slate-400" size={20} />
                    The Arena
                  </h2>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Start a topic and let the void decide. All debates are anonymous.
                </p>
                <motion.button 
                  onClick={() => {
                    if (safeMode) {
                      toast.error('Platform is in Safe Mode. Debate creation is restricted.');
                      return;
                    }
                    setShowCreate(true);
                  }}
                  disabled={safeMode && !profile?.is_admin}
                  className="w-full relative flex items-center justify-center gap-2 bg-gradient-to-r from-slate-600 to-slate-800 hover:from-slate-500 hover:to-slate-700 text-white font-bold py-4 rounded-2xl shadow-xl transition-all disabled:opacity-50"
                  whileHover={safeMode ? {} : { scale: 1.02 }}
                  whileTap={safeMode ? {} : { scale: 0.98 }}
                >
                  {safeMode ? <ShieldAlert size={20} /> : <Plus size={20} />}
                  {safeMode ? 'Safe Mode Active' : 'Start Debate'}
                </motion.button>
                <div className="h-px bg-white/5 my-4" />
                <motion.button 
                  onClick={() => setFilter(filter === 'Closed' ? 'Hot' : 'Closed')}
                  className={`w-full flex items-center justify-center gap-2 font-bold py-3 rounded-2xl transition-all border ${
                    filter === 'Closed' 
                      ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' 
                      : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10'
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <History size={18} />
                  {filter === 'Closed' ? 'Back to Arena' : 'Debate Archives'}
                </motion.button>
              </div>
            </motion.div>

            {/* Trending Spotlight */}
            <div className="lg:w-2/3">
              {trendingDebate ? (
                <motion.div 
                  className="glass border border-white/10 rounded-3xl p-8 h-full bg-gradient-to-br from-slate-500/5 to-transparent relative group cursor-pointer"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => navigate(`/debate-arena/${trendingDebate.id}`)}
                  whileHover={{ y: -4 }}
                >
                  <div className="absolute top-6 right-8 flex items-center gap-2 px-3 py-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full text-[10px] font-black tracking-widest uppercase">
                    <TrendingUp size={12} />
                    Trending Now
                  </div>
                  <div className="space-y-4">
                    <span className="text-xs font-black text-slate-500 uppercase tracking-widest">{trendingDebate.category}</span>
                    <h3 className="text-2xl font-bold text-white leading-tight">{trendingDebate.title}</h3>
                    <p className="text-slate-400 text-sm line-clamp-2">{trendingDebate.description}</p>
                    <div className="flex items-center gap-6 pt-4">
                      <div className="flex items-center gap-2 text-slate-300">
                        <Users size={16} />
                        <span className="text-sm">{trendingDebate.participantCount || 0} participants</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-300">
                        <Scale size={16} />
                        <span className="text-sm">{trendingDebate.votes_a + trendingDebate.votes_b} votes</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="glass border border-white/5 rounded-3xl p-8 h-full flex items-center justify-center text-slate-500 italic">
                  No active debates to spotlight
                </div>
              )}
              {trendingDebate && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setReportingDebate(trendingDebate.id);
                  }}
                  className="absolute bottom-6 right-8 z-20 flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-black tracking-widest uppercase text-amber-400 transition-all"
                >
                  <AlertTriangle size={12} />
                  Report Debate
                </button>
              )}
            </div>
          </div>

          {/* Filters & Grid */}
          <section>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 px-2">
              <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full shadow-[0_0_10px_rgba(148,163,184,0.5)] ${filter === 'Closed' ? 'bg-purple-400 shadow-purple-500/50' : 'bg-slate-500'}`} />
                {filter === 'Closed' ? 'Debate Archives' : 'Active Debates'}
              </h2>
              <div className="flex items-center gap-2 p-1 bg-white/5 border border-white/10 rounded-xl overflow-x-auto max-w-full">
                {['Hot', 'New', 'Most Participants'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                      filter === f ? 'bg-slate-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {debates.length === 0 ? (
              <div className="text-center py-20 bg-white/5 border border-white/5 rounded-3xl">
                <div className="text-5xl mb-4 opacity-20 text-slate-400">⚖️</div>
                <p className="text-slate-400 font-medium">The arena is quiet</p>
                <button onClick={() => setShowCreate(true)} className="mt-4 text-slate-500 hover:text-slate-300 text-sm underline decoration-slate-500 underline-offset-4">Start the first debate</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <AnimatePresence>
                  {debates.map((debate, i) => (
                    <motion.div
                      key={debate.id}
                      onClick={() => navigate(`/debate-arena/${debate.id}`)}
                      className="glass-hover rounded-2xl p-6 cursor-pointer border border-white/5 bg-gradient-to-br from-slate-500/5 to-transparent relative group overflow-hidden"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      whileHover={{ scale: 1.02, y: -4 }}
                      layout
                    >
                      <div className="flex items-start justify-between mb-4">
                        <span className="px-2 py-0.5 bg-slate-500/10 text-slate-400 border border-slate-500/20 rounded-md text-[10px] font-black uppercase tracking-wider">
                          {debate.category}
                        </span>
                        <div className="flex items-center gap-2">
                          {profile?.is_admin && (
                            <div className="flex items-center gap-1.5">
                              {debate.status !== 'closed' && (
                                <button 
                                  onClick={(e) => closeDebate(e, debate)}
                                  className="p-1.5 rounded-lg bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 transition-all"
                                  title="Close Debate"
                                >
                                  <Lock size={14} />
                                </button>
                              )}
                              <button 
                                onClick={(e) => deleteDebate(e, debate.id)}
                                className="p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all"
                                title="Delete Debate"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                          {debate.status === 'closed' && <Lock size={14} className="text-purple-400" />}
                          {debate.status === 'hot' && <Zap size={14} className="text-amber-500 fill-amber-500" />}
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setReportingDebate(debate.id);
                            }}
                            className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-all ml-1"
                            title="Report Debate"
                          >
                            <AlertTriangle size={14} />
                          </button>
                        </div>
                      </div>
                      <h3 className="font-bold text-white text-lg mb-2 line-clamp-2 group-hover:text-blue-400 transition-colors">
                        {debate.title}
                      </h3>
                      <p className="text-slate-400 text-xs mb-6 line-clamp-2 leading-relaxed">
                        {debate.description}
                      </p>
                      {debate.status === 'closed' ? (
                        <div className="py-3 px-4 rounded-xl bg-purple-500/10 border border-purple-500/20 mb-6 group-hover:bg-purple-500/20 transition-all">
                          <div className="text-[9px] font-black text-purple-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                             <Lock size={10} /> Victor of the Void
                          </div>
                          <div className="text-sm font-bold text-white italic">
                            {debate.winner === 'Draw' ? "Inconclusive (Draw)" : (debate.winner === 'A' ? debate.side_a_label : debate.side_b_label)}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3 mb-6">
                          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden flex">
                            <div 
                              className="h-full bg-blue-500/50" 
                              style={{ width: `${(debate.votes_a / (debate.votes_a + debate.votes_b || 1)) * 100}%` }}
                            />
                            <div 
                              className="h-full bg-red-500/50" 
                              style={{ width: `${(debate.votes_b / (debate.votes_a + debate.votes_b || 1)) * 100}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                            <span className="text-blue-400">{debate.side_a_label}</span>
                            <span className="text-red-400">{debate.side_b_label}</span>
                          </div>
                        </div>
                      )}
                      <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-slate-500">
                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="flex items-center gap-1.5" title="Participants"><Users size={12} />{debate.participantCount || 0}</span>
                          <span className="flex items-center gap-1.5" title="Total Votes"><Scale size={12} />{debate.votes_a + debate.votes_b}</span>
                          <span className="flex items-center gap-1.5" title="Arguments"><MessageSquare size={12} />{debate.argumentCount || 0}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400 group-hover:text-white transition-colors">
                          <span className="text-[10px] font-black">ENTERING</span>
                          <ArrowLeft size={10} className="rotate-180" />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/80 backdrop-blur-md"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}>
            <motion.div className="glass border border-white/10 rounded-3xl p-8 w-full max-w-lg shadow-[0_0_100px_rgba(0,0,0,1)]"
              initial={{ scale: 0.9, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-slate-500/20 flex items-center justify-center">
                  <Sword size={20} className="text-slate-400" />
                </div>
                <h2 className="text-xl font-bold text-white">Open the Arena</h2>
              </div>
              
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Topic Title</label>
                  <input type="text" className="input-field w-full" placeholder="e.g. AI vs Human Creativity"
                    value={newTitle} onChange={e => setNewTitle(e.target.value)} maxLength={80} />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Description / Context</label>
                  <textarea className="input-field w-full min-h-[100px] py-3 resize-none" placeholder="Provide some background..."
                    value={newDesc} onChange={e => setNewDesc(e.target.value)} maxLength={500} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Side A Label</label>
                    <input type="text" className="input-field w-full border-blue-500/20 focus:border-blue-500/50" placeholder="Support"
                      value={sideA} onChange={e => setSideA(e.target.value)} maxLength={20} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Side B Label</label>
                    <input type="text" className="input-field w-full border-red-500/20 focus:border-red-500/50" placeholder="Oppose"
                      value={sideB} onChange={e => setSideB(e.target.value)} maxLength={20} />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Category</label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map(c => (
                      <button
                        key={c}
                        onClick={() => setNewCategory(c)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                          newCategory === c ? 'bg-slate-500 border-slate-400 text-white' : 'bg-white/5 border-white/5 text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-4 mt-10">
                <motion.button 
                  onClick={createDebate} 
                  disabled={creating || !newTitle.trim()}
                  className="flex-1 bg-gradient-to-r from-slate-600 to-slate-800 disabled:opacity-50 text-white font-bold py-4 rounded-2xl shadow-lg transition-all"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {creating ? 'Opening Doors...' : 'Create Debate'}
                </motion.button>
                <button onClick={() => setShowCreate(false)} className="px-6 py-4 rounded-2xl border border-white/10 text-slate-400 font-bold hover:bg-white/5 transition-colors">Cancel</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ReportModal 
        isOpen={!!reportingDebate}
        onClose={() => setReportingDebate(null)}
        targetType="debate"
        targetId={reportingDebate || ''}
      />
    </div>
  );
}
