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
import { AlertTriangle, ShieldAlert, ArrowLeft, Bookmark, BookmarkCheck, Share2, Zap, MessageSquarePlus, Eye, ChevronDown, Flame, TrendingUp, Users, Hash } from 'lucide-react';

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
  const [askExpanded, setAskExpanded] = useState(false);
  const [askFocused, setAskFocused] = useState(false);
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
      setAskExpanded(false);
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
    } catch (err: any) {
      console.error('Answer submit error:', err);
      setAnswerError(err.message.includes('check constraint') 
        ? 'Answer is too short (min 2 chars).' 
        : 'Failed to post answer.');
    } finally {
      setAnswerSubmitting(false);
    }
  };

  const upvoteQuestion = async (question: QnaQuestion) => {
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

  const deleteQuestion = async (question: QnaQuestion) => {
    if (!user || (question.user_id !== user.uid && !profile?.is_admin)) return;
    
    if (activeQuestionId === question.id) setActiveQuestionId(null);

    try {
      await deleteDoc(doc(db, 'qna_questions', question.id));
      // Delete associated answers
      const answersSnap = await getDocs(query(collection(db, 'qna_answers'), where('question_id', '==', question.id)));
      const deletePromises = answersSnap.docs.map(a => deleteDoc(a.ref));
      await Promise.all(deletePromises);
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

  const toggleBookmark = (id: string) => {
    setBookmarkedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('voidchat-qna-bookmarks', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const shareQuestion = (question: QnaQuestion) => {
    const url = `${window.location.origin}/qna#${question.id}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Link copied to clipboard!'));
  };

  const isHot = (question: QnaQuestion) => {
    const answerCount = answersByQuestion.get(question.id)?.length ?? 0;
    return question.upvotes >= 3 || answerCount >= 3;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center qna-space">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="qna-space min-h-screen">
      <div className="qna-noise" />
      <div className="ambient-blob w-[600px] h-[600px] bg-violet-600/12 top-[-120px] left-[-80px]" />
      <div className="ambient-blob w-[500px] h-[500px] bg-cyan-500/8 bottom-[-100px] right-[-60px]" />
      <div className="ambient-blob w-[300px] h-[300px] bg-violet-400/6 top-[40%] right-[20%]" />

      {/* ─── HEADER ─── */}
      <header className="sticky top-0 z-20 border-b border-white/8 bg-[#070710]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
              aria-label="Back to dashboard"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-violet-400/80">
                Void Knowledge Arena
                {profile?.is_admin && (
                  <span className="ml-2 text-[10px] font-black bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full border border-red-500/20">ADMIN</span>
                )}
              </p>
              <h1 className="text-xl font-semibold text-white">
                Ask. Answer.{' '}
                <span className="text-gradient">Echo in the void.</span>
              </h1>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 flex-wrap">
            <div className="confession-pill text-xs">
              <Zap size={13} className="text-violet-400" />
              <span className="text-violet-200">{questions.length} questions</span>
            </div>
            <div className="confession-pill text-xs">
              <MessageSquarePlus size={13} className="text-cyan-400" />
              <span className="text-cyan-200">{totalAnswers} answers</span>
            </div>
            <div className="confession-pill text-xs">
              <TrendingUp size={13} className="text-emerald-400" />
              <span className="text-emerald-200">{resolutionRate}% solved</span>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {config.disableQnA && <FeatureDisabledBanner featureName="Q&A" />}

        {/* ─── TWO-COLUMN LAYOUT ON LARGE SCREENS ─── */}
        <div className="flex gap-6">
          <div className="flex-1 min-w-0 space-y-5">

            {/* ─── SECTION 2: ASK BOX ─── */}
            <motion.div
              className={`qna-ask-card border overflow-hidden ${askFocused ? 'focused border-violet-500/50' : 'border-violet-500/20'}`}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {/* Collapsed trigger (mobile-first) */}
              <button
                onClick={() => setAskExpanded(!askExpanded)}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
                    <MessageSquarePlus size={16} className="text-violet-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {isQnADisabled ? 'Q&A Temporarily Disabled' : 'Ask a Question'}
                    </p>
                    <p className="text-[11px] text-slate-500">Echo anonymously into the void</p>
                  </div>
                </div>
                <motion.div animate={{ rotate: askExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown size={18} className="text-slate-400" />
                </motion.div>
              </button>

              <AnimatePresence>
                {askExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 space-y-4 border-t border-white/8">
                      {/* Title input */}
                      <div className="relative mt-4">
                        <input
                          className="input-field pr-16"
                          placeholder="Your question title…"
                          maxLength={120}
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          onFocus={() => setAskFocused(true)}
                          onBlur={() => setAskFocused(false)}
                        />
                        <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                          title.trim().length >= 5
                            ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                            : 'border-white/10 text-slate-500'
                        }`}>
                          {title.trim().length}/5 min
                        </span>
                      </div>

                      {/* Content textarea */}
                      <div className="relative">
                        <textarea
                          className="input-field resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                          placeholder={isQnADisabled ? 'Q&A is temporarily disabled by administrators.' : 'Add context so answers are useful…'}
                          rows={4}
                          maxLength={1000}
                          value={content}
                          onChange={(e) => setContent(e.target.value)}
                          onFocus={() => setAskFocused(true)}
                          onBlur={() => setAskFocused(false)}
                          disabled={isQnADisabled}
                        />
                        <span className={`absolute right-3 bottom-3 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                          content.trim().length >= 10
                            ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                            : 'border-white/10 text-slate-500'
                        }`}>
                          {content.length}/1000
                        </span>
                      </div>

                      {questionError && (
                        <p className="text-xs text-red-400 font-medium">{questionError}</p>
                      )}

                      {/* Category tags */}
                      <div>
                        <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Category</p>
                        <div className="flex gap-2 flex-wrap">
                          {TAGS.map((item) => (
                            <button
                              key={item}
                              onClick={() => setTag(item)}
                              className={`neon-tag capitalize transition-all ${
                                tag === item ? `${TAG_COLORS[item]} active` : 'neon-tag-purple opacity-40 hover:opacity-70'
                              }`}
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Mood tag (UI only) */}
                      <div>
                        <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Mood tag <span className="text-slate-600">(optional)</span></p>
                        <div className="flex gap-2">
                          {MOODS.map((mood) => (
                            <button
                              key={mood}
                              onClick={() => setSelectedMood(selectedMood === mood ? null : mood)}
                              className={`qna-mood-btn ${selectedMood === mood ? 'selected' : ''}`}
                              title={mood}
                            >
                              {mood}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Anonymous level slider (UI only) */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[11px] uppercase tracking-widest text-slate-500">Anonymous Level</p>
                          <span className="text-xs font-semibold text-violet-300">{ANON_LEVELS[anonLevel]}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={2}
                          value={anonLevel}
                          onChange={(e) => setAnonLevel(Number(e.target.value))}
                          className="qna-anon-slider"
                        />
                        <div className="flex justify-between mt-1">
                          {ANON_LEVELS.map((l) => (
                            <span key={l} className="text-[10px] text-slate-600">{l}</span>
                          ))}
                        </div>
                      </div>

                      {/* Submit row */}
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <p className="text-xs text-slate-600 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-violet-500/60 inline-block" />
                          Identity hidden by design
                        </p>
                        <button
                          onClick={() => {
                            if (isQnADisabled) { toast.error('The Q&A section has been disabled by administrators.'); return; }
                            if (safeMode) { toast.error('Questioning is restricted during Safe Mode'); return; }
                            submitQuestion();
                          }}
                          disabled={title.trim().length < 5 || content.trim().length < 10 || questionSubmitting || safeMode || isQnADisabled}
                          className="btn-primary !w-auto px-6 py-2.5 rounded-xl text-sm disabled:opacity-50 disabled:grayscale flex items-center gap-2"
                        >
                          {(safeMode || isQnADisabled) && <ShieldAlert size={15} />}
                          {isQnADisabled ? 'Restricted' : safeMode ? 'Safe Mode' : questionSubmitting ? 'Posting…' : 'Post Question'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* ─── SECTION 5: FILTER BAR (VOID CONTROL PANEL) ─── */}
            <div className="qna-control-panel p-3.5">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                {/* Search */}
                <div className="relative flex-1 min-w-0">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  <input
                    className="input-field pl-9 py-2 text-sm"
                    placeholder="Search questions…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                {/* Filters — horizontal scroll on mobile */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option}
                      onClick={() => setStatusFilter(option)}
                      className={`qna-filter-btn ${statusFilter === option ? 'active-cyan' : ''}`}
                    >
                      {option}
                    </button>
                  ))}
                  <div className="w-px h-5 bg-white/10 mx-0.5" />
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option}
                      onClick={() => setSortBy(option)}
                      className={`qna-filter-btn ${sortBy === option ? (option === 'hot' ? 'active-amber' : 'active-violet') : ''}`}
                    >
                      {option === 'hot' && <Flame size={11} />}
                      {option === 'unanswered' && <MessageSquarePlus size={11} />}
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-2.5 flex items-center gap-3 text-[11px] text-slate-600">
                <span>{questions.length} questions</span>
                <span>·</span>
                <span>{totalAnswers} answers</span>
                <span>·</span>
                <span className="flex items-center gap-1"><Users size={10} /> {uniqueContributors} contributors</span>
                <span>·</span>
                <span>identity hidden by design</span>
              </div>
            </div>

            {/* ─── SECTION 3: QUESTION FEED ─── */}
            <div className="space-y-3">
              <AnimatePresence>
                {visibleQuestions.map((question, index) => {
                  const answerCount = answersByQuestion.get(question.id)?.length ?? 0;
                  const alias = getAnonymousAlias(question.user_id, question.user_id === user?.uid);
                  const hot = isHot(question);
                  const noAnswer = answerCount === 0 && !question.is_resolved;
                  const activeThread = answerCount >= 2;

                  return (
                    <motion.div
                      key={question.id}
                      id={question.id}
                      className={`qna-card p-5 ${hot ? 'qna-card-hot' : ''}`}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8, scale: 0.98 }}
                      transition={{ delay: index < 8 ? index * 0.04 : 0 }}
                    >
                      {/* Card header row */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`neon-tag capitalize ${TAG_COLORS[question.tag] ?? 'neon-tag-purple'}`}>
                            <Hash size={9} />
                            {question.tag}
                          </span>
                          {hot && (
                            <span className="flex items-center gap-1 text-[11px] font-bold text-orange-400">
                              <Flame size={12} /> Hot
                            </span>
                          )}
                          {noAnswer && (
                            <span className="qna-badge qna-badge-no-answer">No answer yet</span>
                          )}
                          {activeThread && (
                            <span className="flex items-center gap-1.5 text-[11px] text-emerald-300 font-semibold">
                              <span className="qna-pulse" />
                              Active
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {question.is_resolved ? (
                            <span className="qna-badge qna-badge-solved">✓ Solved</span>
                          ) : (
                            <span className="qna-badge qna-badge-open">Open</span>
                          )}
                        </div>
                      </div>

                      {/* Title */}
                      <h3 className="text-base font-semibold text-white leading-snug mb-1.5 glow-text-violet">
                        {question.title}
                      </h3>

                      {/* Content preview */}
                      <p className="text-sm text-slate-400 leading-relaxed line-clamp-2 whitespace-pre-wrap mb-4">
                        {question.content}
                      </p>

                      {/* Stats & actions */}
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3 text-xs text-slate-600">
                          <span className="flex items-center gap-1">
                            <Eye size={11} /> {question.views}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageSquarePlus size={11} /> {answerCount}
                          </span>
                          <span>{timeAgo(question.created_at)}</span>
                          <span className="hidden sm:inline">by {alias}</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {/* Delete */}
                          {(question.user_id === user?.uid || profile?.is_admin) && (
                            <button
                              onClick={() => deleteQuestion(question)}
                              className="text-xs px-2.5 py-1.5 rounded-lg border border-red-500/25 text-red-400/70 hover:bg-red-500/10 hover:text-red-300 transition-all"
                            >
                              Delete
                            </button>
                          )}

                          {/* Report */}
                          <button
                            onClick={() => setReportingContent({ id: question.id, type: 'question' })}
                            className="w-8 h-8 rounded-xl border border-white/10 text-slate-500 hover:border-amber-500/30 hover:text-amber-400 transition-all flex items-center justify-center"
                            title="Report"
                          >
                            <AlertTriangle size={13} />
                          </button>

                          {/* Bookmark */}
                          <button
                            onClick={() => toggleBookmark(question.id)}
                            className={`w-8 h-8 rounded-xl border flex items-center justify-center transition-all ${
                              bookmarkedIds.has(question.id)
                                ? 'border-violet-500/50 bg-violet-500/15 text-violet-300'
                                : 'border-white/10 text-slate-500 hover:border-violet-500/30 hover:text-violet-300'
                            }`}
                            title="Bookmark"
                          >
                            {bookmarkedIds.has(question.id) ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
                          </button>

                          {/* Share */}
                          <button
                            onClick={() => shareQuestion(question)}
                            className="w-8 h-8 rounded-xl border border-white/10 text-slate-500 hover:border-cyan-500/30 hover:text-cyan-300 transition-all flex items-center justify-center"
                            title="Share"
                          >
                            <Share2 size={13} />
                          </button>

                          {/* Upvote */}
                          <button
                            onClick={() => upvoteQuestion(question)}
                            className={`reaction-btn text-xs ${questionVotes.has(question.id) ? 'reacted' : ''}`}
                          >
                            <span className="emoji">▲</span>
                            {question.upvotes}
                          </button>

                          {/* Join Discussion */}
                          <button
                            onClick={() => openQuestion(question)}
                            className="btn-primary !w-auto px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5 !shadow-none hover:!shadow-[0_0_15px_rgba(124,58,237,0.5)]"
                          >
                            <MessageSquarePlus size={13} />
                            Join Discussion
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {visibleQuestions.length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="qna-card p-14 text-center"
                >
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                    <MessageSquarePlus size={24} className="text-violet-400/60" />
                  </div>
                  <p className="text-slate-300 font-semibold">No questions found</p>
                  <p className="text-sm text-slate-600 mt-1">
                    {search ? 'Try a different search term or filter.' : 'Be the first to ask something.'}
                  </p>
                </motion.div>
              )}
            </div>
          </div>

          {/* ─── SECTION 6: KNOWLEDGE PULSE SIDE PANEL (desktop only) ─── */}
          <aside className="hidden lg:block w-72 xl:w-80 shrink-0">
            <div className="sticky top-24 space-y-4">
              {/* Trending Questions */}
              <div className="qna-side-panel">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={15} className="text-violet-400" />
                  <span className="text-xs font-bold uppercase tracking-widest text-violet-300">Trending</span>
                </div>
                <div className="space-y-2">
                  {trendingQuestions.length > 0 ? trendingQuestions.map((q, i) => {
                    const aCount = answersByQuestion.get(q.id)?.length ?? 0;
                    return (
                      <button
                        key={q.id}
                        onClick={() => openQuestion(q)}
                        className="qna-trending-item w-full text-left"
                      >
                        <span className="text-lg font-black text-violet-500/40 leading-none w-6 shrink-0">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-200 line-clamp-2 leading-snug">{q.title}</p>
                          <p className="text-[10px] text-slate-600 mt-0.5 flex items-center gap-2">
                            <span>▲ {q.upvotes}</span>
                            <span>{aCount} ans</span>
                            <span>{timeAgo(q.created_at)}</span>
                          </p>
                        </div>
                      </button>
                    );
                  }) : (
                    <p className="text-xs text-slate-600 text-center py-3">No trending questions yet</p>
                  )}
                </div>
              </div>

              {/* Tag Activity */}
              <div className="qna-side-panel">
                <div className="flex items-center gap-2 mb-3">
                  <Hash size={14} className="text-cyan-400" />
                  <span className="text-xs font-bold uppercase tracking-widest text-cyan-300">Active Topics</span>
                </div>
                <div className="space-y-2">
                  {tagActivity.length > 0 ? tagActivity.map(([t, count]) => (
                    <div key={t} className="flex items-center justify-between">
                      <button
                        onClick={() => setSearch(t)}
                        className={`neon-tag capitalize ${TAG_COLORS[t] ?? 'neon-tag-purple'}`}
                      >
                        {t}
                      </button>
                      <div className="flex items-center gap-2 flex-1 mx-3">
                        <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-500 transition-all"
                            style={{ width: `${Math.min(100, (count / (questions.length || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500 font-semibold w-6 text-right">{count}</span>
                    </div>
                  )) : (
                    <p className="text-xs text-slate-600 text-center py-2">No topics yet</p>
                  )}
                </div>
              </div>

              {/* Community Stats */}
              <div className="qna-side-panel">
                <div className="flex items-center gap-2 mb-3">
                  <Users size={14} className="text-emerald-400" />
                  <span className="text-xs font-bold uppercase tracking-widest text-emerald-300">Community</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Questions', value: questions.length, color: 'text-violet-300' },
                    { label: 'Answers', value: totalAnswers, color: 'text-cyan-300' },
                    { label: 'Solved', value: resolvedCount, color: 'text-emerald-300' },
                    { label: 'Contributors', value: uniqueContributors, color: 'text-amber-300' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-xl bg-white/3 border border-white/6 p-2.5 text-center">
                      <p className={`text-lg font-bold ${color}`}>{value}</p>
                      <p className="text-[10px] text-slate-600 uppercase tracking-wide">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* ─── ANSWER MODAL ─── */}
      <AnimatePresence>
        {activeQuestion && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center px-3 md:px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setActiveQuestionId(null)} />
            <motion.div
              className="relative w-full max-w-2xl border border-white/10 rounded-t-[2rem] md:rounded-[2rem] overflow-hidden max-h-[88vh] flex flex-col"
              style={{
                background: 'linear-gradient(180deg, rgba(124,58,237,0.08) 0%, rgba(7,7,22,0.95) 120px)',
                backdropFilter: 'blur(24px) saturate(160%)',
                boxShadow: '0 -4px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,58,237,0.25)',
              }}
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            >
              {/* Modal aura strip */}
              <div className="qna-modal-header-gradient absolute inset-x-0 top-0 h-32 pointer-events-none" />

              {/* Modal header */}
              <div className="relative px-5 py-5 border-b border-white/10 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`neon-tag capitalize ${TAG_COLORS[activeQuestion.tag] ?? 'neon-tag-purple'}`}>
                        #{activeQuestion.tag}
                      </span>
                      {activeQuestion.is_resolved && (
                        <span className="qna-badge qna-badge-solved">✓ Solved</span>
                      )}
                    </div>
                    <h2 className="text-lg font-semibold text-white leading-snug">{activeQuestion.title}</h2>
                    <p className="text-xs text-slate-500 mt-1">
                      asked {timeAgo(activeQuestion.created_at)} by{' '}
                      {getAnonymousAlias(activeQuestion.user_id, activeQuestion.user_id === user?.uid)}
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveQuestionId(null)}
                    className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-all shrink-0"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-sm text-slate-300 leading-relaxed mt-3 whitespace-pre-wrap">{activeQuestion.content}</p>
              </div>

              {/* Answers list */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {activeQuestionAnswers.length === 0 && (
                  <div className="text-center py-12">
                    <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                      <MessageSquarePlus size={20} className="text-violet-400/60" />
                    </div>
                    <p className="text-sm text-slate-400 font-medium">No answers yet</p>
                    <p className="text-xs text-slate-600 mt-1">Be the first to enlighten the void.</p>
                  </div>
                )}
                {activeQuestionAnswers.map((answer) => {
                  const mine = answer.user_id === user?.uid;
                  const canAccept = activeQuestion.user_id === user?.uid;
                  return (
                    <motion.div
                      key={answer.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`rounded-2xl border p-4 transition-all ${
                        answer.is_accepted
                          ? 'border-emerald-500/40 bg-emerald-500/8'
                          : 'border-white/8 bg-white/[0.025] hover:border-white/12'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span>{getAnonymousAlias(answer.user_id, mine)}</span>
                          <span>·</span>
                          <span>{timeAgo(answer.created_at)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {answer.is_accepted && (
                            <span className="qna-badge qna-badge-solved">✓ Accepted</span>
                          )}
                          {canAccept && (
                            <button
                              onClick={() => acceptAnswer(answer)}
                              className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                                answer.is_accepted
                                  ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                                  : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
                              }`}
                            >
                              {answer.is_accepted ? 'Unaccept' : 'Accept'}
                            </button>
                          )}
                          {(mine || profile?.is_admin) && (
                            <button
                              onClick={() => deleteAnswer(answer)}
                              className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{answer.content}</p>
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => upvoteAnswer(answer)}
                          className={`reaction-btn text-xs ${answerVotes.has(answer.id) ? 'reacted' : ''}`}
                        >
                          <span className="emoji">▲</span>
                          {answer.upvotes}
                        </button>
                        <button
                          onClick={() => setReportingContent({ id: answer.id, type: 'answer' })}
                          className="w-7 h-7 rounded-lg border border-white/8 text-slate-600 hover:border-amber-500/30 hover:text-amber-400 transition-all flex items-center justify-center"
                          title="Report Answer"
                        >
                          <AlertTriangle size={11} />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Answer input */}
              <div className="border-t border-white/10 px-4 py-4 shrink-0 bg-black/20">
                <div className="relative mb-3">
                  <textarea
                    className="input-field resize-none"
                    placeholder="Write an answer anonymously…"
                    rows={3}
                    maxLength={1200}
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                  />
                  <span className={`absolute right-3 bottom-3 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                    answerText.trim().length >= 2
                      ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                      : 'border-white/10 text-slate-500'
                  }`}>
                    {answerText.trim().length}/2 min
                  </span>
                </div>
                {answerError && <p className="text-xs text-red-400 font-medium mb-2">{answerError}</p>}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-600 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500/60 inline-block" />
                    Identity hidden in this space
                  </span>
                  <button
                    onClick={() => {
                      if (isQnADisabled) { toast.error('The Q&A section has been disabled by administrators.'); return; }
                      if (safeMode) { toast.error('Answering is restricted during Safe Mode'); return; }
                      submitAnswer();
                    }}
                    disabled={answerText.trim().length < 2 || answerSubmitting || safeMode || isQnADisabled}
                    className="btn-primary !w-auto px-5 py-2.5 rounded-xl text-sm disabled:opacity-50 disabled:grayscale flex items-center gap-2"
                  >
                    {(safeMode || isQnADisabled) && <ShieldAlert size={15} />}
                    {isQnADisabled ? 'Restricted' : safeMode ? 'Safe Mode' : answerSubmitting ? 'Posting…' : 'Post Answer'}
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
