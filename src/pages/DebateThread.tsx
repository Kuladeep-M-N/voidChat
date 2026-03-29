import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ArrowLeft, 
  Users, 
  TrendingUp, 
  Clock, 
  Scale, 
  Send,
  MessageSquare,
  Zap,
  Star,
  User,
  MoreVertical,
  ChevronDown,
  Lock,
  Trash2,
  AlertTriangle,
  ShieldAlert
} from 'lucide-react';
import { useSystemConfig } from '../hooks/useSystemConfig';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  doc, 
  getDoc, 
  updateDoc, 
  addDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  increment,
  runTransaction
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
  side_a_label: string;
  side_b_label: string;
  votes_a: number;
  votes_b: number;
  participantCount: number;
  created_at: any;
  created_by: string;
  status: string;
  winner?: 'A' | 'B' | 'Draw';
}

interface Argument {
  id: string;
  content: string;
  side: 'A' | 'B';
  user_id: string;
  anonymous_username: string;
  created_at: any;
  reactions?: Record<string, number>;
}

export default function DebateThread() {
  const { id: debateId } = useParams<{ id: string }>();
  const { user, profile, loading } = useAuth();
  const { config } = useSystemConfig();
  const isDisabled = config.disableDebates && !profile?.is_admin;
  const safeMode = (config.safeMode || isDisabled) && !profile?.is_admin;
  const { markAsActive } = useNotifications();
  const navigate = useNavigate();

  const [debate, setDebate] = useState<Debate | null>(null);
  const [argumentsA, setArgumentsA] = useState<Argument[]>([]);
  const [argumentsB, setArgumentsB] = useState<Argument[]>([]);
  const [userVote, setUserVote] = useState<'A' | 'B' | null>(null);
  const [text, setText] = useState('');
  const [selectedSide, setSelectedSide] = useState<'A' | 'B' | null>(null);
  const [sending, setSending] = useState(false);
  const [activeParticipants, setActiveParticipants] = useState(1);
  const [reportingArg, setReportingArg] = useState<string | null>(null);

  const bottomRefA = useRef<HTMLDivElement>(null);
  const bottomRefB = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) navigate('/join');
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!debateId || !user) return;

    // Fetch Debate Metadata
    const debateRef = doc(db, 'debates', debateId);
    const unsubDebate = onSnapshot(debateRef, (snap) => {
      if (snap.exists()) {
        setDebate({ id: snap.id, ...snap.data() } as Debate);
      } else {
        navigate('/debate-arena');
      }
    });

    // Fetch User Vote
    const voteRef = doc(db, 'debate_votes', `${debateId}_${user.uid}`);
    getDoc(voteRef).then(snap => {
      if (snap.exists()) setUserVote(snap.data().side);
    });

    // Fetch Arguments
    const argQ = query(
      collection(db, 'debate_arguments'), 
      where('debate_id', '==', debateId),
      orderBy('created_at', 'asc')
    );
    
    let unsubArgsFunction = () => {};

    const setupArgumentsFallback = () => {
      console.warn("Falling back to un-ordered query due to missing index...");
      const fallbackQ = query(collection(db, 'debate_arguments'), where('debate_id', '==', debateId));
      return onSnapshot(fallbackQ, (snap) => {
        const a: Argument[] = [];
        const b: Argument[] = [];
        snap.forEach(doc => {
          const data = { id: doc.id, ...doc.data() } as Argument;
          if (data.side === 'A') a.push(data);
          else b.push(data);
        });
        
        const sortFn = (x: Argument, y: Argument) => {
          const timeX = x.created_at?.toMillis?.() || x.created_at?.seconds * 1000 || Date.now();
          const timeY = y.created_at?.toMillis?.() || y.created_at?.seconds * 1000 || Date.now();
          return timeX - timeY;
        };

        setArgumentsA(a.sort(sortFn));
        setArgumentsB(b.sort(sortFn));
      });
    };

    const unsubArgs = onSnapshot(argQ, {
      next: (snap) => {
        const a: Argument[] = [];
        const b: Argument[] = [];
        snap.forEach(doc => {
          const data = { id: doc.id, ...doc.data() } as Argument;
          if (data.side === 'A') a.push(data);
          else b.push(data);
        });
        
        const sortFn = (x: Argument, y: Argument) => {
          const timeX = x.created_at?.toMillis?.() || (x.created_at?.seconds || 0) * 1000 || Date.now();
          const timeY = y.created_at?.toMillis?.() || (y.created_at?.seconds || 0) * 1000 || Date.now();
          return timeX - timeY;
        };

        setArgumentsA(a.sort(sortFn));
        setArgumentsB(b.sort(sortFn));
      },
      error: (err) => {
        console.error("Arguments Snapshot Error:", err);
        if (err.code === 'failed-precondition') {
          unsubArgsFunction(); // Cleanup initial attempt
          unsubArgsFunction = setupArgumentsFallback();
        } else {
          toast.error("Failed to load arguments");
        }
      }
    });

    unsubArgsFunction = unsubArgs;

    // Room Presence Pulse
    const pulsePresence = async () => {
      try {
        await setDoc(doc(db, 'debate_presence', debateId, 'active_users', user.uid), {
          user_id: user.uid,
          last_seen: serverTimestamp()
        });
      } catch (e) {
        console.error("Presence Pulse Error:", e);
      }
    };
    pulsePresence();
    const pulseInterval = setInterval(pulsePresence, 30000);

    // Room Presence Listener
    const presenceQuery = query(
      collection(db, 'debate_presence', debateId, 'active_users'),
      where('last_seen', '>', new Date(Date.now() - 60000))
    );
    const unsubPresence = onSnapshot(presenceQuery, (snap) => {
      setActiveParticipants(Math.max(1, snap.size));
    });

    return () => {
      unsubDebate();
      unsubArgsFunction();
      clearInterval(pulseInterval);
      unsubPresence();
    };
  }, [debateId, user, navigate]);

  const handleVote = async (side: 'A' | 'B') => {
    if (!user || !debateId || userVote === side || debate?.status === 'closed' || safeMode || isDisabled) return;

    // Optimistic Update
    const oldVote = userVote;
    setUserVote(side);
    
    setDebate(prev => {
      if (!prev) return prev;
      const newVotes = { ...prev };
      if (oldVote) {
        newVotes[`votes_${oldVote.toLowerCase()}` as 'votes_a' | 'votes_b'] -= 1;
      } else {
        newVotes.participantCount += 1;
      }
      newVotes[`votes_${side.toLowerCase()}` as 'votes_a' | 'votes_b'] += 1;
      return newVotes;
    });

    try {
      await runTransaction(db, async (transaction) => {
        const voteRef = doc(db, 'debate_votes', `${debateId}_${user.uid}`);
        const debateRef = doc(db, 'debates', debateId);
        
        transaction.set(voteRef, {
          debate_id: debateId,
          user_id: user.uid,
          side,
          created_at: serverTimestamp()
        });

        if (oldVote) {
          transaction.update(debateRef, {
            [`votes_${oldVote.toLowerCase()}`]: increment(-1),
            [`votes_${side.toLowerCase()}`]: increment(1)
          });
        } else {
          transaction.update(debateRef, {
            [`votes_${side.toLowerCase()}`]: increment(1),
            participantCount: increment(1)
          });
        }
      });
      // Toast on success - no need to update state again as we did it optimistically
      // and onSnapshot will eventually bring the server truth anyway.
      toast.success(`Vote cast: ${side === 'A' ? debate?.side_a_label : debate?.side_b_label}`);
    } catch (e) {
      console.error(e);
      // Revert optimistic update on failure
      setUserVote(oldVote);
      setDebate(prev => {
        if (!prev) return prev;
        const revert = { ...prev };
        revert[`votes_${side.toLowerCase()}` as 'votes_a' | 'votes_b'] -= 1;
        if (oldVote) {
          revert[`votes_${oldVote.toLowerCase()}` as 'votes_a' | 'votes_b'] += 1;
        } else {
          revert.participantCount -= 1;
        }
        return revert;
      });
      toast.error('Voting failed. Please try again.');
    }
  };

  const closeDebate = async () => {
    if (!debate || (debate.created_by !== user?.uid && !profile?.is_admin)) return;
    
    const confirm = window.confirm('Are you sure you want to close this debate? This will determine the winner and lock further arguments forever.');
    if (!confirm) return;

    const winner = debate.votes_a > debate.votes_b ? 'A' : 
                   debate.votes_b > debate.votes_a ? 'B' : 'Draw';
    
    try {
      await updateDoc(doc(db, 'debates', debateId), {
        status: 'closed',
        winner
      });
      toast.success('Debate has been closed');
    } catch (e) {
      toast.error('Failed to close debate');
    }
  };

  const deleteDebate = async () => {
    if (!debate || (debate.created_by !== user?.uid && !profile?.is_admin)) return;
    if (!window.confirm('Are you sure you want to delete this debate?')) return;

    try {
      await deleteDoc(doc(db, 'debates', debateId));
      toast.success('Debate deleted');
      navigate('/debate-arena');
    } catch (e) {
      toast.error('Failed to delete debate');
    }
  };

  const postArgument = async () => {
    if (!text.trim() || !selectedSide || !user || !debateId || !profile || isDisabled) return;
    setSending(true);

    try {
      await runTransaction(db, async (transaction) => {
        const debateRef = doc(db, 'debates', debateId);
        const argRef = doc(collection(db, 'debate_arguments'));
        
        transaction.set(argRef, {
          debate_id: debateId,
          user_id: user.uid,
          content: text.trim(),
          side: selectedSide,
          anonymous_username: profile.anonymous_username,
          created_at: serverTimestamp(),
        });

        transaction.update(debateRef, {
          argumentCount: increment(1)
        });
      });
      setText('');
      toast.success('Argument posted to the void');
    } catch (e) {
      console.error(e);
      toast.error('Failed to post argument');
    } finally {
      setSending(false);
    }
  };

  if (!debate) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" /></div>;

  const totalVotes = debate.votes_a + debate.votes_b;
  const pctA = totalVotes > 0 ? Math.round((debate.votes_a / totalVotes) * 100) : 50;
  const pctB = 100 - pctA;

  return (
    <div className="h-[100dvh] bg-[#07070f] flex flex-col relative overflow-hidden">
      <div className="ambient-blob w-full h-[300px] bg-slate-600/05 top-0 left-0" />
      
      {/* Header */}
      <header className="relative z-20 border-b border-white/5 glass sticky top-0">
        <div className="max-w-7xl mx-auto flex items-start justify-between gap-3 sm:gap-4 px-4 sm:px-6 py-2 sm:py-4">
          <div className="flex items-start gap-2 sm:gap-4 flex-1 min-w-0">
            <button onClick={() => navigate('/debate-arena')} className="p-1 sm:p-2 mt-0.5 sm:mt-0 hover:bg-white/5 rounded-full transition-colors shrink-0">
              <ArrowLeft size={18} className="text-slate-400 sm:w-[20px] sm:h-[20px]" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-base sm:text-lg md:text-xl font-bold text-white line-clamp-2 md:line-clamp-1 break-words leading-tight">{debate.title}</h1>
              <p className="text-[9px] sm:text-[10px] font-black text-slate-500 uppercase tracking-widest mt-0.5">{debate.category}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-6 text-slate-400 shrink-0">
            {((debate.created_by === user?.uid) || profile?.is_admin) && debate.status !== 'closed' && (
              <div className="flex items-center gap-1 sm:gap-2 mr-2 sm:mr-4 border-r border-white/10 pr-2 sm:pr-4">
                <button 
                  onClick={closeDebate}
                  className="p-1.5 sm:px-3 sm:py-1.5 rounded-lg bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 text-[10px] font-black tracking-widest transition-all flex items-center justify-center sm:gap-2"
                  title="Close Debate"
                >
                  <Lock size={14} /> <span className="hidden sm:inline">CLOSE</span>
                </button>
                <button 
                  onClick={deleteDebate}
                  className="p-1.5 sm:px-3 sm:py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-[10px] font-black tracking-widest transition-all flex items-center justify-center sm:gap-2"
                  title="Delete Debate"
                >
                  <Trash2 size={14} /> <span className="hidden sm:inline">DELETE</span>
                </button>
              </div>
            )}
            <div className="flex items-center gap-1 sm:gap-2">
              <Users size={14} className="sm:hidden" />
              <Users size={16} className="hidden sm:block" />
              <span className="text-xs sm:text-sm font-bold">{activeParticipants}</span>
            </div>
          </div>
        </div>

        {/* Real-time Vote Bar */}
        <div className="w-full h-1 bg-white/5 flex">
          <motion.div className="h-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]" animate={{ width: `${pctA}%` }} />
          <motion.div className="h-full bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]" animate={{ width: `${pctB}%` }} />
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col max-w-7xl mx-auto w-full px-4 sm:px-6 py-3 sm:py-8 overflow-hidden">
        <motion.div 
          className="glass border border-white/5 rounded-xl sm:rounded-2xl p-4 sm:p-6 mb-3 sm:mb-8 bg-gradient-to-r from-blue-500/05 to-red-500/05"
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        >
          <p className="text-sm text-slate-300 leading-relaxed italic opacity-80">
            "{debate.description}"
          </p>
        </motion.div>

        {debate.status === 'closed' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-6 rounded-2xl bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/30 backdrop-blur-xl text-center shadow-[0_0_30px_rgba(168,85,247,0.15)]"
          >
            <div className="text-[10px] font-black text-purple-400 mb-2 uppercase tracking-widest flex items-center justify-center gap-2">
              <Lock size={12} /> Debate Concluded
            </div>
            <h2 className="text-2xl font-black text-white mb-2 italic">
              {debate.winner === 'Draw' ? "It's a Draw!" : `The Void has decided: ${debate.winner === 'A' ? debate.side_a_label : debate.side_b_label} wins!`}
            </h2>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-tight">Final Votes: {debate.votes_a} {debate.side_a_label} — {debate.votes_b} {debate.side_b_label}</p>
          </motion.div>
        )}

        {/* Arena Grid */}
        <div className="flex-1 grid grid-cols-1 grid-rows-2 md:grid-rows-1 md:grid-cols-2 gap-3 md:gap-8 min-h-0 mb-32 md:mb-20 overflow-hidden lg:overflow-visible">
          {/* Side A */}
          <div className="flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2 sm:mb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
                  <Star size={16} />
                </div>
                <h2 className="font-black text-blue-400 uppercase tracking-widest text-sm">{debate.side_a_label}</h2>
              </div>
              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  if (safeMode) {
                    toast.error('Voting is restricted during Safe Mode');
                    return;
                  }
                  handleVote('A');
                }}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl text-[11px] font-black transition-all ${
                  userVote === 'A' 
                    ? 'bg-blue-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.5)] border-transparent' 
                    : 'bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20'
                } ${safeMode ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className={`w-2 h-2 rounded-full ${userVote === 'A' ? 'bg-white animate-pulse' : 'bg-blue-500'}`} />
                {safeMode ? 'SAFE MODE' : `${pctA}% VOTE ${userVote === 'A' ? 'CAST' : ''}`}
              </motion.button>
            </div>
            <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
              {argumentsA.map((arg) => <ArgumentCard key={arg.id} arg={arg} color="blue" onReport={setReportingArg} />)}
              {argumentsA.length === 0 && <EmptySide side="A" />}
              <div ref={bottomRefA} />
            </div>
          </div>

          {/* Side B */}
          <div className="flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2 sm:mb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center text-red-400">
                  <Zap size={16} />
                </div>
                <h2 className="font-black text-red-400 uppercase tracking-widest text-sm">{debate.side_b_label}</h2>
              </div>
              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  if (safeMode) {
                    toast.error('Voting is restricted during Safe Mode');
                    return;
                  }
                  handleVote('B');
                }}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl text-[11px] font-black transition-all ${
                  userVote === 'B' 
                    ? 'bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)] border-transparent' 
                    : 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20'
                } ${safeMode ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className={`w-2 h-2 rounded-full ${userVote === 'B' ? 'bg-white animate-pulse' : 'bg-red-500'}`} />
                {safeMode ? 'SAFE MODE' : `${pctB}% VOTE ${userVote === 'B' ? 'CAST' : ''}`}
              </motion.button>
            </div>
            <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
              {argumentsB.map((arg) => <ArgumentCard key={arg.id} arg={arg} color="red" onReport={setReportingArg} />)}
              {argumentsB.length === 0 && <EmptySide side="B" />}
              <div ref={bottomRefB} />
            </div>
          </div>
        </div>
      </main>

      {/* Input Bar - Floating Style */}
      {debate.status === 'active' ? (
        <div className="fixed bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 w-full max-w-3xl px-4 sm:px-6 z-30">
          <div className="glass border border-white/10 rounded-2xl p-2 shadow-2xl">
            {safeMode ? (
              <div className="flex items-center justify-center p-4 gap-3 text-red-400 font-bold uppercase tracking-widest text-xs">
                <ShieldAlert size={18} />
                Emergency Moderation Mode Active
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-2">
                  <button 
                    onClick={() => setSelectedSide('A')}
                    className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-black border transition-all ${
                      selectedSide === 'A' ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-white/5 border-white/5 text-slate-500'
                    }`}
                  >
                    SIDE {debate.side_a_label.toUpperCase()}
                  </button>
                  <button 
                    onClick={() => setSelectedSide('B')}
                    className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-black border transition-all ${
                      selectedSide === 'B' ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-white/5 border-white/5 text-slate-500'
                    }`}
                  >
                    SIDE {debate.side_b_label.toUpperCase()}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input 
                    type="text" 
                    className="input-field flex-1 h-12 py-0 border-none bg-transparent rounded-none focus:bg-transparent" 
                    placeholder={selectedSide ? `Speak for Side ${selectedSide === 'A' ? debate.side_a_label : debate.side_b_label}...` : "Choose a side to speak..."}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        postArgument();
                      }
                    }}
                    disabled={!selectedSide}
                  />
                  <motion.button 
                    onClick={postArgument}
                    disabled={!text.trim() || !selectedSide || sending}
                    className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                      text.trim() && selectedSide ? 'bg-slate-200 text-slate-900 shadow-lg' : 'bg-white/5 text-slate-500'
                    }`}
                    whileTap={{ scale: 0.9 }}
                  >
                    <Send size={18} fill="currentColor" />
                  </motion.button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl px-6 z-30">
          <div className="glass border border-white/10 rounded-2xl p-4 text-center bg-black/40 backdrop-blur-xl">
            <p className="text-xs font-black text-slate-500 uppercase tracking-widest">The debate is settled. The void has spoken.</p>
          </div>
        </div>
      )}

      <ReportModal 
        isOpen={!!reportingArg}
        onClose={() => setReportingArg(null)}
        targetType="debate_argument"
        targetId={reportingArg || ''}
      />
    </div>
  );
}

function ArgumentCard({ arg, color, onReport }: { arg: Argument, color: 'blue' | 'red', onReport: (id: string) => void }) {
  const isMe = arg.user_id === 'me'; // Just for visual demo
  return (
    <motion.div 
      className={`p-3 sm:p-4 rounded-xl glass border border-white/5 relative group ${color === 'blue' ? 'hover:border-blue-500/20' : 'hover:border-red-500/20'}`}
      initial={{ opacity: 0, x: color === 'blue' ? -20 : 20 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${color === 'blue' ? 'bg-blue-400' : 'bg-red-400'}`} />
          <span className="text-[10px] font-black text-slate-500">{arg.anonymous_username}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-slate-600">
            {arg.created_at?.toDate ? arg.created_at.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
          </span>
          <button 
            onClick={() => onReport(arg.id)}
            className="p-1 text-slate-600 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-all"
            title="Report Argument"
          >
            <AlertTriangle size={12} />
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-200 leading-relaxed">{arg.content}</p>
    </motion.div>
  );
}

function EmptySide({ side }: { side: 'A' | 'B' }) {
  return (
    <div className="py-12 flex flex-col items-center justify-center text-slate-600 border border-dashed border-white/5 rounded-2xl">
      <Scale size={32} className="opacity-10 mb-2" />
      <p className="text-xs font-medium">No arguments yet</p>
    </div>
  );
}
