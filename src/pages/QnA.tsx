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
import { AlertTriangle, ShieldAlert, ArrowLeft, Bookmark, BookmarkCheck, Share2, Zap, MessageSquarePlus, Eye, ChevronRight, Flame, TrendingUp, Users, Hash, Plus, Send, X, Activity, CheckCircle2, MessageCircle, Sparkles, ShieldCheck, Flag } from 'lucide-react';
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
const SORT_OPTIONS = ['all', 'unanswered', 'answered', 'solved', 'trending'] as const;

const TAG_COLORS: Record<string, string> = {
  general: 'neon-tag-purple',
  career: 'neon-tag-cyan',
  relationships: 'neon-tag-pink',
  study: 'neon-tag-amber',
  tech: 'neon-tag-cyan',
  random: 'neon-tag-purple',
};

const MOODS = ['🔥', '😌', '💭', '🤯', '💡'] as const;

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

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<typeof SORT_OPTIONS[number]>('all');

  const [questionVotes, setQuestionVotes] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('voidchat-qna-voted-q') ?? '[]')); }
    catch { return new Set(); }
  });
  const [answerVotes, setAnswerVotes] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('voidchat-qna-voted-a') ?? '[]')); }
    catch { return new Set(); }
  });
  
  const [viewedQuestionIds, setViewedQuestionIds] = useState<Set<string>>(new Set());
  const [reportingContent, setReportingContent] = useState<{ id: string; type: 'question' | 'answer' } | null>(null);

  // UI-only states
  const [askModalOpen, setAskModalOpen] = useState(false);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate('/join');
  }, [loading, navigate, user]);

  useEffect(() => {
    if (!user) return;

    const qQuery = query(collection(db, 'qna_questions'), orderBy('created_at', 'desc'));
    const unsubscribeQuestions = onSnapshot(qQuery, (snapshot) => {
      const items: QnaQuestion[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as QnaQuestion);
      });
      setQuestions(items);
    });

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
      const answerCount = (answersByQuestion.get(question.id) ?? []).length;
      const isSolved = question.is_resolved;
      
      let matchFilter = true;
      if (filter === 'unanswered') matchFilter = answerCount === 0 && !isSolved;
      else if (filter === 'answered') matchFilter = answerCount > 0 && !isSolved;
      else if (filter === 'solved') matchFilter = isSolved;

      if (!matchFilter) return false;
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

      if (filter === 'trending') {
        const scoreA = a.upvotes * 3 + (answersByQuestion.get(a.id)?.length ?? 0) * 2 + a.views;
        const scoreB = b.upvotes * 3 + (answersByQuestion.get(b.id)?.length ?? 0) * 2 + b.views;
        return scoreB - scoreA;
      }
      return bTime - aTime;
    });
  }, [answersByQuestion, questions, search, filter]);

  const resolvedCount = questions.filter((question) => question.is_resolved).length;
  const resolutionRate = questions.length > 0 ? Math.round((resolvedCount / questions.length) * 100) : 0;

  const trendingQuestions = useMemo(() => {
    return [...questions]
      .sort((a, b) => {
        const sA = a.upvotes * 3 + (answersByQuestion.get(a.id)?.length ?? 0) * 2 + a.views;
        const sB = b.upvotes * 3 + (answersByQuestion.get(b.id)?.length ?? 0) * 2 + b.views;
        return sB - sA;
      })
      .slice(0, 5);
  }, [questions, answersByQuestion]);

  const recentAnswers = useMemo(() => {
    return answers
      .filter(a => a.created_at)
      .sort((a, b) => {
        const aT = a.created_at.toDate ? a.created_at.toDate().getTime() : new Date(a.created_at).getTime();
        const bT = b.created_at.toDate ? b.created_at.toDate().getTime() : new Date(b.created_at).getTime();
        return bT - aT;
      })
      .slice(0, 5);
  }, [answers]);

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
      toast.success('Question posted successfully.');
    } catch (err: any) {
      console.error('Question submit error:', err);
      setQuestionError(err.message.includes('check constraint') 
        ? 'Title (5+) and Content (10+) must be longer.' 
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
      toast.success('Your answer has been posted.');
    } catch (err: any) {
      console.error('Answer submit error:', err);
      toast.error('Failed to post answer.');
    } finally {
      setAnswerSubmitting(false);
    }
  };

  const upvoteQuestion = async (e: React.MouseEvent, question: QnaQuestion) => {
    e.stopPropagation();
    if (safeMode) return;
    
    const hasVoted = questionVotes.has(question.id);
    const updatedVotes = new Set(questionVotes);
    
    if (hasVoted) updatedVotes.delete(question.id);
    else updatedVotes.add(question.id);
    
    setQuestionVotes(updatedVotes);
    localStorage.setItem('voidchat-qna-voted-q', JSON.stringify(Array.from(updatedVotes)));

    try {
      await updateDoc(doc(db, 'qna_questions', question.id), {
        upvotes: increment(hasVoted ? -1 : 1)
      });
      if (!hasVoted) toast.success('Sparked!');
    } catch (err) {
      console.error('Upvote question error:', err);
    }
  };

  const upvoteAnswer = async (answer: QnaAnswer) => {
    if (safeMode) return;

    const hasVoted = answerVotes.has(answer.id);
    const updatedVotes = new Set(answerVotes);
    
    if (hasVoted) updatedVotes.delete(answer.id);
    else updatedVotes.add(answer.id);
    
    setAnswerVotes(updatedVotes);
    localStorage.setItem('voidchat-qna-voted-a', JSON.stringify(Array.from(updatedVotes)));

    try {
      await updateDoc(doc(db, 'qna_answers', answer.id), {
        upvotes: increment(hasVoted ? -1 : 1)
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
      if (shouldAccept) toast.success('Question marked as solved!');
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
      toast.success('Question deleted.');
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

  const shareQuestion = (e: React.MouseEvent, question: QnaQuestion) => {
    e.stopPropagation();
    const url = `${window.location.origin}/qna#${question.id}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Link copied!'));
  };

  const getQuestionStatus = (question: QnaQuestion) => {
    const answerCount = (answersByQuestion.get(question.id) ?? []).length;
    if (question.is_resolved) return 'solved';
    if (answerCount > 0) return 'answered';
    return 'unanswered';
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

      {/* ─── HEADER (RESTRUCTURED FOR MOBILE HIERARCHY) ─── */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#070710]/80 backdrop-blur-2xl px-4 py-3 sm:py-4 sm:px-6">
        <div className="mx-auto max-w-[1200px] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Row 1: Title & Actions */}
          <div className="flex items-center justify-between w-full lg:w-auto">
            <div className="flex items-center gap-3 min-w-0">
              <Link to="/dashboard" className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl sm:rounded-2xl border border-white/10 bg-white/5 text-slate-400 hover:text-white transition-all">
                <ArrowLeft size={18} />
              </Link>
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <h1 className="text-sm sm:text-xl font-semibold text-white truncate leading-none">Question <span className="text-gradient">Flow</span></h1>
                  {profile?.is_admin && (
                    <span className="px-1.5 py-1 rounded-md bg-red-500/10 border border-red-500/20 text-red-500 text-[8px] font-black uppercase tracking-widest flex items-center gap-1 shrink-0">
                        <ShieldCheck size={10} /> Admin
                    </span>
                  )}
                </div>
                <p className="hidden sm:block mt-1 text-[9px] sm:text-[10px] uppercase tracking-[0.3em] text-violet-400/70 font-bold truncate tracking-widest">Void Q&A Arena</p>
              </div>
            </div>

            {/* Mobile Stats Toggle or Resolution Rate */}
            <div className="lg:hidden flex items-center gap-2 px-2.5 py-1.5 border border-white/5 bg-white/3 rounded-xl scale-90">
              <CheckCircle2 size={12} className="text-emerald-400" />
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">
                {resolutionRate}%
              </span>
            </div>
          </div>

          {/* Row 2: Navigation & Search (Stacked on Mobile) */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 lg:gap-4 w-full lg:w-auto">
            
            {/* Desktop Filters (Hidden on Mobile row 2, handled below) */}
            <div className="hidden lg:flex items-center gap-4">
               <div className="flex bg-white/5 border border-white/10 rounded-2xl p-0.5">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setFilter(opt)}
                    className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${
                      filter === opt ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 border border-white/5 bg-white/3 rounded-xl">
                <CheckCircle2 size={12} className="text-emerald-400" />
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">
                  {resolutionRate}% Solved
                </span>
              </div>
            </div>

            {/* Mobile/Tablet Filters & Search */}
            <div className="flex lg:hidden items-center gap-2 w-full overflow-hidden">
               <div className="flex-1 overflow-x-auto no-scrollbar py-1">
                 <div className="flex bg-white/5 border border-white/10 rounded-xl p-0.5 shrink-0">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setFilter(opt)}
                      className={`px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all shrink-0 ${
                        filter === opt ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
               </div>
               
               <div className="relative w-32 shrink-0">
                 <input
                    className="input-field !py-2 !pr-8 !text-[10px] border-white/10 bg-white/5 !rounded-xl"
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Hash size={10} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
               </div>
            </div>

            {/* Desktop Search only */}
            <div className="hidden lg:block relative w-48 lg:w-64">
               <input
                  className="input-field py-2 pr-8 text-xs border-white/10 bg-white/5"
                  placeholder="Search flow..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Hash size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
            </div>
          </div>

        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1000px] px-4 py-6 sm:px-6">
        
        {/* ─── TOP INSIGHTS BAR (MOBILE SCROLL) ─── */}
        <div className="qna-top-bar no-scrollbar mb-8">
           {trendingQuestions.length > 0 && (
             <div className="qna-top-card">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} className="text-violet-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-violet-300">Trending Questions</span>
              </div>
              <div className="space-y-2">
                 {trendingQuestions.slice(0, 2).map(q => (
                   <div key={q.id} onClick={() => openQuestion(q)} className="flex items-center justify-between group cursor-pointer hover:bg-white/5 p-1 rounded-lg transition-all">
                      <p className="text-[10px] text-slate-200 truncate pr-4 group-hover:text-violet-300 transition-colors font-medium">{q.title}</p>
                      <span className="shrink-0 text-[8px] text-slate-500 font-bold uppercase flex items-center gap-1">#{q.tag} <ChevronRight size={8} /></span>
                   </div>
                 ))}
              </div>
           </div>
           )}

           <div className="qna-top-card">
              <div className="flex items-center gap-2 mb-3">
                <Activity size={14} className="text-cyan-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Answer Activity</span>
              </div>
              <div className="space-y-2">
                 {recentAnswers.slice(0, 2).map(a => (
                   <div key={a.id} className="flex flex-col gap-0.5 cursor-pointer hover:opacity-70 transition-opacity" onClick={() => setActiveQuestionId(a.question_id)}>
                      <p className="text-[9px] text-slate-300 truncate">New Answer posted</p>
                      <span className="text-[8px] text-slate-500 uppercase">{timeAgo(a.created_at)}</span>
                   </div>
                 ))}
                 {recentAnswers.length === 0 && <p className="text-[9px] text-slate-600 uppercase">No recent activity</p>}
              </div>
           </div>

           <div className="qna-top-card">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={14} className="text-amber-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-300">Resilience</span>
              </div>
              <div className="flex items-end gap-3">
                 <div className="flex-1">
                    <p className="text-[10px] font-bold text-slate-400 mb-1">{resolutionRate}% Resolved</p>
                    <div className="insight-progress-mini"><div className="insight-fill-mini" style={{ width: `${resolutionRate}%` }} /></div>
                 </div>
                 <div className="text-right">
                    <p className="text-[14px] font-bold text-white mb-0">{questions.length}</p>
                    <p className="text-[8px] text-slate-500 uppercase">Total</p>
                 </div>
              </div>
           </div>
        </div>

        {/* ─── ASK TRIGGER (TOP OF FEED) ─── */}
        <div 
          onClick={() => setAskModalOpen(true)}
          className="qna-ask-trigger group shadow-lg"
        >
          <div className="flex items-center gap-4">
             <div className="w-10 h-10 rounded-2xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400 group-hover:bg-violet-600/20 group-hover:scale-110 transition-all">
                <MessageSquarePlus size={20} />
             </div>
             <span className="text-slate-400 italic">Seeking an answer? Echo your question here...</span>
          </div>
          <button className="px-5 py-2 rounded-xl bg-violet-600/20 border border-violet-500/30 text-violet-300 text-[11px] font-bold uppercase tracking-widest shadow-xl group-hover:bg-violet-600 group-hover:text-white transition-all">
             Ask Question
          </button>
        </div>

        {/* ─── MAIN FEED (WIDE BAR FLOW) ─── */}
        <div className="thread-flow-container">
          <div className="relative z-10 space-y-4 min-h-[60vh]">
             <AnimatePresence>
                {visibleQuestions.map((q, idx) => {
                  const status = getQuestionStatus(q);
                  const answerCount = (answersByQuestion.get(q.id) ?? []).length;
                  const hasVoted = questionVotes.has(q.id);

                  return (
                    <motion.div
                      key={q.id}
                      className="thread-node-wrapper"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.4, delay: idx * 0.05 }}
                    >
                      <div 
                        className={`thread-node group ${
                          status === 'solved' ? 'qna-glow-solved qna-card-solved' : 
                          status === 'answered' ? 'qna-glow-answered' : 
                          'qna-glow-unanswered qna-drift-container'
                        }`}
                        onClick={() => openQuestion(q)}
                      >
                         <div className="flex items-center justify-between mb-4">
                           <div className="flex items-center gap-3">
                              <span className={`neon-tag text-[10px] ${TAG_COLORS[q.tag] ?? 'neon-tag-purple'}`}>#{q.tag}</span>
                              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{timeAgo(q.created_at)}</span>
                              
                              <div className="flex items-center gap-1.5 ml-2">
                                <button
                                  onClick={(e) => upvoteQuestion(e, q)}
                                  className={`p-1.5 rounded-lg border transition-all ${
                                    hasVoted ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-white/5 border-white/10 text-slate-500 hover:text-white'
                                  }`}
                                  title={hasVoted ? 'Undo Spark' : 'Spark this question'}
                                >
                                  <Zap size={14} fill={hasVoted ? 'currentColor' : 'none'} />
                                </button>
                                
                                <button
                                  onClick={(e) => { e.stopPropagation(); setReportingContent({ id: q.id, type: 'question' }); }}
                                  className="p-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-500 hover:text-red-400 hover:border-red-500/30 transition-all"
                                  title="Report Question"
                                >
                                  <ShieldAlert size={14} />
                                </button>

                                {(q.user_id === user?.uid || profile?.is_admin) && (
                                  <button
                                    onClick={(e) => deleteQuestion(e, q)}
                                    className="p-1.5 rounded-lg border border-red-500/20 bg-red-500/5 text-red-500/40 hover:text-red-400 hover:border-red-500/50 transition-all"
                                    title="Delete Question"
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                           </div>
                           <span className={`status-badge text-[9px] ${status === 'solved' ? 'status-solved' : status === 'answered' ? 'status-answered' : 'status-unanswered'}`}>
                            {status === 'solved' ? 'Solved ✓' : status === 'answered' ? 'Answered' : 'Unanswered'}
                           </span>
                         </div>

                         <h3 className="text-base font-bold text-white mb-3 leading-tight group-hover:text-violet-300 transition-colors">
                           {q.title}
                         </h3>
                         <p className="text-xs text-slate-400 line-clamp-2 italic mb-6">"{q.content}"</p>

                         <div className="flex items-center justify-between border-t border-white/5 pt-4">
                            <div className="flex items-center gap-6 text-[10px] sm:text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                               <span className="flex items-center gap-2">
                                  <MessageCircle size={14} className="text-violet-400" /> 
                                  {answerCount} <span className="hidden sm:inline-block">Answers</span>
                               </span>
                               <span className={`flex items-center gap-2 transition-colors ${hasVoted ? 'text-amber-400' : ''}`}>
                                  <Zap size={14} fill={hasVoted ? 'currentColor' : 'none'} className={hasVoted ? 'text-amber-400' : 'text-slate-500'} /> 
                                  {q.upvotes} <span className="hidden sm:inline-block">Sparks</span>
                               </span>
                            </div>
                            <button className={`qna-cta-btn !py-2 !px-6 text-[11px] font-black uppercase tracking-widest ${status === 'unanswered' ? 'qna-cta-primary' : ''}`}>
                               {status === 'unanswered' ? (
                                 <><span className="hidden sm:inline">Answer Question</span><span className="sm:hidden">Answer</span></>
                               ) : (
                                 <><span className="hidden sm:inline">View Thread</span><span className="sm:hidden">View</span></>
                               )}
                            </button>
                         </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {visibleQuestions.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 opacity-40">
                  <Activity size={32} className="text-slate-700 mb-3 animate-pulse" />
                  <p className="text-slate-500 font-bold uppercase tracking-widest text-[9px]">The flow is silent...</p>
                </div>
              )}
          </div>
        </div>
      </main>

      {/* ASK MODAL */}
      <AnimatePresence>
        {askModalOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#05050b]/90 backdrop-blur-xl"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="relative w-full max-w-2xl bg-[#0f0f1d] border border-white/10 rounded-3xl sm:rounded-[2.5rem] p-6 sm:p-8 shadow-2xl overflow-y-auto max-h-[90vh]"
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
            >
              <button onClick={() => setAskModalOpen(false)} className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 rounded-full bg-white/5 text-slate-400 hover:text-white border border-white/10"><X size={18} /></button>
              <div className="mb-6 sm:mb-8 pt-2 sm:pt-4">
                <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.4em] text-violet-400 mb-2">New Question</p>
                <h2 className="text-2xl sm:text-3xl font-bold text-white">Ask anything <span className="text-gradient">Anonymously.</span></h2>
              </div>
              <div className="space-y-4 sm:space-y-6">
                <input className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-6 py-3 sm:py-4 text-white placeholder-slate-600 focus:border-violet-500/40 outline-none text-base sm:text-lg font-medium" placeholder="Briefly state your question..." maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                <textarea className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-6 py-3 sm:py-4 text-white placeholder-slate-600 focus:border-violet-500/40 outline-none text-xs sm:text-sm min-h-[120px] sm:min-h-[160px] resize-none" placeholder="Add details for a better answer..." maxLength={1000} value={content} onChange={(e) => setContent(e.target.value)} />
                <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 items-stretch sm:items-end">
                  <div className="flex-1">
                    <p className="text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Category</p>
                    <div className="flex flex-wrap gap-2">
                       {TAGS.map((t) => (
                        <button key={t} onClick={() => setTag(t)} className={`px-2.5 py-1 rounded-lg sm:rounded-xl text-[9px] sm:text-[10px] font-bold uppercase transition-all border ${tag === t ? 'bg-violet-500/20 border-violet-500/50 text-violet-300' : 'bg-white/3 border-white/10 text-slate-600 hover:text-slate-400'}`}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <button onClick={submitQuestion} disabled={title.trim().length < 5 || content.trim().length < 10 || questionSubmitting} className="btn-primary !w-full sm:!w-auto flex items-center justify-center gap-3 px-8 py-3 sm:py-4 rounded-2xl sm:rounded-3xl">
                    {questionSubmitting ? 'Posting...' : <><Send size={18} /> Post Question</>}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ANSWER MODAL */}
      <AnimatePresence>
        {activeQuestion && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#05050b]/90 backdrop-blur-xl"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
             <div className="absolute inset-0" onClick={() => setActiveQuestionId(null)} />
             <motion.div
              className="relative w-full max-w-3xl bg-[#0f0f1d] border border-white/10 rounded-3xl sm:rounded-[2.5rem] max-h-[90vh] flex flex-col overflow-hidden"
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
            >
               <div className="p-6 sm:p-8 border-b border-white/5 relative bg-gradient-to-b from-violet-600/5 to-transparent">
                  <div className="flex justify-between items-start mb-4 sm:mb-6">
                    <div className="flex gap-2">
                       <span className={`neon-tag !text-[8px] sm:!text-[10px] ${TAG_COLORS[activeQuestion.tag]}`}>#{activeQuestion.tag}</span>
                       <span className={`status-badge !text-[8px] sm:!text-[10px] ${getQuestionStatus(activeQuestion) === 'solved' ? 'status-solved' : getQuestionStatus(activeQuestion) === 'answered' ? 'status-answered' : 'status-unanswered'}`}>
                        {getQuestionStatus(activeQuestion) === 'solved' ? 'Solved ✓' : getQuestionStatus(activeQuestion) === 'answered' ? 'Answered' : 'Unanswered'}
                       </span>
                    </div>
                    <button onClick={() => setActiveQuestionId(null)} className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-500 hover:text-white"><X size={16} /></button>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white mb-3 sm:mb-4 leading-tight">{activeQuestion.title}</h2>
                  <div className="flex items-center gap-4 text-[10px] sm:text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                     <span className="truncate max-w-[120px]">{getAnonymousAlias(activeQuestion.user_id, activeQuestion.user_id === user?.uid)}</span>
                     <span>·</span>
                     <span>{timeAgo(activeQuestion.created_at)}</span>
                  </div>
                  <p className="mt-4 sm:mt-6 text-xs sm:text-sm text-slate-300 leading-relaxed italic border-l-2 border-violet-500/30 pl-4 sm:pl-6">"{activeQuestion.content}"</p>
               </div>

               <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-4 sm:space-y-6 scrollbar-none">
                 {activeQuestionAnswers.length === 0 ? (
                    <div className="flex flex-col items-center py-10 opacity-30 text-center text-slate-500 uppercase font-black tracking-widest text-[9px]">
                      <MessageSquarePlus size={28} className="mb-3" />
                      Seeking resonance...
                    </div>
                  ) : (
                    activeQuestionAnswers.map((answer) => {
                      const hasVotedA = answerVotes.has(answer.id);
                      return (
                      <div key={answer.id} className={`p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all ${answer.is_accepted ? 'bg-emerald-500/5 border-emerald-500/20 shadow-lg shadow-emerald-500/5' : 'bg-white/3 border-white/5'}`}>
                         <div className="flex justify-between items-center mb-3 sm:mb-4">
                            <span className="text-[9px] sm:text-[10px] font-black text-slate-500 uppercase tracking-widest truncate max-w-[150px]">{getAnonymousAlias(answer.user_id, answer.user_id === user?.uid)} · {timeAgo(answer.created_at)}</span>
                            <div className="flex gap-2">
                               {activeQuestion.user_id === user?.uid && (
                                <button onClick={() => acceptAnswer(answer)} className={`px-2 py-1 rounded-lg text-[8px] sm:text-[9px] font-black uppercase tracking-widest border transition-all ${answer.is_accepted ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'border-white/10 text-slate-500 hover:text-emerald-400'}`}>
                                  {answer.is_accepted ? 'Undo' : 'Solve'}
                                </button>
                               )}
                               <button onClick={() => setReportingContent({ id: answer.id, type: 'answer' })} className="p-1 px-1.5 rounded-lg bg-orange-500/5 text-orange-500/40 hover:text-orange-400 text-[8px] font-bold uppercase tracking-tighter shrink-0">Report</button>
                            </div>
                         </div>
                         <p className="text-xs sm:text-sm text-slate-200 leading-relaxed mb-4 sm:mb-6">{answer.content}</p>
                         <div className="flex items-center justify-between">
                            <button onClick={() => upvoteAnswer(answer)} className={`flex items-center gap-2 px-2.5 py-1 rounded-lg sm:rounded-xl border transition-all text-[10px] sm:text-xs font-bold ${hasVotedA ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'border-white/10 text-slate-500 hover:text-white'}`}>
                               <Zap size={12} fill={hasVotedA ? 'currentColor' : 'none'} /> {answer.upvotes}
                            </button>
                            {(answer.user_id === user?.uid || profile?.is_admin) && (
                              <button onClick={() => deleteAnswer(answer)} className="p-1.5 rounded-lg bg-red-500/5 text-red-500/50 hover:text-red-400 transition-all shrink-0"><X size={12} /></button>
                            )}
                         </div>
                      </div>
                      )
                    })
                  )}
               </div>

               <div className="p-4 sm:p-6 bg-black/40 border-t border-white/5">
                  <div className="flex gap-2 sm:gap-3">
                    <input className="flex-1 bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-xs sm:text-sm text-white focus:border-violet-500/40 outline-none transition-all" placeholder="Write answer..." value={answerText} onChange={(e) => setAnswerText(e.target.value)} />
                    <button onClick={submitAnswer} disabled={!answerText.trim() || answerSubmitting} className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-xl sm:rounded-2xl bg-violet-600 flex items-center justify-center text-white hover:bg-violet-500 transition-all disabled:opacity-50 shadow-xl"><Send size={16} /></button>
                  </div>
               </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ReportModal isOpen={!!reportingContent} onClose={() => setReportingContent(null)} targetType={reportingContent?.type || 'question'} targetId={reportingContent?.id || ''} />
    </div>
  );
}
