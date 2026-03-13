import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface QnaQuestion {
  id: string;
  title: string;
  content: string;
  tag: string;
  user_id: string;
  upvotes: number;
  views: number;
  is_resolved: boolean;
  created_at: string;
}

interface QnaAnswer {
  id: string;
  question_id: string;
  content: string;
  user_id: string;
  upvotes: number;
  is_accepted: boolean;
  created_at: string;
}

const TAGS = ['general', 'career', 'relationships', 'study', 'tech', 'random'] as const;
const SORT_OPTIONS = ['new', 'hot', 'unanswered'] as const;
const STATUS_OPTIONS = ['all', 'open', 'resolved'] as const;

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

const timeAgo = (date: string) => {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

export default function QnA() {
  const { user, profile, loading } = useAuth();
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

  useEffect(() => {
    if (!loading && !user) navigate('/join');
  }, [loading, navigate, user]);

  useEffect(() => {
    if (!user) return;

    Promise.all([
      supabase.from('qna_questions').select('*').order('created_at', { ascending: false }),
      supabase.from('qna_answers').select('*').order('created_at', { ascending: true }),
    ]).then(([{ data: qData, error: qError }, { data: aData, error: aError }]) => {
      if (qError) console.error('QnA questions load error:', qError);
      if (aError) console.error('QnA answers load error:', aError);
      if (qData) setQuestions(qData as QnaQuestion[]);
      if (aData) setAnswers(aData as QnaAnswer[]);
    });

    const channel = supabase
      .channel('qna-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'qna_questions' }, (payload) => {
        setQuestions((prev) => [payload.new as QnaQuestion, ...prev]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'qna_questions' }, (payload) => {
        setQuestions((prev) => prev.map((item) => (item.id === payload.new.id ? (payload.new as QnaQuestion) : item)));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'qna_questions' }, (payload) => {
        const deletedId = payload.old.id as string;
        setQuestions((prev) => prev.filter((item) => item.id !== deletedId));
        setAnswers((prev) => prev.filter((item) => item.question_id !== deletedId));
        setActiveQuestionId((prev) => (prev === deletedId ? null : prev));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'qna_answers' }, (payload) => {
        setAnswers((prev) => {
          const next = payload.new as QnaAnswer;
          if (prev.find((item) => item.id === next.id)) return prev;
          return [...prev, next];
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'qna_answers' }, (payload) => {
        setAnswers((prev) => prev.map((item) => (item.id === payload.new.id ? (payload.new as QnaAnswer) : item)));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'qna_answers' }, (payload) => {
        const deletedId = payload.old.id as string;
        setAnswers((prev) => prev.filter((item) => item.id !== deletedId));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
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
      if (sortBy === 'new') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === 'unanswered') {
        const aAnswered = (answersByQuestion.get(a.id) ?? []).length;
        const bAnswered = (answersByQuestion.get(b.id) ?? []).length;
        if (aAnswered !== bAnswered) return aAnswered - bAnswered;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      const scoreA = a.upvotes * 3 + (answersByQuestion.get(a.id)?.length ?? 0) * 2 + a.views;
      const scoreB = b.upvotes * 3 + (answersByQuestion.get(b.id)?.length ?? 0) * 2 + b.views;
      return scoreB - scoreA;
    });
  }, [answersByQuestion, questions, search, sortBy, statusFilter]);

  const totalAnswers = answers.length;
  const resolvedCount = questions.filter((question) => question.is_resolved).length;
  const resolutionRate = questions.length > 0 ? Math.round((resolvedCount / questions.length) * 100) : 0;

  const submitQuestion = async () => {
    if (!user || questionSubmitting) return;
    const cleanTitle = title.trim();
    const cleanContent = content.trim();
    if (!cleanTitle || !cleanContent) return;

    setQuestionSubmitting(true);
    setQuestionError('');
    const { error } = await supabase.from('qna_questions').insert({
      title: cleanTitle,
      content: cleanContent,
      tag,
      user_id: user.id,
    });
    setQuestionSubmitting(false);

    if (error) {
      console.error('Question submit error:', error);
      setQuestionError(error.message.includes('check constraint') 
        ? 'Title must be 5+ chars, Content must be 10+ chars.' 
        : 'Failed to post: ' + error.message);
      return;
    }

    setTitle('');
    setContent('');
    setTag('general');
  };

  const submitAnswer = async () => {
    if (!user || !activeQuestion || answerSubmitting) return;
    const clean = answerText.trim();
    if (!clean) return;

    setAnswerSubmitting(true);
    setAnswerError('');
    const { error } = await supabase.from('qna_answers').insert({
      question_id: activeQuestion.id,
      content: clean,
      user_id: user.id,
    });
    setAnswerSubmitting(false);

    if (error) {
      console.error('Answer submit error:', error);
      setAnswerError(error.message.includes('check constraint') 
        ? 'Answer is too short (min 2 chars).' 
        : 'Failed to post answer.');
      return;
    }

    setAnswerText('');
  };

  const upvoteQuestion = async (question: QnaQuestion) => {
    if (questionVotes.has(question.id)) return;
    setQuestionVotes((prev) => new Set(prev).add(question.id));
    setQuestions((prev) => prev.map((item) => (item.id === question.id ? { ...item, upvotes: item.upvotes + 1 } : item)));
    await supabase.from('qna_questions').update({ upvotes: question.upvotes + 1 }).eq('id', question.id);
  };

  const upvoteAnswer = async (answer: QnaAnswer) => {
    if (answerVotes.has(answer.id)) return;
    setAnswerVotes((prev) => new Set(prev).add(answer.id));
    setAnswers((prev) => prev.map((item) => (item.id === answer.id ? { ...item, upvotes: item.upvotes + 1 } : item)));
    await supabase.from('qna_answers').update({ upvotes: answer.upvotes + 1 }).eq('id', answer.id);
  };

  const openQuestion = async (question: QnaQuestion) => {
    setActiveQuestionId(question.id);
    if (viewedQuestionIds.has(question.id)) return;
    setViewedQuestionIds((prev) => new Set(prev).add(question.id));
    setQuestions((prev) => prev.map((item) => (item.id === question.id ? { ...item, views: item.views + 1 } : item)));
    await supabase.from('qna_questions').update({ views: question.views + 1 }).eq('id', question.id);
  };

  const acceptAnswer = async (answer: QnaAnswer) => {
    if (!user || !activeQuestion || activeQuestion.user_id !== user.id) return;

    const questionAnswers = answersByQuestion.get(activeQuestion.id) ?? [];
    const currentlyAccepted = questionAnswers.find((item) => item.is_accepted);
    const shouldAccept = !answer.is_accepted;

    setAnswers((prev) =>
      prev.map((item) => {
        if (item.question_id !== activeQuestion.id) return item;
        if (item.id === answer.id) return { ...item, is_accepted: shouldAccept };
        if (item.is_accepted) return { ...item, is_accepted: false };
        return item;
      }),
    );
    setQuestions((prev) =>
      prev.map((item) => (item.id === activeQuestion.id ? { ...item, is_resolved: shouldAccept } : item)),
    );

    if (currentlyAccepted && currentlyAccepted.id !== answer.id) {
      await supabase.from('qna_answers').update({ is_accepted: false }).eq('id', currentlyAccepted.id);
    }
    await supabase.from('qna_answers').update({ is_accepted: shouldAccept }).eq('id', answer.id);
    await supabase.from('qna_questions').update({ is_resolved: shouldAccept }).eq('id', activeQuestion.id);
  };

  const deleteQuestion = async (question: QnaQuestion) => {
    if (!user || (question.user_id !== user.id && !profile?.is_admin)) return;
    setQuestions((prev) => prev.filter((item) => item.id !== question.id));
    setAnswers((prev) => prev.filter((item) => item.question_id !== question.id));
    if (activeQuestionId === question.id) setActiveQuestionId(null);
    await supabase.from('qna_questions').delete().eq('id', question.id);
  };

  const deleteAnswer = async (answer: QnaAnswer) => {
    if (!user || (answer.user_id !== user.id && !profile?.is_admin)) return;
    setAnswers((prev) => prev.filter((item) => item.id !== answer.id));
    await supabase.from('qna_answers').delete().eq('id', answer.id);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="ambient-blob w-[580px] h-[580px] bg-amber-500/10 top-[-160px] right-[10%]" />
      <div className="ambient-blob w-[420px] h-[420px] bg-teal-400/8 bottom-[-120px] left-[-100px]" />

      <header className="relative z-10 border-b border-white/5 glass sticky top-0">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <Link to="/dashboard">
              <button className="btn-ghost rounded-xl p-2 text-slate-400">Back</button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-white">Anonymous Q&A</h1>
                {profile?.is_admin && <span className="text-[10px] font-black bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full border border-red-500/20">ADMIN</span>}
              </div>
              <p className="text-xs text-slate-500">No names shown in this space</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">
              {questions.length} questions
            </span>
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
              {resolutionRate}% solved
            </span>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-3xl mx-auto px-4 py-6">
        <motion.div
          className="glass rounded-2xl border border-amber-500/25 p-6 mb-6"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 className="text-sm uppercase tracking-[0.2em] text-amber-300/80 mb-4">Ask Anonymously</h2>
          <div className="space-y-3">
            <div className="relative">
              <input
                className="input-field pr-16"
                placeholder="Question title"
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                title.trim().length >= 5 
                  ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' 
                  : 'border-white/10 text-slate-500'
              }`}>
                {title.trim().length}/5 min
              </span>
            </div>
            <div className="relative">
              <textarea
                className="input-field resize-none"
                placeholder="Add context so answers are useful."
                rows={4}
                maxLength={1000}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
              <span className={`absolute right-3 bottom-3 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                content.trim().length >= 10 
                  ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' 
                  : 'border-white/10 text-slate-500'
              }`}>
                {content.trim().length}/10 min
              </span>
            </div>
             {questionError && (
                <p className="text-xs text-red-400 mt-2 font-medium">{questionError}</p>
              )}
              <div className="flex items-center justify-between gap-3 flex-wrap mt-2">
                <div className="flex gap-2 flex-wrap">
                  {TAGS.map((item) => (
                    <button
                      key={item}
                      onClick={() => setTag(item)}
                      className={`text-xs px-3 py-1.5 rounded-full border capitalize transition-all ${
                        tag === item
                          ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                          : 'border-white/10 text-slate-500 hover:border-white/20'
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <button
                  onClick={submitQuestion}
                  disabled={title.trim().length < 5 || content.trim().length < 10 || questionSubmitting}
                  className="btn-primary !w-auto px-5 py-2 rounded-xl text-sm disabled:opacity-50 disabled:grayscale transition-all"
                >
                  {questionSubmitting ? 'Posting...' : 'Post Question'}
                </button>
              </div>
          </div>
        </motion.div>

        <div className="glass border border-white/10 rounded-2xl p-4 mb-5">
          <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <input
              className="input-field md:max-w-sm py-2.5"
              placeholder="Search by title, body, or tag..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="flex items-center gap-2 flex-wrap">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => setStatusFilter(option)}
                  className={`text-xs px-3 py-1.5 rounded-full border uppercase tracking-wide transition-all ${
                    statusFilter === option
                      ? 'border-teal-400/60 bg-teal-500/15 text-teal-200'
                      : 'border-white/10 text-slate-500 hover:border-white/20'
                  }`}
                >
                  {option}
                </button>
              ))}
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => setSortBy(option)}
                  className={`text-xs px-3 py-1.5 rounded-full border uppercase tracking-wide transition-all ${
                    sortBy === option
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-white/10 text-slate-500 hover:border-white/20'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {questions.length} total questions | {totalAnswers} total answers | identity hidden by design
          </div>
        </div>

        <div className="space-y-4">
          <AnimatePresence>
            {visibleQuestions.map((question, index) => {
              const answerCount = answersByQuestion.get(question.id)?.length ?? 0;
              const alias = getAnonymousAlias(question.user_id, question.user_id === user?.id);
              return (
                <motion.div
                  key={question.id}
                  className="glass border border-white/10 rounded-2xl p-5"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ delay: index < 8 ? index * 0.03 : 0 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[11px] uppercase tracking-[0.16em] text-amber-300/80">{question.tag}</span>
                      <h3 className="text-lg font-semibold text-white mt-1">{question.title}</h3>
                    </div>
                    {question.is_resolved ? (
                      <span className="text-[11px] uppercase tracking-wide px-2.5 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-200">
                        Solved
                      </span>
                    ) : (
                      <span className="text-[11px] uppercase tracking-wide px-2.5 py-1 rounded-full border border-slate-500/30 bg-slate-700/20 text-slate-300">
                        Open
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed mt-2 line-clamp-3 whitespace-pre-wrap">{question.content}</p>

                  <div className="flex items-center justify-between mt-4 gap-3 flex-wrap">
                    <div className="text-xs text-slate-500">
                      asked by {alias} | {timeAgo(question.created_at)}
                    </div>
                    <div className="flex items-center gap-2">
                      {(question.user_id === user?.id || profile?.is_admin) && (
                        <button
                          onClick={() => deleteQuestion(question)}
                          className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                      )}
                      <button
                        onClick={() => upvoteQuestion(question)}
                        className={`text-xs px-3 py-1.5 rounded-xl border transition-all ${
                          questionVotes.has(question.id)
                            ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                            : 'border-white/10 text-slate-400 hover:border-amber-500/40 hover:text-amber-200'
                        }`}
                      >
                        + {question.upvotes}
                      </button>
                      <button
                        onClick={() => openQuestion(question)}
                        className="text-xs px-3 py-1.5 rounded-xl border border-white/10 text-slate-300 hover:border-teal-400/40 hover:text-teal-200"
                      >
                        {answerCount} answers | {question.views} views
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {visibleQuestions.length === 0 && (
            <div className="glass border border-white/10 rounded-2xl p-10 text-center">
              <p className="text-slate-300 font-medium">No questions found</p>
              <p className="text-sm text-slate-500 mt-1">Try another filter or post the first one.</p>
            </div>
          )}
        </div>
      </main>

      <AnimatePresence>
        {activeQuestion && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center px-3 md:px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setActiveQuestionId(null)} />
            <motion.div
              className="relative w-full max-w-3xl glass border border-white/10 rounded-t-3xl md:rounded-3xl overflow-hidden max-h-[85vh] flex flex-col"
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            >
              <div className="px-5 py-4 border-b border-white/10 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.15em] text-amber-300/80">{activeQuestion.tag}</div>
                    <h2 className="text-lg font-semibold text-white mt-1">{activeQuestion.title}</h2>
                    <p className="text-xs text-slate-500 mt-1">
                      asked {timeAgo(activeQuestion.created_at)} by{' '}
                      {getAnonymousAlias(activeQuestion.user_id, activeQuestion.user_id === user?.id)}
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveQuestionId(null)}
                    className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 text-sm"
                  >
                    x
                  </button>
                </div>
                <p className="text-sm text-slate-300 leading-relaxed mt-4 whitespace-pre-wrap">{activeQuestion.content}</p>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {activeQuestionAnswers.length === 0 && (
                  <div className="text-center py-10 text-slate-500">
                    <p className="text-sm">No answers yet. Be the first to answer.</p>
                  </div>
                )}
                {activeQuestionAnswers.map((answer) => {
                  const mine = answer.user_id === user?.id;
                  const canAccept = activeQuestion.user_id === user?.id;
                  return (
                    <div
                      key={answer.id}
                      className={`rounded-xl border p-4 ${
                        answer.is_accepted
                          ? 'border-emerald-500/45 bg-emerald-500/10'
                          : 'border-white/10 bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-xs text-slate-500">
                          {getAnonymousAlias(answer.user_id, mine)} | {timeAgo(answer.created_at)}
                        </div>
                        <div className="flex items-center gap-2">
                          {answer.is_accepted && (
                            <span className="text-[11px] uppercase tracking-wide px-2 py-1 rounded-full border border-emerald-500/40 text-emerald-200">
                              Accepted
                            </span>
                          )}
                          {canAccept && (
                            <button
                              onClick={() => acceptAnswer(answer)}
                              className="text-xs px-2.5 py-1 rounded-lg border border-emerald-500/35 text-emerald-200 hover:bg-emerald-500/15"
                            >
                              {answer.is_accepted ? 'Unaccept' : 'Accept'}
                            </button>
                          )}
                          {(mine || profile?.is_admin) && (
                            <button
                              onClick={() => deleteAnswer(answer)}
                              className="text-xs px-2.5 py-1 rounded-lg border border-red-500/35 text-red-200 hover:bg-red-500/15"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-slate-200 mt-2 whitespace-pre-wrap leading-relaxed">{answer.content}</p>
                      <div className="mt-3">
                        <button
                          onClick={() => upvoteAnswer(answer)}
                          className={`text-xs px-3 py-1.5 rounded-lg border ${
                            answerVotes.has(answer.id)
                              ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                              : 'border-white/10 text-slate-400 hover:border-amber-500/40'
                          }`}
                        >
                          + {answer.upvotes}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-white/10 p-4 shrink-0">
                <div className="relative mb-3">
                  <textarea
                    className="input-field resize-none"
                    placeholder="Write an answer anonymously..."
                    rows={3}
                    maxLength={1200}
                    value={answerText}
                    onChange={(event) => setAnswerText(event.target.value)}
                  />
                  <span className={`absolute right-3 bottom-3 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                    answerText.trim().length >= 2 
                      ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' 
                      : 'border-white/10 text-slate-500'
                  }`}>
                    {answerText.trim().length}/2 min
                  </span>
                </div>
                <div className="flex flex-col gap-2 mt-3">
                  {answerError && (
                    <p className="text-xs text-red-400 font-medium">{answerError}</p>
                  )}
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-xs text-slate-500">Your name remains hidden in this Q&A space.</span>
                    <button
                      onClick={submitAnswer}
                      disabled={answerText.trim().length < 2 || answerSubmitting}
                      className="btn-primary !w-auto px-5 py-2 rounded-xl text-sm disabled:opacity-50 disabled:grayscale transition-all"
                    >
                      {answerSubmitting ? 'Posting...' : 'Post Answer'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

