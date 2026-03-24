import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  getDocs,
  increment
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { AlertTriangle, ShieldAlert, ArrowLeft, Bookmark, BookmarkCheck, Share2, Zap, MessageSquarePlus, Eye, ChevronDown, Flame, TrendingUp, Users, Hash, Plus, Send, X, Activity } from 'lucide-react';
import ReportModal from '../components/ReportModal';
import { useSystemConfig } from '../hooks/useSystemConfig';
import { toast } from 'sonner';
import FeatureDisabledBanner from '../components/FeatureDisabledBanner';

interface QnaQuestion {
  id: string;
  title: string;
  content: string;
  tag: string;
  user_id: string;
  upvotes: number;
  views: number;
  is_resolved: boolean;
  created_at: any;
}

interface QnaAnswer {
  id: string;
  question_id: string;
  content: string;
  user_id: string;
  upvotes: number;
  is_accepted: boolean;
  created_at: any;
}

const TAGS = ['general', 'career', 'relationships', 'study', 'tech', 'random'] as const;
const SORT_OPTIONS = ['new', 'hot', 'unanswered'] as const;
const STATUS_OPTIONS = ['all', 'open', 'resolved'] as const;

const TAG_COLORS: Record<string, string> = {
  general: 'neon-tag-purple',
  career: 'neon-tag-cyan',
  relationships: 'neon-tag-pink',
  study: 'neon-tag-amber',
  tech: 'neon-tag-cyan',
  random: 'neon-tag-purple',
};

const MOODS = ['🔥', '😌', '💭', '🤯', '💡'] as const;
const ANON_LEVELS = ['Whisper', 'Shadow', 'Phantom'] as const;

const aliasAdjectives = ['Silent', 'Hidden', 'Neon', 'Midnight', 'Arc', 'Echo', 'Zero', 'Nova'];
const aliasNouns = ['Cipher', 'Lantern', 'Voyager', 'Falcon', 'Pulse', 'Vertex', 'Comet', 'Signal'];

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const getAnonymousAlias = (userId: string, isMe: boolean) => {
  if (isMe) return 'You (Anonymous)';
  const hash = hashString(userId);
  const adj = aliasAdjectives[hash % aliasAdjectives.length];
  const noun = aliasNouns[Math.floor(hash / aliasAdjectives.length) % aliasNouns.length];
  const suffix = `${(hash % 900) + 100}`;
  return `${adj} ${noun} ${suffix}`;
};

