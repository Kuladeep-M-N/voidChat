import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3,
  Clock3,
  Crown,
  Flame,
  Sparkles,
  Vote as VoteIcon,
  Waves,
  X,
  AlertTriangle,
  Trophy,
  Star
} from 'lucide-react';
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
  setDoc,
  serverTimestamp,
  getDocs
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import ReportModal from '../components/ReportModal';
import { toast } from 'sonner';

interface Poll {
  id: string;
  question: string;
  options: string[];
  created_at: any;
  created_by: string;
  tag: string;
  closed: boolean;
}

interface Vote {
  id: string;
  poll_id: string;
  option_index: number;
  user_id: string;
  created_at: any;
}

const TAGS = [
  { key: 'all', label: 'All rooms', icon: Sparkles, accent: 'from-fuchsia-500/30 via-cyan-500/20 to-blue-500/20' },
  { key: 'fun', label: 'Fun', icon: Flame, accent: 'from-orange-500/30 via-amber-400/15 to-pink-500/15' },
  { key: 'serious', label: 'Debate', icon: Crown, accent: 'from-blue-500/30 via-cyan-400/20 to-slate-500/15' },
  { key: 'college', label: 'Campus', icon: BarChart3, accent: 'from-emerald-500/25 via-teal-400/15 to-blue-500/15' },
  { key: 'random', label: 'Random', icon: Waves, accent: 'from-violet-500/30 via-sky-500/15 to-cyan-500/15' },
] as const;

const aliasAdjectives = ['Neon', 'Silent', 'Midnight', 'Pulse', 'Echo', 'Arc', 'Static', 'Orbit'];
const aliasNouns = ['Specter', 'Comet', 'Cipher', 'Drift', 'Signal', 'Rider', 'Halo', 'Switch'];

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const getAlias = (userId: string, isMe: boolean) => {
  if (isMe) return 'You';
  const hash = hashString(userId);
  const adjective = aliasAdjectives[hash % aliasAdjectives.length];
  const noun = aliasNouns[Math.floor(hash / aliasAdjectives.length) % aliasNouns.length];
  return `${adjective} ${noun} ${(hash % 900) + 100}`;
};

const timeAgo = (date: any) => {
  if (!date) return 'just now';
  const d = date?.toDate ? date.toDate() : new Date(date);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 10) return 'live now';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

export default function Polls() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  const [polls, setPolls] = useState<Poll[]>([]);
  const [allVotes, setAllVotes] = useState<Vote[]>([]);
  const [myVotes, setMyVotes] = useState<Map<string, number>>(new Map());

  const [showCreate, setShowCreate] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [tag, setTag] = useState('random');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [actionError, setActionError] = useState('');
  const [reportingPollId, setReportingPollId] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<'new' | 'popular'>('new');
  const [filterTag, setFilterTag] = useState('all');

  useEffect(() => {
    if (!loading && !user) navigate('/join');
  }, [loading, navigate, user]);

  useEffect(() => {
    if (!user) return;

    // 1. Polls Real-time Sync
    const pollsQuery = query(collection(db, 'polls'), orderBy('created_at', 'desc'));
    const unsubscribePolls = onSnapshot(pollsQuery, (snapshot) => {
      const items: Poll[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as Poll);
      });
      setPolls(items);
    });

    // 2. Votes Real-time Sync
    const votesQuery = query(collection(db, 'poll_votes'), orderBy('created_at', 'desc'));
    const unsubscribeVotes = onSnapshot(votesQuery, (snapshot) => {
      const votes: Vote[] = [];
      const mine = new Map<string, number>();
      
      snapshot.forEach((doc) => {
        const vote = { id: doc.id, ...doc.data() } as Vote;
        votes.push(vote);
        if (vote.user_id === user.uid) {
          mine.set(vote.poll_id, vote.option_index);
        }
      });
      
      setAllVotes(votes);
      setMyVotes(mine);
    });

    return () => {
      unsubscribePolls();
      unsubscribeVotes();
    };
  }, [user, navigate]);

  const voteBuckets = useMemo(() => {
    const bucket = new Map<string, { total: number; counts: number[]; latestVoteAt: any | null }>();

    polls.forEach((poll) => {
      bucket.set(poll.id, {
        total: 0,
        counts: Array.from({ length: poll.options.length }, () => 0),
        latestVoteAt: null,
      });
    });

    allVotes.forEach((vote) => {
      const entry = bucket.get(vote.poll_id);
      if (!entry) return;
      entry.total += 1;
      if (vote.option_index >= 0 && vote.option_index < entry.counts.length) {
        entry.counts[vote.option_index] += 1;
      }
      const voteTime = vote.created_at?.toDate ? vote.created_at.toDate().getTime() : new Date(vote.created_at || 0).getTime();
      const latestTime = entry.latestVoteAt?.toDate ? entry.latestVoteAt.toDate().getTime() : new Date(entry.latestVoteAt || 0).getTime();
      
      if (!entry.latestVoteAt || voteTime > latestTime) {
        entry.latestVoteAt = vote.created_at;
      }
    });

    return bucket;
  }, [allVotes, polls]);

  const totalVotes = useMemo(() => {
    let total = 0;
    voteBuckets.forEach((bucket) => {
      total += bucket.total;
    });
    return total;
  }, [voteBuckets]);

  const topPoll = useMemo(() => {
    return polls.reduce<Poll | null>((current, poll) => {
      const total = voteBuckets.get(poll.id)?.total ?? 0;
      if (!current) return poll;
      const currentTotal = voteBuckets.get(current.id)?.total ?? 0;
      return total > currentTotal ? poll : current;
    }, null);
  }, [polls, voteBuckets]);

  const sortedPolls = useMemo(() => {
    return [...polls]
      .filter((poll) => filterTag === 'all' || poll.tag === filterTag)
      .sort((a, b) => {
        if (sortBy === 'popular') {
          return (voteBuckets.get(b.id)?.total ?? 0) - (voteBuckets.get(a.id)?.total ?? 0);
        }
        const aTime = a.created_at?.toDate ? a.created_at.toDate().getTime() : new Date(a.created_at || 0).getTime();
        const bTime = b.created_at?.toDate ? b.created_at.toDate().getTime() : new Date(b.created_at || 0).getTime();
        return bTime - aTime;
      });
  }, [filterTag, polls, sortBy, voteBuckets]);

  const createPoll = async () => {
    if (!user || creating) return;

    const cleanQuestion = question.trim();
    const cleanOptions = options.map((option) => option.trim()).filter(Boolean);
    if (!cleanQuestion || cleanOptions.length < 2) return;

    setCreating(true);
    setCreateError('');

    try {
      await addDoc(collection(db, 'polls'), {
        question: cleanQuestion,
        options: cleanOptions,
        created_by: user.uid,
        tag,
        closed: false,
        created_at: serverTimestamp(),
      });

      setQuestion('');
      setOptions(['', '']);
      setTag('random');
      setShowCreate(false);
    } catch (err: any) {
      console.error('Create poll error:', err);
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const vote = async (poll: Poll, optionIndex: number) => {
    if (!user) {
      toast.error('Sign in to vote');
      return;
    }
    if (poll.closed) return;

    setActionError('');
    const toastId = toast.loading('Sending vote...');
    
    try {
      const voteId = `${poll.id}_${user.uid}`;
      await setDoc(doc(db, 'poll_votes', voteId), {
        poll_id: poll.id,
        user_id: user.uid,
        option_index: optionIndex,
        created_at: serverTimestamp()
      });
      toast.success('Vote recorded!', { id: toastId });
    } catch (err: any) {
      console.error('Vote error:', err);
      setActionError(err.message);
      toast.error('Failed to vote: ' + err.message, { id: toastId });
    }
  };

  const closePoll = async (poll: Poll) => {
    setActionError('');
    try {
      await updateDoc(doc(db, 'polls', poll.id), {
        closed: true
      });
    } catch (err: any) {
      console.error('Close poll error:', err);
      setActionError(err.message);
    }
  };

  const deletePoll = async (pollId: string) => {
    if (!window.confirm('Are you sure you want to delete this poll? All votes will be lost.')) return;
    setActionError('');

    try {
      await deleteDoc(doc(db, 'polls', pollId));
      const votesSnap = await getDocs(query(collection(db, 'poll_votes'), where('poll_id', '==', pollId)));
      const deletePromises = votesSnap.docs.map(v => deleteDoc(v.ref));
      await Promise.all(deletePromises);
    } catch (err: any) {
      console.error('Delete poll error:', err);
      setActionError(err.message);
    }
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
      <div className="ambient-blob w-[560px] h-[560px] bg-cyan-500/10 top-[-180px] right-[-80px]" />
      <div className="ambient-blob w-[460px] h-[460px] bg-fuchsia-500/10 bottom-[-120px] left-[-140px]" />

      <header className="relative z-10 border-b border-white/5 glass sticky top-0">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <Link to="/dashboard">
              <button className="btn-ghost rounded-xl p-2 text-slate-400">Back</button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-white">Live Poll Arena</h1>
                {profile?.is_admin && <span className="text-[10px] font-black bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full border border-red-500/20">ADMIN</span>}
              </div>
              <p className="text-xs text-slate-500">{polls.length} active rooms for anonymous voting</p>
            </div>
          </div>
          <button
            onClick={() => {
              setShowCreate(true);
              setCreateError('');
            }}
            className="btn-primary !w-auto px-4 py-2 rounded-xl text-sm"
          >
            Start Poll
          </button>
        </div>
      </header>

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-6">
        <motion.div
          className="mb-5 rounded-3xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_45%),radial-gradient(circle_at_bottom_right,rgba(217,70,239,0.14),transparent_40%),rgba(8,11,22,0.9)] p-5"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">Realtime pulse</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Every vote lands live across the room.</h2>
              <p className="mt-2 text-sm text-slate-300 max-w-lg">
                Hosts can post a poll, users can switch their pick while it stays open, and the leaderboard updates for everyone.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 min-w-[220px]">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-xs text-slate-400">Total votes</div>
                <div className="mt-1 text-2xl font-semibold text-white">{totalVotes}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-xs text-slate-400">Open polls</div>
                <div className="mt-1 text-2xl font-semibold text-white">{polls.filter((poll) => !poll.closed).length}</div>
              </div>
            </div>
          </div>
          {topPoll && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3">
              <Flame className="h-4 w-4 text-amber-300" />
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.18em] text-amber-200/80">Trending now</div>
                <div className="truncate text-sm text-white">{topPoll.question}</div>
              </div>
            </div>
          )}
        </motion.div>

        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div className="flex gap-1.5 overflow-x-auto">
            {TAGS.map((item) => (
              <button
                key={item.key}
                onClick={() => setFilterTag(item.key)}
                className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap transition-all ${
                  filterTag === item.key
                    ? 'border-blue-500/60 bg-blue-500/10 text-blue-300'
                    : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}
              >
                <item.icon className="inline h-3.5 w-3.5 mr-1" /> {item.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 shrink-0">
            {(['new', 'popular'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setSortBy(option)}
                className={`text-xs px-3 py-1.5 rounded-full border capitalize transition-all ${
                  sortBy === option
                    ? 'border-blue-500/60 bg-blue-500/10 text-blue-300'
                    : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}
              >
                {option === 'popular' ? 'Popular' : 'Newest'}
              </button>
            ))}
          </div>
        </div>

        {actionError && (
          <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            Poll action failed: {actionError}
          </div>
        )}

        <div className="space-y-5">
          <AnimatePresence>
            {sortedPolls.map((poll, index) => {
              const bucket = voteBuckets.get(poll.id);
              const total = bucket?.total ?? 0;
              const voted = myVotes.has(poll.id);
              const myOptionIndex = myVotes.get(poll.id);
              const isOwn = poll.created_by === user?.uid || profile?.is_admin;
              const tagInfo = TAGS.find((item) => item.key === poll.tag);
              const winningVotes = Math.max(...(bucket?.counts ?? [0]));
              const leadingIndex = (bucket?.counts ?? []).findIndex((count) => count === winningVotes);
              const lastVoteLabel = bucket?.latestVoteAt ? timeAgo(bucket.latestVoteAt) : 'quiet right now';
              const isHot = bucket?.latestVoteAt ? Date.now() - new Date(bucket.latestVoteAt).getTime() < 30000 : false;

              return (
                <motion.div
                  key={poll.id}
                  className={`relative overflow-hidden rounded-3xl border p-6 ${
                    poll.closed ? 'glass border-white/5 opacity-85' : 'border-cyan-400/20 bg-slate-950/70'
                  }`}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ delay: index < 5 ? index * 0.06 : 0 }}
                >
                  <div className={`absolute inset-0 opacity-80 bg-gradient-to-br ${tagInfo?.accent ?? TAGS[4].accent}`} />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.12),rgba(2,6,23,0.82))]" />
                  
                  {poll.closed && total > 0 && leadingIndex >= 0 && (
                    <motion.div 
                      className="relative z-10 mb-4 overflow-hidden rounded-2xl border border-amber-400/20 bg-white/5 backdrop-blur-xl p-4 md:p-5 text-center group cursor-default"
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                    >
                      {/* Header Section */}
                      <div className="flex items-center justify-center gap-2.5 mb-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/15 text-amber-300">
                          <Trophy className="h-4 w-4" />
                        </div>
                        <div className="text-left">
                          <p className="text-[8px] font-black uppercase tracking-[0.2em] text-amber-200/60 leading-none">Winner</p>
                          <h4 className="text-[10px] font-medium text-slate-500 mt-0.5 max-w-[150px] truncate">{poll.question}</h4>
                        </div>
                      </div>

                      {/* Main Winner Typography */}
                      <motion.h2 
                        className="text-xl md:text-2xl font-black text-transparent bg-clip-text bg-[linear-gradient(135deg,#f6c453,#ff9f43)] mb-4"
                      >
                        {poll.options[leadingIndex]}
                      </motion.h2>

                      {/* Info & Progress - Compact Row */}
                      <div className="flex items-center justify-center gap-4 border-t border-white/5 pt-3">
                        <div className="flex gap-2">
                          <div className="flex items-center gap-1.5 text-[10px] text-amber-100/70">
                            <span className="font-bold">{winningVotes}</span>
                            <span className="opacity-50 uppercase tracking-tighter">Votes</span>
                          </div>
                          <div className="w-px h-3 bg-white/10" />
                          <div className="text-[10px] font-bold text-amber-400">
                            {Math.round((winningVotes / total) * 100)}% Lead
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <div className="relative">
                    <div className="flex justify-between items-start mb-4 gap-3">
                      <div className="flex-1">
                        {tagInfo && tagInfo.key !== 'all' && (
                          <span className="text-xs text-cyan-200/80 font-medium block mb-1">{tagInfo.label}</span>
                        )}
                        <h3 className="font-semibold text-white leading-snug text-lg">{poll.question}</h3>
                        <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-slate-300">
                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                            host {getAlias(poll.created_by, poll.created_by === user?.uid)}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                            posted {timeAgo(poll.created_at)}
                          </span>
                          <span
                            className={`rounded-full border px-2.5 py-1 ${
                              isHot
                                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                                : 'border-white/10 bg-white/5 text-slate-300'
                            }`}
                          >
                            {isHot ? 'votes incoming' : lastVoteLabel}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {poll.closed && (
                          <span className="text-xs bg-slate-700/60 text-slate-300 px-2 py-1 rounded-full">Closed</span>
                        )}
                        {!poll.closed && isHot && (
                          <span className="text-xs bg-emerald-500/15 text-emerald-200 px-2 py-1 rounded-full border border-emerald-400/25">
                            Live
                          </span>
                        )}
                        {isOwn && !poll.closed && (
                          <button
                            onClick={() => closePoll(poll)}
                            className="text-xs text-slate-300 hover:text-orange-200 transition-colors px-2 py-1 rounded-lg hover:bg-orange-500/10"
                          >
                            Close
                          </button>
                        )}
                        {isOwn && (
                          <button
                            onClick={() => deletePoll(poll.id)}
                            className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
                          >
                            Delete
                          </button>
                        )}
                        <button
                          onClick={() => setReportingPollId(poll.id)}
                          className="p-1 text-slate-500 hover:text-amber-400 transition-colors"
                          title="Report Poll"
                        >
                          <AlertTriangle size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-slate-400">Total votes</div>
                        <div className="mt-1 font-semibold text-white">{total}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-slate-400">Status</div>
                        <div className="mt-1 font-semibold text-white">{poll.closed ? 'Locked' : 'Open mic'}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-slate-400">Lead</div>
                        <div className="mt-1 font-semibold text-white">{leadingIndex >= 0 ? `${winningVotes} votes` : 'No votes'}</div>
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {poll.options.map((option, optionIndex) => {
                        const count = bucket?.counts[optionIndex] ?? 0;
                        const percent = total > 0 ? Math.round((count / total) * 100) : 0;
                        const isMyVote = myOptionIndex === optionIndex;
                        const isLeader = leadingIndex === optionIndex && count > 0;
                        const showResults = voted || poll.closed || total > 0;

                        return (
                          <button
                            key={optionIndex}
                            onClick={() => vote(poll, optionIndex)}
                            disabled={poll.closed}
                            className={`w-full text-left rounded-xl p-3.5 transition-all relative overflow-hidden border group ${
                              showResults
                                ? isMyVote
                                  ? 'border-cyan-400/60'
                                  : isLeader
                                    ? 'border-amber-400/40'
                                    : 'border-white/10'
                                : 'border-white/10 hover:border-cyan-400/40 hover:bg-cyan-500/5 cursor-pointer'
                            } ${!poll.closed ? 'active:scale-[0.99]' : ''}`}
                          >
                            {showResults && (
                              <motion.div
                                className={`absolute inset-0 rounded-xl ${
                                  isMyVote ? 'bg-cyan-500/20' : isLeader ? 'bg-amber-400/10' : 'bg-white/5'
                                }`}
                                initial={{ width: 0 }}
                                animate={{ width: `${percent}%` }}
                                transition={{ duration: 0.7, ease: 'easeOut', delay: index * 0.03 }}
                              />
                            )}
                            <div className="relative flex justify-between items-center gap-3">
                              <span className={`text-sm font-medium flex items-center gap-2 ${isMyVote ? 'text-cyan-100' : 'text-slate-100'}`}>
                                {isMyVote && <VoteIcon className="h-4 w-4 text-cyan-300" />}
                                {isLeader && !isMyVote && <Crown className="h-4 w-4 text-amber-300" />}
                                {option}
                              </span>
                              {showResults && <span className="text-xs text-slate-300 shrink-0">{percent}% | {count}</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex justify-between items-center mt-4 gap-3 flex-wrap">
                      <p className="text-xs text-slate-400">
                        {total} vote{total !== 1 ? 's' : ''} | {voted ? 'you can switch your vote until the host closes it' : 'anonymous voting enabled'}
                      </p>
                      {poll.closed && <p className="text-xs text-slate-400">This poll is locked.</p>}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {sortedPolls.length === 0 && (
            <div className="text-center py-20">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
                <BarChart3 className="h-7 w-7" />
              </div>
              <p className="font-medium text-slate-400">No polls yet</p>
              <button onClick={() => setShowCreate(true)} className="btn-primary !w-auto px-5 py-2 rounded-xl text-sm mt-4">
                Create first poll
              </button>
            </div>
          )}
        </div>
      </main>

      <AnimatePresence>
        {showCreate && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(event) => {
              if (event.target === event.currentTarget) setShowCreate(false);
            }}
          >
            <motion.div
              className="glass border border-white/10 rounded-3xl p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto"
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            >
              <div className="flex items-center justify-between mb-6 gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">Create a Poll</h2>
                  <p className="mt-1 text-sm text-slate-400">Launch a live question for the room and let the leaderboard move in realtime.</p>
                </div>
                <button
                  onClick={() => setShowCreate(false)}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 transition-all text-sm"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider mb-2 block">Question</label>
                  <textarea
                    className="input-field resize-none"
                    placeholder="Ask something interesting..."
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    maxLength={200}
                    rows={2}
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider mb-2 block">Category</label>
                  <div className="flex gap-2 flex-wrap">
                    {TAGS.slice(1).map((item) => (
                      <button
                        key={item.key}
                        onClick={() => setTag(item.key)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                          tag === item.key
                            ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                            : 'border-white/10 text-slate-500 hover:border-white/20'
                        }`}
                      >
                        <item.icon className="inline h-3.5 w-3.5 mr-1" /> {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider mb-2 block">Options (min 2, max 8)</label>
                  <div className="space-y-2">
                    {options.map((option, index) => (
                      <div key={index} className="flex gap-2">
                        <input
                          className="input-field flex-1 py-2.5"
                          placeholder={`Option ${index + 1}`}
                          value={option}
                          onChange={(event) => {
                            const next = [...options];
                            next[index] = event.target.value;
                            setOptions(next);
                          }}
                          maxLength={120}
                        />
                        {options.length > 2 && (
                          <button
                            onClick={() => setOptions((prev) => prev.filter((_, optionIndex) => optionIndex !== index))}
                            className="text-slate-500 hover:text-red-400 px-3 transition-colors rounded-xl hover:bg-red-500/10"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {options.length < 8 && (
                    <button
                      onClick={() => setOptions((prev) => [...prev, ''])}
                      className="mt-2 text-sm text-slate-400 hover:text-white transition-colors"
                    >
                      Add option
                    </button>
                  )}
                </div>

                {createError && (
                  <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                    {createError}
                  </p>
                )}

                <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/5 px-4 py-3 text-xs text-slate-300">
                  Open polls update for everyone in realtime. Hosts can close them at any time, and voters can change their pick while the poll remains open.
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={createPoll}
                  disabled={creating || !question.trim() || options.filter((option) => option.trim()).length < 2}
                  className="btn-primary rounded-xl flex-1"
                >
                  {creating ? 'Creating...' : 'Create Poll'}
                </button>
                <button onClick={() => setShowCreate(false)} className="btn-ghost rounded-xl px-5 py-2.5 border border-white/10">
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed bottom-4 right-4 z-20 hidden md:flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-slate-300 backdrop-blur">
        <Clock3 className="h-3.5 w-3.5 text-cyan-300" />
        Realtime sync enabled
      </div>
      <ReportModal 
        isOpen={!!reportingPollId}
        onClose={() => setReportingPollId(null)}
        targetType="poll"
        targetId={reportingPollId || ''}
      />
    </div>
  );
}