const timeAgo = (date: any) => {
  if (!date) return 'just now';
  const d = date?.toDate ? date.toDate() : new Date(date);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

export default function QnA() {
  const { user, profile, loading } = useAuth();
  const { config } = useSystemConfig();
  const isQnADisabled = config.disableQnA && !profile?.is_admin;
  const safeMode = (config.safeMode || isQnADisabled) && !profile?.is_admin;
  const navigate = useNavigate();

  const [questions, setQuestions] = useState<QnaQuestion[]>([]);
  const [answers, setAnswers] = useState<QnaAnswer[]>([]);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tag, setTag] = useState<typeof TAGS[number]>('general');
  const [questionSubmitting, setQuestionSubmitting] = useState(false);

  const [answerText, setAnswerText] = useState('');
  const [answerSubmitting, setAnswerSubmitting] = useState(false);
  const [questionError, setQuestionError] = useState('');
  const [answerError, setAnswerError] = useState('');

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<typeof SORT_OPTIONS[number]>('new');
  const [statusFilter, setStatusFilter] = useState<typeof STATUS_OPTIONS[number]>('all');

  const [questionVotes, setQuestionVotes] = useState<Set<string>>(new Set());
  const [answerVotes, setAnswerVotes] = useState<Set<string>>(new Set());
  const [viewedQuestionIds, setViewedQuestionIds] = useState<Set<string>>(new Set());
  const [reportingContent, setReportingContent] = useState<{ id: string; type: 'question' | 'answer' } | null>(null);

  // UI-only states
  const [askModalOpen, setAskModalOpen] = useState(false);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [anonLevel, setAnonLevel] = useState(1);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('voidchat-qna-bookmarks') ?? '[]')); }
    catch { return new Set(); }
  });

  useEffect(() => {
    if (!loading && !user) navigate('/join');
  }, [loading, navigate, user]);

  useEffect(() => {
    if (!user) return;

    // 1. Questions Real-time Sync
    const qQuery = query(collection(db, 'qna_questions'), orderBy('created_at', 'desc'));
    const unsubscribeQuestions = onSnapshot(qQuery, (snapshot) => {
      const items: QnaQuestion[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as QnaQuestion);
      });
      setQuestions(items);
    });

    // 2. Answers Real-time Sync
    const aQuery = query(collection(db, 'qna_answers'), orderBy('created_at', 'asc'));
    const unsubscribeAnswers = onSnapshot(aQuery, (snapshot) => {
      const items: QnaAnswer[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as QnaAnswer);
      });
      setAnswers(items);
    });

    return () => {
      unsubscribeQuestions();
      unsubscribeAnswers();
    };
  }, [user]);

  const answersByQuestion = useMemo(() => {
    const map = new Map<string, QnaAnswer[]>();
    answers.forEach((answer) => {
      const list = map.get(answer.question_id) ?? [];
      list.push(answer);
      map.set(answer.question_id, list);
    });
    return map;
  }, [answers]);

  const activeQuestion = useMemo(
    () => questions.find((question) => question.id === activeQuestionId) ?? null,
    [activeQuestionId, questions],
  );

  const activeQuestionAnswers = useMemo(() => {
    if (!activeQuestionId) return [];
    const list = [...(answersByQuestion.get(activeQuestionId) ?? [])];
    list.sort((a, b) => {
      if (a.is_accepted && !b.is_accepted) return -1;
      if (!a.is_accepted && b.is_accepted) return 1;
      if (a.upvotes !== b.upvotes) return b.upvotes - a.upvotes;
      const aTime = a.created_at?.toDate ? a.created_at.toDate().getTime() : new Date(a.created_at || 0).getTime();
      const bTime = b.created_at?.toDate ? b.created_at.toDate().getTime() : new Date(b.created_at || 0).getTime();
      return aTime - bTime;
    });
    return list;
  }, [activeQuestionId, answersByQuestion]);

  const visibleQuestions = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const filtered = questions.filter((question) => {
      const byStatus =
        statusFilter === 'all' ||
        (statusFilter === 'resolved' && question.is_resolved) ||
        (statusFilter === 'open' && !question.is_resolved);
      if (!byStatus) return false;
      if (!keyword) return true;
      return (
        question.title.toLowerCase().includes(keyword) ||
        question.content.toLowerCase().includes(keyword) ||
        question.tag.toLowerCase().includes(keyword)
      );
    });

    return [...filtered].sort((a, b) => {
      const aTime = a.created_at?.toDate ? a.created_at.toDate().getTime() : new Date(a.created_at || 0).getTime();
      const bTime = b.created_at?.toDate ? b.created_at.toDate().getTime() : new Date(b.created_at || 0).getTime();

      if (sortBy === 'new') return bTime - aTime;
      if (sortBy === 'unanswered') {
        const aAnswered = (answersByQuestion.get(a.id) ?? []).length;
        const bAnswered = (answersByQuestion.get(b.id) ?? []).length;
        if (aAnswered !== bAnswered) return aAnswered - bAnswered;
        return bTime - aTime;
      }
      const scoreA = a.upvotes * 3 + (answersByQuestion.get(a.id)?.length ?? 0) * 2 + a.views;
      const scoreB = b.upvotes * 3 + (answersByQuestion.get(b.id)?.length ?? 0) * 2 + b.views;
      return scoreB - scoreA;
    });
  }, [answersByQuestion, questions, search, sortBy, statusFilter]);

  const totalAnswers = answers.length;
  const resolvedCount = questions.filter((question) => question.is_resolved).length;
  const resolutionRate = questions.length > 0 ? Math.round((resolvedCount / questions.length) * 100) : 0;
  const uniqueContributors = new Set([...questions.map(q => q.user_id), ...answers.map(a => a.user_id)]).size;

  // Knowledge Pulse data
  const trendingQuestions = useMemo(() => {
    return [...questions]
      .sort((a, b) => {
        const sA = a.upvotes * 3 + (answersByQuestion.get(a.id)?.length ?? 0) * 2 + a.views;
        const sB = b.upvotes * 3 + (answersByQuestion.get(b.id)?.length ?? 0) * 2 + b.views;
        return sB - sA;
      })
      .slice(0, 4);
  }, [questions, answersByQuestion]);

  const tagActivity = useMemo(() => {
    const counts: Record<string, number> = {};
    questions.forEach(q => { counts[q.tag] = (counts[q.tag] ?? 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [questions]);

  const recentActivity = useMemo(() => {
    const combined = [
      ...questions.map(q => ({ type: 'question', time: q.created_at, user: q.user_id, id: q.id })),
      ...answers.map(a => ({ type: 'answer', time: a.created_at, user: a.user_id, id: a.id }))
    ];
    return combined
      .filter(item => item.time)
      .sort((a, b) => {
        const aT = a.time.toDate ? a.time.toDate().getTime() : new Date(a.time).getTime();
        const bT = b.time.toDate ? b.time.toDate().getTime() : new Date(b.time).getTime();
        return bT - aT;
      })
      .slice(0, 10);
  }, [questions, answers]);

  const submitQuestion = async () => {
    if (!user || questionSubmitting || safeMode || isQnADisabled) return;
    const cleanTitle = title.trim();
    const cleanContent = content.trim();
    if (!cleanTitle || !cleanContent) return;

    setQuestionSubmitting(true);
    setQuestionError('');

    try {
      await addDoc(collection(db, 'qna_questions'), {
        title: cleanTitle,
        content: cleanContent,
        tag,
        user_id: user.uid,
        upvotes: 0,
        views: 0,
        is_resolved: false,
        created_at: serverTimestamp(),
      });

      setTitle('');
      setContent('');
      setTag('general');
      setSelectedMood(null);
      setAskModalOpen(false);
      toast.success('Question echoed into the void.');
    } catch (err: any) {
      console.error('Question submit error:', err);
      setQuestionError(err.message.includes('check constraint') 
        ? 'Title must be 5+ chars, Content must be 10+ chars.' 
        : 'Failed to post: ' + err.message);
    } finally {
      setQuestionSubmitting(false);
    }
  };

  const submitAnswer = async () => {
    if (!user || !activeQuestion || answerSubmitting || safeMode || isQnADisabled) return;
    const clean = answerText.trim();
    if (!clean) return;

    setAnswerSubmitting(true);
    setAnswerError('');

    try {
      await addDoc(collection(db, 'qna_answers'), {
        question_id: activeQuestion.id,
        content: clean,
        user_id: user.uid,
        upvotes: 0,
        is_accepted: false,
        created_at: serverTimestamp(),
      });
      setAnswerText('');
      toast.success('Your answer has been etched.');
    } catch (err: any) {
      console.error('Answer submit error:', err);
      setAnswerError(err.message.includes('check constraint') 
        ? 'Answer is too short (min 2 chars).' 
        : 'Failed to post answer.');
    } finally {
      setAnswerSubmitting(false);
    }
  };

  const upvoteQuestion = async (e: React.MouseEvent, question: QnaQuestion) => {
    e.stopPropagation();
    if (questionVotes.has(question.id) || safeMode) return;
    setQuestionVotes((prev) => new Set(prev).add(question.id));
    
    try {
      await updateDoc(doc(db, 'qna_questions', question.id), {
        upvotes: increment(1)
      });
    } catch (err) {
      console.error('Upvote question error:', err);
    }
  };

  const upvoteAnswer = async (answer: QnaAnswer) => {
    if (answerVotes.has(answer.id) || safeMode) return;
    setAnswerVotes((prev) => new Set(prev).add(answer.id));

    try {
      await updateDoc(doc(db, 'qna_answers', answer.id), {
        upvotes: increment(1)
      });
    } catch (err) {
      console.error('Upvote answer error:', err);
    }
  };

  const openQuestion = async (question: QnaQuestion) => {
    setActiveQuestionId(question.id);
    if (viewedQuestionIds.has(question.id)) return;
    setViewedQuestionIds((prev) => new Set(prev).add(question.id));
    
    try {
      await updateDoc(doc(db, 'qna_questions', question.id), {
        views: increment(1)
      });
    } catch (err) {
      console.error('View count error:', err);
    }
  };

  const acceptAnswer = async (answer: QnaAnswer) => {
    if (!user || !activeQuestion || activeQuestion.user_id !== user.uid) return;

    const questionAnswers = answersByQuestion.get(activeQuestion.id) ?? [];
    const currentlyAccepted = questionAnswers.find((item) => item.is_accepted);
    const shouldAccept = !answer.is_accepted;

    try {
      if (currentlyAccepted && currentlyAccepted.id !== answer.id) {
        await updateDoc(doc(db, 'qna_answers', currentlyAccepted.id), { is_accepted: false });
      }
      await updateDoc(doc(db, 'qna_answers', answer.id), { is_accepted: shouldAccept });
      await updateDoc(doc(db, 'qna_questions', activeQuestion.id), { is_resolved: shouldAccept });
    } catch (err) {
      console.error('Accept answer error:', err);
    }
  };

  const deleteQuestion = async (e: React.MouseEvent, question: QnaQuestion) => {
    e.stopPropagation();
    if (!user || (question.user_id !== user.uid && !profile?.is_admin)) return;
    
    if (activeQuestionId === question.id) setActiveQuestionId(null);

    try {
      await deleteDoc(doc(db, 'qna_questions', question.id));
      const answersSnap = await getDocs(query(collection(db, 'qna_answers'), where('question_id', '==', question.id)));
      const deletePromises = answersSnap.docs.map(a => deleteDoc(a.ref));
      await Promise.all(deletePromises);
      toast.success('Node removed from network.');
    } catch (err) {
      console.error('Delete question error:', err);
    }
  };

  const deleteAnswer = async (answer: QnaAnswer) => {
    if (!user || (answer.user_id !== user.uid && !profile?.is_admin)) return;

    try {
      await deleteDoc(doc(db, 'qna_answers', answer.id));
    } catch (err) {
      console.error('Delete answer error:', err);
    }
  };

  const toggleBookmark = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setBookmarkedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('voidchat-qna-bookmarks', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const shareQuestion = (e: React.MouseEvent, question: QnaQuestion) => {
    e.stopPropagation();
    const url = `${window.location.origin}/qna#${question.id}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Link copied to clipboard!'));
  };

  const isHot = (question: QnaQuestion) => {
    const answerCount = answersByQuestion.get(question.id)?.length ?? 0;
    return question.upvotes >= 3 || answerCount >= 3;
  };

  const isNew = (question: QnaQuestion) => {
    const d = question.created_at?.toDate ? question.created_at.toDate() : new Date(question.created_at);
    return (Date.now() - d.getTime()) < 3600000; // 1 hour
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center qna-space">
        <div className="w-12 h-12 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="qna-space min-h-screen">
      <div className="qna-noise" />
      <div className="ambient-blob w-[700px] h-[700px] bg-violet-600/10 top-[-150px] left-[-100px]" />
      <div className="ambient-blob w-[600px] h-[600px] bg-cyan-500/8 bottom-[-120px] right-[-80px]" />

      {/* ─── HEADER ─── */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#070710]/70 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-400 hover:text-white transition-all">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-violet-400/70 font-bold">Void Thread Flow</p>
              <h1 className="text-xl font-semibold text-white">Knowledge <span className="text-gradient">Network</span></h1>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-4">
            <div className="qna-control-panel flex items-center gap-2 px-3 py-1.5 border-white/5 bg-white/3">
              <Activity size={14} className="text-violet-400" />
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none">
                {questions.length} Nodes · {resolutionRate}% Linked
              </span>
            </div>
            <div className="flex bg-white/5 border border-white/10 rounded-2xl p-0.5">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setStatusFilter(opt)}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${
                    statusFilter === opt ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-48 lg:w-64">
             <input
                className="input-field py-2 pr-8 text-xs border-white/10 bg-white/5"
                placeholder="Search network..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Hash size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
        <div className="grid lg:grid-cols-[1fr_320px] gap-10">
          
          {/* ─── THREAD FLOW ─── */}
          <div className="thread-flow-container">
            {/* Background Neural Lines */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" style={{ zIndex: 0 }}>
              <defs>
                <linearGradient id="lineGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.2" />
                </linearGradient>
              </defs>
              <AnimatePresence>
                {visibleQuestions.slice(1).map((_, i) => (
                  <motion.path
                    key={`line-${i}`}
                    className="thread-line-path"
                    d={`M ${visibleQuestions[i % 2 === 0 ? 0 : 1] ? '50%' : '50%'} ${i * 120 + 60} Q ${i % 2 === 0 ? '70%' : '30%'} ${i * 120 + 120} 50% ${i * 120 + 200}`}
                    stroke="url(#lineGrad)"
                    strokeWidth="1.5"
                    fill="none"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 0.15 }}
                    transition={{ duration: 2, delay: i * 0.1 }}
                  />
                ))}
              </AnimatePresence>
            </svg>

            <div className="relative z-10 space-y-2">
              <AnimatePresence>
                {visibleQuestions.map((q, idx) => {
                  const hot = isHot(q);
                  const isNewNode = isNew(q);
                  const unanswered = (answersByQuestion.get(q.id)?.length ?? 0) === 0 && !q.is_resolved;
                  const isEven = idx % 2 === 0;

                  return (
                    <motion.div
                      key={q.id}
                      className="thread-node-wrapper"
                      style={{ justifyContent: isEven ? 'flex-start' : 'flex-end', paddingLeft: isEven ? '0' : '2rem', paddingRight: isEven ? '2rem' : '0' }}
                      initial={{ opacity: 0, x: isEven ? -40 : 40, y: 30 }}
                      animate={{ opacity: 1, x: 0, y: 0 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.5, delay: idx * 0.1 }}
                    >
                      <div 
                        className={`thread-node ${hot ? 'node-hot' : ''} ${isNewNode ? 'node-new' : ''} ${unanswered ? 'node-unanswered' : ''}`}
                        onClick={() => openQuestion(q)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`neon-tag text-[9px] ${TAG_COLORS[q.tag] ?? 'neon-tag-purple'}`}>#{q.tag}</span>
                          <div className="flex gap-2">
                            {q.is_resolved && <span className="qna-badge qna-badge-solved text-[8px]">Linked</span>}
                            {hot && <Flame size={12} className="text-orange-400" />}
                          </div>
                        </div>

                        <h3 className="text-sm font-bold text-white mb-2 leading-tight group-hover:text-violet-300 transition-colors">
                          {q.title}
                        </h3>
                        <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2 mb-4 italic">
                          "{q.content}"
                        </p>

                        <div className="flex items-center justify-between border-t border-white/5 pt-3">
                          <div className="flex items-center gap-3 text-[10px] text-slate-500 font-bold uppercase tracking-tighter">
                            <span className="flex items-center gap-1"><Eye size={10} /> {q.views}</span>
                            <span className="flex items-center gap-1"><Zap size={10} /> {q.upvotes}</span>
                            <span>{timeAgo(q.created_at)}</span>
                          </div>
                          
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => toggleBookmark(e, q.id)} className={`p-1.5 rounded-lg border transition-all ${bookmarkedIds.has(q.id) ? 'border-violet-500/40 bg-violet-500/10 text-violet-300' : 'border-white/10 text-slate-500 hover:text-white'}`}>
                              <Bookmark size={11} />
                            </button>
                            <button onClick={(e) => shareQuestion(e, q)} className="p-1.5 rounded-lg border border-white/10 text-slate-500 hover:text-white hover:border-cyan-500/40">
                              <Share2 size={11} />
                            </button>
                            {(q.user_id === user?.uid || profile?.is_admin) && (
                              <button onClick={(e) => deleteQuestion(e, q)} className="p-1.5 rounded-lg border border-red-500/20 text-red-500/60 hover:text-red-400 hover:bg-red-500/5">
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                        
                        {/* Interactive upvote trigger */}
                        <div className="absolute -right-3 top-1/2 -translate-y-1/2 flex flex-col gap-1">
                          <button 
                            onClick={(e) => upvoteQuestion(e, q)}
                            className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all shadow-xl ${
                              questionVotes.has(q.id) ? 'bg-violet-500 border-violet-400 text-white scale-110' : 'bg-[#0f0f1a] border-white/10 text-slate-500 hover:border-violet-500/40 hover:text-violet-400'
                            }`}
                          >
                            <Zap size={12} fill={questionVotes.has(q.id) ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {visibleQuestions.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center opacity-40">
                  <Activity size={48} className="text-slate-700 mb-4 animate-pulse" />
                  <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">No Nodes found in this Sector</p>
                </div>
              )}
            </div>
          </div>

          {/* ─── VOID INSIGHTS PANEL (RIGHT) ─── */}
          <aside className="hidden lg:block">
            <div className="sticky top-28 space-y-6">
              
              <div className="qna-side-panel border-white/5 bg-white/[0.02]">
                <div className="flex items-center gap-2 mb-4 border-b border-white/5 pb-3">
                  <Activity size={15} className="text-violet-400" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Void Insights</span>
                </div>

                <div className="space-y-4">
                  {/* Active Topics */}
                  <div>
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-3">Resonating Topics</p>
                    <div className="space-y-3">
                      {tagActivity.map(([t, count]) => (
                        <div key={t} className="space-y-1.5">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-300 font-bold capitalize">#{t}</span>
                            <span className="text-slate-500">{count} nodes</span>
                          </div>
                          <div className="insight-progress-bar">
                            <div 
                              className="insight-progress-fill" 
                              style={{ width: `${(count / (questions.length || 1)) * 100}%` }} 
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Trending Pulses */}
                  <div>
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-3 mt-6">Knowledge Pulses</p>
                    <div className="space-y-2">
                      {trendingQuestions.map((q) => (
                        <div key={q.id} onClick={() => openQuestion(q)} className="flex items-center gap-3 p-2 rounded-xl border border-white/5 bg-white/2 hover:bg-white/5 cursor-pointer transition-all">
                          <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                            <Flame size={14} className="text-orange-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold text-slate-200 truncate">{q.title}</p>
                            <p className="text-[8px] text-slate-500 uppercase">{timeAgo(q.created_at)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Activity Feed */}
              <div className="qna-side-panel border-white/5 bg-white/[0.02] overflow-hidden">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp size={14} className="text-cyan-400" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">Live Stream</span>
                </div>
                <div className="space-y-3 max-h-64 overflow-y-auto pr-1 scrollbar-none">
                  {recentActivity.map((activity, i) => (
                    <div key={`${activity.id}-${i}`} className="activity-item group flex gap-3 pb-3 border-b border-white/[0.03] last:border-0 cursor-pointer" onClick={() => setActiveQuestionId(activity.type === 'question' ? activity.id : (answers.find(a => a.id === activity.id)?.question_id || null))}>
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${activity.type === 'question' ? 'bg-violet-500' : 'bg-cyan-500'}`} />
                      <div className="min-w-0">
                        <p className="text-[10px] text-slate-300 leading-snug">
                          {activity.type === 'question' ? 'A new Node was echoed.' : 'A response was linked.'}
                        </p>
                        <p className="text-[8px] text-slate-600 uppercase mt-0.5">{timeAgo(activity.time)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* ─── FAB: ASK INTO VOID ─── */}
      <button 
        onClick={() => setAskModalOpen(true)}
        className="fab-ask group"
      >
        <Plus size={24} className="shrink-0 transition-transform group-hover:rotate-90" />
        <span className="fab-text">Ask into Void</span>
      </button>

      {/* ─── ASK MODAL ─── */}
      <AnimatePresence>
        {askModalOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#05050b]/90 backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="relative w-full max-w-2xl bg-[#0f0f1d] border border-white/10 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden"
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
            >
              <div className="absolute top-0 inset-x-0 h-40 bg-gradient-to-b from-violet-600/10 to-transparent pointer-events-none" />
              <button 
                onClick={() => setAskModalOpen(false)}
                className="absolute top-6 right-6 p-2 rounded-full bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all"
              >
                <X size={20} />
              </button>

              <div className="relative">
                <div className="mb-8">
                  <p className="text-[11px] font-black uppercase tracking-[0.4em] text-violet-400 mb-2">Echoing a Question</p>
                  <h2 className="text-3xl font-bold text-white">Ask anything <span className="text-gradient">Anonymously.</span></h2>
                </div>

                <div className="space-y-6">
                  <div>
                    <input
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white placeholder-slate-600 outline-none focus:border-violet-500/50 transition-all text-lg font-medium"
                      placeholder="Node Subject..."
                      maxLength={120}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      autoFocus
                    />
                    <div className="flex justify-end mt-2">
                       <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${title.trim().length >= 5 ? 'border-violet-500/30 text-violet-400' : 'border-white/5 text-slate-700'}`}>
                        {title.length}/120
                       </span>
                    </div>
                  </div>

                  <div>
                    <textarea
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white placeholder-slate-600 outline-none focus:border-violet-500/50 transition-all text-sm min-h-[160px] resize-none"
                      placeholder="Expand on your thought... identities remain hidden."
                      maxLength={1000}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                    />
                     <div className="flex justify-end mt-2">
                       <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${content.trim().length >= 10 ? 'border-cyan-500/30 text-cyan-400' : 'border-white/5 text-slate-700'}`}>
                        {content.length}/1000
                       </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-8 items-end">
                    <div className="flex-1 min-w-[200px]">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Target Sector</p>
                      <div className="flex flex-wrap gap-2">
                        {TAGS.map((t) => (
                          <button
                            key={t}
                            onClick={() => setTag(t)}
                            className={`px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all border ${
                              tag === t ? 'bg-violet-500/20 border-violet-500/50 text-violet-300' : 'bg-white/3 border-white/5 text-slate-600 hover:text-slate-400'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 items-center">
                      <div className="flex gap-2">
                        {MOODS.map(m => (
                          <button key={m} onClick={() => setSelectedMood(m)} className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all text-lg ${selectedMood === m ? 'bg-white/10 border-white/30 scale-110 shadow-lg' : 'bg-white/3 border-white/5 opacity-40 hover:opacity-100'}`}>
                            {m}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={submitQuestion}
                        disabled={title.trim().length < 5 || content.trim().length < 10 || questionSubmitting || safeMode || isQnADisabled}
                        className="btn-primary !w-auto flex items-center gap-3 px-8 py-4 rounded-3xl"
                      >
                        {questionSubmitting ? 'Echoing...' : <><Send size={18} /> Echo Node</>}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── ANSWER MODAL (Existing logic, redesigned nodes) ─── */}
      <AnimatePresence>
        {activeQuestion && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#05050b]/90 backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
             <div className="absolute inset-0" onClick={() => setActiveQuestionId(null)} />
             <motion.div
              className="relative w-full max-w-3xl bg-[#0f0f1d] border border-white/10 rounded-[2.5rem] max-h-[90vh] flex flex-col overflow-hidden"
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
            >
              <div className="p-8 border-b border-white/5 relative">
                <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-cyan-600/10 to-transparent pointer-events-none" />
                <div className="flex justify-between items-start mb-6">
                  <span className={`neon-tag ${TAG_COLORS[activeQuestion.tag] ?? 'neon-tag-purple'}`}>#{activeQuestion.tag}</span>
                  <button onClick={() => setActiveQuestionId(null)} className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-500 hover:text-white"><X size={18} /></button>
                </div>
                <h2 className="text-2xl font-bold text-white mb-4">{activeQuestion.title}</h2>
                <div className="flex items-center gap-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                  <span className="flex items-center gap-1.5"><Users size={12} /> {getAnonymousAlias(activeQuestion.user_id, activeQuestion.user_id === user?.uid)}</span>
                  <span>·</span>
                  <span>{timeAgo(activeQuestion.created_at)}</span>
                  {activeQuestion.is_resolved && <span className="text-emerald-400">Resolved Sector</span>}
                </div>
                <p className="mt-6 text-slate-300 leading-relaxed bg-white/3 rounded-2xl p-6 border border-white/5 italic">"{activeQuestion.content}"</p>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6">
                {activeQuestionAnswers.length === 0 ? (
                  <div className="flex flex-col items-center py-10 opacity-30">
                    <MessageSquarePlus size={32} className="mb-3" />
                    <p className="text-xs font-black uppercase tracking-[0.2em]">Node awaiting Resonance</p>
                  </div>
                ) : (
                  activeQuestionAnswers.map((answer) => {
                    const mine = answer.user_id === user?.uid;
                    return (
                      <div key={answer.id} className={`p-6 rounded-3xl border ${answer.is_accepted ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-white/3 border-white/5'}`}>
                         <div className="flex justify-between items-start mb-4">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{getAnonymousAlias(answer.user_id, mine)} · {timeAgo(answer.created_at)}</span>
                            {activeQuestion.user_id === user?.uid && (
                              <button onClick={() => acceptAnswer(answer)} className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${answer.is_accepted ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'border-white/10 text-slate-500 hover:text-slate-300'}`}>
                                {answer.is_accepted ? 'Unlink Resonance' : 'Link as Core Answer'}
                              </button>
                            )}
                         </div>
                         <p className="text-sm text-slate-200 leading-relaxed mb-6">{answer.content}</p>
                         <div className="flex items-center justify-between">
                            <button onClick={() => upvoteAnswer(answer)} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all text-xs font-bold ${answerVotes.has(answer.id) ? 'bg-violet-500/20 border-violet-500/50 text-violet-300' : 'border-white/10 text-slate-500 hover:text-slate-300'}`}>
                               <Zap size={12} /> {answer.upvotes}
                            </button>
                            {(mine || profile?.is_admin) && (
                              <button onClick={() => deleteAnswer(answer)} className="p-2 rounded-lg bg-red-500/5 text-red-500/50 hover:text-red-400 transition-all"><X size={14} /></button>
                            )}
                         </div>
                      </div>
                    );
                  })
                )
                }
              </div>

              <div className="p-6 bg-black/40 border-t border-white/5">
                <div className="flex gap-3">
                  <input
                    className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-sm text-white focus:border-violet-500/40 outline-none transition-all"
                    placeholder="Contribute to this Node resonance..."
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                  />
                  <button onClick={submitAnswer} disabled={!answerText.trim() || answerSubmitting} className="w-12 h-12 rounded-2xl bg-violet-600 flex items-center justify-center text-white hover:bg-violet-500 transition-all disabled:opacity-50">
                    <Send size={18} />
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ReportModal
        isOpen={!!reportingContent}
        onClose={() => setReportingContent(null)}
        targetType={reportingContent?.type || 'question'}
        targetId={reportingContent?.id || ''}
      />
    </div>
  );
}
