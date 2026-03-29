import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  AtSign,
  AlertTriangle,
  Copy,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  Reply,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  X,
  Zap,
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
  getDocs,
  setDoc,
  serverTimestamp,
  increment
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';
import { containsInappropriateContent } from '../lib/filter';
import ReportModal from '../components/ReportModal';
import { useSystemConfig } from '../hooks/useSystemConfig';
import { ShieldAlert } from 'lucide-react';
import FeatureDisabledBanner from '../components/FeatureDisabledBanner';
import { sanitizeContent } from '../lib/sanitize';

interface Shoutout {
  id: string;
  message: string;
  to_alias: string;
  from_alias: string;
  created_at: any;
  reactions?: Record<string, string[]>;
  parent_id?: string;
  user_id: string;
}

interface ReplyContext {
  shoutoutId: string;
  target: string;
  preview: string;
}

type Tab = 'all' | 'for_me' | 'from_me';
type SortMode = 'recent' | 'hype';

const REACTIONS = [
  { emoji: '❤️', accent: 'text-rose-300', border: 'hover:border-rose-400/40 hover:bg-rose-500/10' },
  { emoji: '😂', accent: 'text-amber-300', border: 'hover:border-amber-400/40 hover:bg-amber-500/10' },
  { emoji: '🔥', accent: 'text-orange-300', border: 'hover:border-orange-400/40 hover:bg-orange-500/10' },
  { emoji: '👏', accent: 'text-cyan-300', border: 'hover:border-cyan-400/40 hover:bg-cyan-500/10' },
  { emoji: '🙏', accent: 'text-violet-300', border: 'hover:border-violet-400/40 hover:bg-violet-500/10' },
] as const;

const QUESTION_PROMPTS = [
  'Who in this space deserves a late-night appreciation post?',
  'Which username has been living in your head rent free today?',
  'What is the softest thing you wish you had already said out loud?',
  'Who should open Shoutouts and instantly know this message is for them?',
  'What tiny moment from today deserves a public little spotlight?',
];

const LIVE_MEMBER_OFFSETS = [0, 0, 0, 0, 0]; // No longer needed for randomness

const STARFIELD = Array.from({ length: 40 }, (_, index) => ({
  id: index,
  left: `${(index * 19) % 100}%`,
  top: `${(index * 23) % 100}%`,
  size: index % 5 === 0 ? 3 : 2,
  delay: (index % 7) * 0.6,
  duration: 2.8 + (index % 5) * 0.5,
}));

function normalizeReactions(reactionMap?: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(reactionMap ?? {}).map(([emoji, userIds]) => [emoji, Array.from(new Set(userIds ?? []))]),
  ) as Record<string, string[]>;
}

function seedReactionState(items: Shoutout[]) {
  return items.reduce<Record<string, Record<string, string[]>>>((accumulator, item) => {
    accumulator[item.id] = normalizeReactions(item.reactions);
    return accumulator;
  }, {});
}

function timeAgo(date: any) {
  if (!date) return 'just now';
  const d = date?.toDate ? date.toDate() : new Date(date);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function countByAlias(items: string[]) {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  });
  return counts;
}

function topAlias(items: string[]) {
  const counts = countByAlias(items.filter(Boolean));
  let winner = '';
  let score = 0;

  counts.forEach((value, key) => {
    if (value > score) {
      winner = key;
      score = value;
    }
  });

  return { winner, score };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function Shoutouts() {
  const { user, profile, loading } = useAuth();
  const { config } = useSystemConfig();
  const isDisabled = config.disableShoutouts && !profile?.is_admin;
  const safeMode = (config.safeMode || isDisabled) && !profile?.is_admin;
  const navigate = useNavigate();
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  const [shoutouts, setShoutouts] = useState<Shoutout[]>([]);
  const [toAlias, setToAlias] = useState('');
  const [message, setMessage] = useState('');
  const [posting, setPosting] = useState(false);
  const [usernameList, setUsernameList] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>({});
  const [pulseTick, setPulseTick] = useState(0);
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [presenceCount, setPresenceCount] = useState(1);
  const [reportingContent, setReportingContent] = useState<{ type: 'shoutout' | 'user' | 'shoutout_comment'; id: string } | null>(null);
  const [reportCounts, setReportCounts] = useState<Record<string, number>>({});
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/join');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPulseTick((current) => current + 1);
    }, 5000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!user) return;

    // 1. Shoutouts Real-time Sync
    const shoutoutsQuery = query(collection(db, 'shoutouts'), orderBy('created_at', 'desc'));
    const unsubscribeShoutouts = onSnapshot(shoutoutsQuery, (snapshot) => {
      const items: Shoutout[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as Shoutout);
      });
      setShoutouts(items);
      setReactions(seedReactionState(items));
    });

    // 2. Users Real-time Sync (for alias list)
    const usersQuery = query(collection(db, 'users'));
    const unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
      const aliases: string[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.anonymous_username) aliases.push(data.anonymous_username);
      });
      setUsernameList(Array.from(new Set(aliases)));
    });

    // 3. Reports Sync
    const reportsQuery = query(collection(db, 'reports'), where('target_type', '==', 'shoutout'));
    const unsubscribeReports = onSnapshot(reportsQuery, (snapshot) => {
      const counts: Record<string, number> = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        counts[data.target_id] = (counts[data.target_id] || 0) + 1;
      });
      setReportCounts(counts);
    });

    // 4. Presence Simulation (Simple Firestore-based presence)
    const presenceRef = doc(db, 'online_users', user.uid);
    const updatePresence = async () => {
      await setDoc(presenceRef, {
        user_id: user.uid,
        last_seen: serverTimestamp()
      });
    };
    updatePresence();
    const presenceInterval = setInterval(updatePresence, 30000);

    const activeUsersQuery = query(
      collection(db, 'online_users'),
      where('last_seen', '>', new Date(Date.now() - 60000))
    );
    const unsubscribePresence = onSnapshot(activeUsersQuery, (snapshot) => {
      setPresenceCount(Math.max(1, snapshot.size));
    });

    const handleGlobalClick = (e: MouseEvent) => {
      setActiveMenuId(null);
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    window.addEventListener('click', handleGlobalClick);

    return () => {
      unsubscribeShoutouts();
      unsubscribeUsers();
      unsubscribeReports();
      unsubscribePresence();
      clearInterval(presenceInterval);
      window.removeEventListener('click', handleGlobalClick);
    };
  }, [user]);

  const myName = profile?.anonymous_username ?? 'Ghost_System';

  const filteredUsernames = useMemo(() => {
    const search = toAlias.toLowerCase().replace(/^@+/, '');
    if (!showDropdown && !search) return [];
    return usernameList
      .filter(name => name !== myName && name.toLowerCase().includes(search))
      .slice(0, 10);
  }, [usernameList, toAlias, myName, showDropdown]);

  const visibleShoutouts = useMemo(() => {
    const filtered = shoutouts.filter((item) => {
      // Auto-hide content with high report counts (5+)
      if (reportCounts[item.id] >= 5) return false;

      // Exclude comments from all main tabs
      if (item.parent_id) return false;

      if (tab === 'for_me') return item.to_alias === myName;
      if (tab === 'from_me') return item.from_alias === myName;
      return true;
    });

    return [...filtered].sort((left, right) => {
      if (sortMode === 'hype') {
        const leftScore = Object.values(reactions[left.id] ?? {}).reduce((sum, userIds) => sum + userIds.length, 0);
        const rightScore = Object.values(reactions[right.id] ?? {}).reduce((sum, userIds) => sum + userIds.length, 0);
        if (leftScore !== rightScore) return rightScore - leftScore;
      }

      const leftTime = left.created_at?.toDate ? left.created_at.toDate().getTime() : new Date(left.created_at || 0).getTime();
      const rightTime = right.created_at?.toDate ? right.created_at.toDate().getTime() : new Date(right.created_at || 0).getTime();
      return rightTime - leftTime;
    });
  }, [myName, reactions, shoutouts, sortMode, tab, reportCounts]);

  const receivedCount = shoutouts.filter((item) => !item.parent_id && item.to_alias === myName).length;
  const sentCount = shoutouts.filter((item) => !item.parent_id && item.from_alias === myName).length;

  const getTimestamp = (item: Shoutout) => item.created_at?.toDate ? item.created_at.toDate().getTime() : new Date(item.created_at || 0).getTime();
  const recentBurst = shoutouts.filter((item) => !item.parent_id && Date.now() - getTimestamp(item) < 1000 * 60 * 60).length;

  const liveMembers = presenceCount;

  const topSender = topAlias(shoutouts.filter(s => !s.parent_id).map((item) => item.from_alias));
  const topTarget = topAlias(shoutouts.filter(s => !s.parent_id).map((item) => item.to_alias));
  const totalReactionCount = Object.values(reactions).reduce(
    (sum, shoutoutReactionMap) => sum + Object.values(shoutoutReactionMap).reduce((inner, ids) => inner + ids.length, 0),
    0,
  );
  const otherPeopleCount = Math.max(shoutouts.filter(s => !s.parent_id).length - receivedCount, 0);
  const isMostlyForMe = receivedCount > 0 && receivedCount >= otherPeopleCount;

  const rotatingInsightIndex = pulseTick % 3;
  const insightTitle =
    rotatingInsightIndex === 0
      ? topTarget.winner
        ? `@${topTarget.winner} is pulling the most attention`
        : 'The room is waiting for the first real target'
      : rotatingInsightIndex === 1
        ? topSender.winner
          ? `@${topSender.winner} is the loudest voice right now`
          : 'No sender streak has formed yet'
        : totalReactionCount > 0
          ? 'Reactions are waking the room up'
          : 'The feed is still in soft-launch mode';

  const insightBody =
    rotatingInsightIndex === 0
      ? topTarget.winner
        ? `${topTarget.score} shoutout${topTarget.score === 1 ? '' : 's'} are currently landing on that name.`
        : 'Once a few posts land, this card will start tracking the hottest mention.'
      : rotatingInsightIndex === 1
        ? topSender.winner
          ? `${topSender.score} post${topSender.score === 1 ? '' : 's'} came from that member in this session.`
          : 'Fresh senders will bubble up here as soon as the feed starts moving.'
        : totalReactionCount > 0
          ? `${totalReactionCount} live reaction${totalReactionCount === 1 ? '' : 's'} have been tapped across the feed.`
          : 'Ask for a clap, laugh, or heart and the hype meter will start climbing.';

  const trendingShoutouts = useMemo(() => {
    return [...shoutouts]
      .filter(s => !s.parent_id) // Only top-level posts can trend
      .map(s => {
        const reactionCount = Object.values(reactions[s.id] ?? {}).reduce((sum, userIds) => sum + userIds.length, 0);
        const commentCount = shoutouts.filter(child => child.parent_id === s.id).length;
        return {
          ...s,
          reactionCount,
          commentCount,
          engagementScore: reactionCount + commentCount
        };
      })
      .sort((a, b) => b.engagementScore - a.engagementScore || getTimestamp(b) - getTimestamp(a))
      .slice(0, 3);
  }, [shoutouts, reactions]);

  const trendingCards = useMemo(() => {
    if (trendingShoutouts.length === 0) {
      return [
        {
          id: 'question',
          label: 'Trending Question',
          title: 'Question pulse',
          body: QUESTION_PROMPTS[pulseTick % QUESTION_PROMPTS.length],
          meta: 'Updates every few seconds',
          border: 'border-cyan-400/55',
          accent: 'from-cyan-400/30 via-sky-400/8 to-transparent',
          titleClass: 'text-cyan-200',
        },
        {
          id: 'signal',
          label: 'Who Likes Me?',
          title: isMostlyForMe ? 'This wave feels personal' : 'Most of the chaos is for other people',
          body: isMostlyForMe
            ? `${receivedCount} shoutout${receivedCount === 1 ? '' : 's'} are pointed at @${myName} right now.`
            : `${otherPeopleCount} shoutout${otherPeopleCount === 1 ? '' : 's'} are circling the rest of the room while ${receivedCount} found you.`,
          meta: isMostlyForMe ? 'You are in the spotlight' : 'Global room energy is stronger',
          border: 'border-violet-400/55',
          accent: 'from-violet-400/30 via-fuchsia-400/10 to-transparent',
          titleClass: 'text-violet-200',
        },
        {
          id: 'insight',
          label: 'Space Output',
          title: insightTitle,
          body: insightBody,
          meta: recentBurst > 0 ? `${recentBurst} post${recentBurst === 1 ? '' : 's'} in the last hour` : 'Waiting on the next spark',
          border: 'border-pink-500/55',
          accent: 'from-pink-500/28 via-rose-400/8 to-transparent',
          titleClass: 'text-pink-200',
        },
      ];
    }

    return trendingShoutouts.map((s, idx) => {
      const styles = [
        { border: 'border-cyan-400/55', accent: 'from-cyan-400/30 via-sky-400/8 to-transparent', titleClass: 'text-cyan-200' },
        { border: 'border-violet-400/55', accent: 'from-violet-400/30 via-fuchsia-400/10 to-transparent', titleClass: 'text-violet-200' },
        { border: 'border-pink-500/55', accent: 'from-pink-500/28 via-rose-400/8 to-transparent', titleClass: 'text-pink-200' }
      ];
      const style = styles[idx % styles.length];

      return {
        id: s.id,
        label: `Hottest Trend #${idx + 1}`,
        title: `From @${s.from_alias} to @${s.to_alias}`,
        body: s.message,
        meta: `${s.reactionCount} reaction${s.reactionCount === 1 ? '' : 's'} · ${s.commentCount} comment${s.commentCount === 1 ? '' : 's'}`,
        ...style
      };
    });
  }, [trendingShoutouts, pulseTick, isMostlyForMe, receivedCount, myName, otherPeopleCount, insightTitle, insightBody, recentBurst]);

  const toggleComments = (shoutoutId: string) => {
    setActiveCommentId(prev => prev === shoutoutId ? null : shoutoutId);
  };

  const clearReply = () => {
    setActiveReplyId(null);
    setReplyMessage('');
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Message copied to clipboard');
    setActiveMenuId(null);
  };

  const toggleReaction = async (shoutoutId: string, emoji: string) => {
    if (!user) return;

    const shoutout = shoutouts.find(s => s.id === shoutoutId);
    if (!shoutout) return;

    const currentReactions = { ...(reactions[shoutoutId] || {}) };
    const who = new Set(currentReactions[emoji] ?? []);

    if (who.has(user.uid)) {
      who.delete(user.uid);
    } else {
      who.add(user.uid);
    }

    if (who.size === 0) {
      delete currentReactions[emoji];
    } else {
      currentReactions[emoji] = Array.from(who);
    }

    // Update in Firestore
    try {
      await updateDoc(doc(db, 'shoutouts', shoutoutId), {
        reactions: currentReactions
      });
    } catch (err) {
      console.error('Reaction update error:', err);
      toast.error('Failed to update reaction');
    }
  };

  const post = async (parentId?: string, inlineContent?: string) => {
    const target = parentId ? '' : toAlias.trim().replace(/^@+/, '');
    const content = inlineContent ? inlineContent.trim() : message.trim();

    if ((!parentId && !target) || !content || !user || posting || isDisabled) return;

    // Safety Check: Content Filtering
    const filterResult = containsInappropriateContent(content);
    if (filterResult.matches) {
      toast.error(`Message contains inappropriate language: "${filterResult.word}". Please keep it clean.`);
      return;
    }

    setPosting(true);
    const parent = parentId ? shoutouts.find(s => s.id === parentId) : null;

    try {
      await addDoc(collection(db, 'shoutouts'), {
        to_alias: parent ? parent.from_alias : target,
        message: content,
        from_alias: profile?.anonymous_username ?? 'Someone',
        user_id: user.uid,
        parent_id: parentId || null,
        reactions: {},
        created_at: serverTimestamp()
      });

      toast.success(parentId ? 'Comment added!' : 'Shoutout broadcasted!');
      if (!parentId) {
        setMessage('');
        setToAlias('');
      } else {
        setReplyMessage('');
        if (activeCommentId !== parentId) {
          setActiveCommentId(parentId);
        }
      }
    } catch (err) {
      console.error('Post shoutout error:', err);
      toast.error('Failed to send. Check database connection.');
    }

    setPosting(false);
  };

  const deleteShoutout = async (shoutoutId: string) => {
    if (!window.confirm('Delete this shoutout?')) return;

    try {
      await deleteDoc(doc(db, 'shoutouts', shoutoutId));
      toast.success('Shoutout deleted');
    } catch (err) {
      console.error('Delete shoutout error:', err);
      toast.error('Failed to delete shoutout');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#06070d]">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#04050a] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(111,55,255,0.17),transparent_24%),radial-gradient(circle_at_82%_70%,rgba(0,245,212,0.1),transparent_22%),linear-gradient(180deg,#06060b_0%,#03040a_48%,#010308_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(circle_at_center,black_35%,transparent_90%)]" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {STARFIELD.map((star) => (
          <motion.span
            key={star.id}
            className="absolute rounded-full bg-violet-300/80"
            style={{ left: star.left, top: star.top, width: star.size, height: star.size }}
            animate={{ opacity: [0.2, 0.9, 0.25], scale: [1, 1.4, 1] }}
            transition={{ duration: star.duration, repeat: Infinity, delay: star.delay, ease: 'easeInOut' }}
          />
        ))}
      </div>

      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/30 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="rounded-full border border-white/10 p-2.5 text-white/60 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="bg-gradient-to-r from-violet-400 via-fuchsia-300 to-cyan-300 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
                SHOUTOUTS
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-[0.42em] text-white/45">
                Visible names, live pulse, clean chaos
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-3 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 sm:flex">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300" />
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-200">
              {liveMembers} members in space
            </span>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-6xl flex-col gap-8 px-5 py-8 sm:px-8 lg:py-10">
        {config.disableShoutouts && <FeatureDisabledBanner featureName="Shoutouts" />}
        <section className="relative">
          <div className="grid grid-cols-3 gap-2 md:gap-4 lg:gap-6">
            {[
              {
                id: 'live',
                icon: Users,
                label: 'Live Now',
                mobileLabel: 'Live',
                value: `${liveMembers}`,
                note: 'Members currently vibing in this space',
                mobileNote: 'Live now',
                accent: 'from-emerald-500/20 via-cyan-400/5 to-transparent',
                iconClass: 'text-emerald-300',
              },
              {
                id: 'for-you',
                icon: AtSign,
                label: 'For You',
                mobileLabel: 'For You',
                value: `${receivedCount}`,
                note: receivedCount > 0 ? 'Posts aimed at your username' : 'No one has tagged you yet',
                mobileNote: 'Tagged',
                accent: 'from-violet-500/20 via-fuchsia-400/5 to-transparent',
                iconClass: 'text-violet-300',
              },
              {
                id: 'rush',
                icon: Zap,
                label: 'Fresh Rush',
                mobileLabel: 'Fresh',
                value: `${recentBurst}`,
                note: recentBurst > 0 ? 'Posts dropped in the last hour' : 'Quiet hour, clean slate',
                mobileNote: 'Last hour',
                accent: 'from-pink-500/20 via-rose-400/5 to-transparent',
                iconClass: 'text-pink-300',
              },
            ].map((card) => {
              const Icon = card.icon;

              return (
                <motion.article
                  key={card.id}
                  className="relative overflow-hidden rounded-[1.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.02))] p-3 shadow-lg backdrop-blur-xl md:rounded-[1.6rem] md:p-5"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${card.accent}`} />
                  <div className="relative flex flex-col items-center text-center gap-1 md:flex-row md:items-start md:justify-between md:text-left md:gap-4">
                    <div className="order-2 md:order-1">
                      <p className="font-mono text-[8px] uppercase tracking-wider text-white/38 md:hidden">{card.mobileLabel}</p>
                      <p className="hidden font-mono text-[11px] uppercase tracking-[0.26em] text-white/38 md:block">{card.label}</p>
                      <p className="mt-0.5 text-xl font-extrabold text-white md:mt-3 md:text-3xl">{card.value}</p>
                      <p className="mt-1 text-xs text-white/55 md:hidden">{card.mobileNote}</p>
                      <p className="hidden mt-2 text-sm text-white/55 md:block">{card.note}</p>
                    </div>
                    <div className={`order-1 mb-1 rounded-lg border border-white/10 bg-white/5 p-2 md:order-2 md:mb-0 md:rounded-2xl md:p-3 ${card.iconClass}`}>
                      <Icon className="h-3.5 w-3.5 md:h-5 md:w-5" />
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </section>

        <motion.section
          id="composer"
          className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-[linear-gradient(135deg,rgba(124,58,237,0.12),rgba(255,255,255,0.02)_34%,rgba(255,255,255,0.02)_68%,rgba(0,245,212,0.07))] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl sm:rounded-[2rem] sm:p-8"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-violet-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 right-20 h-32 w-32 rounded-full bg-cyan-500/10 blur-3xl" />

          <div className="relative">
            <div className="mb-6 flex flex-col gap-4 md:mb-7 md:flex-row md:items-start md:justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-violet-500/20 p-2.5 text-violet-300 md:p-3">
                  <Megaphone className="h-5 w-5 md:h-6 md:w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">Cast a Shoutout</h2>
                  <p className="mt-1 text-xs text-white/50 md:text-sm">Posts now show who sent them, so love notes feel a little more real.</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/60">
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">Posting As</p>
                <p className="mt-1 text-base font-semibold text-cyan-300">@{myName}</p>
              </div>
            </div>

            {/* Removed global reply context UI - replies are now inline */}

            <div className="space-y-4">
              <div className="relative space-y-2" ref={dropdownRef}>
                <label className="ml-1 block font-mono text-[10px] uppercase tracking-[0.32em] text-white/40">
                  Send To (Username)
                </label>
                <div className="relative">
                  <AtSign className={`absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors ${toAlias ? 'text-cyan-400' : 'text-white/20'}`} />
                  <input
                    type="text"
                    autoComplete="off"
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] py-4 pl-12 pr-5 text-base text-cyan-200 outline-none transition focus:border-violet-400/50 focus:bg-violet-500/[0.07] focus:ring-2 focus:ring-violet-500/20"
                    placeholder="who_is_this_for?"
                    value={toAlias}
                    onFocus={() => setShowDropdown(true)}
                    onChange={(event) => {
                      setToAlias(event.target.value);
                      setShowDropdown(true);
                    }}
                    maxLength={30}
                  />
                </div>

                <AnimatePresence>
                  {showDropdown && filteredUsernames.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      className="absolute left-0 right-0 top-full z-50 mt-2 max-h-60 overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0e14]/95 p-2 shadow-2xl backdrop-blur-3xl custom-scrollbar-voice"
                    >
                      {filteredUsernames.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => {
                            setToAlias(name);
                            setShowDropdown(false);
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition hover:bg-white/5 group"
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/10 text-[10px] font-bold text-violet-300 border border-violet-500/20 group-hover:bg-violet-500/20">
                            {name.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-white/80 group-hover:text-cyan-300">@{name}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="space-y-2">
                <label className="ml-1 block font-mono text-[10px] uppercase tracking-[0.32em] text-white/40">
                  The Message
                </label>
                <textarea
                  ref={messageRef}
                  className="min-h-[148px] w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-base text-white outline-none transition focus:border-violet-400/50 focus:bg-violet-500/[0.07] focus:ring-2 focus:ring-violet-500/20"
                  placeholder="Say something sweet, chaotic, or impossible to ignore..."
                  rows={5}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={300}
                />
                <div className="flex items-center justify-between px-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">Max: 300 chars</span>
                  <span className="font-mono text-[11px] text-violet-300">{message.length} / 300</span>
                </div>
              </div>

              <div className="flex flex-col gap-4 border-t border-white/8 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-white/45">
                  Visibility:
                  <span className="ml-2 rounded-md bg-emerald-400/15 px-2 py-1 font-mono text-xs text-emerald-300">
                    username shown on post
                  </span>
                </div>

                <button
                  onClick={() => post()}
                  disabled={!toAlias.trim() || !message.trim() || posting || isDisabled}
                  className="group inline-flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-8 py-4 text-sm font-extrabold tracking-wide text-white shadow-[0_0_25px_rgba(168,85,247,0.45)] transition hover:scale-[1.01] hover:shadow-[0_0_35px_rgba(34,211,238,0.25)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 sm:min-w-[196px]"
                >
                  <span>{posting ? 'BROADCASTING...' : (isDisabled ? 'RESTRICTED' : safeMode ? 'SAFE MODE ACTIVE' : 'BROADCAST')}</span>
                  {(safeMode || isDisabled) ? <ShieldAlert className="h-4 w-4" /> : <Send className="h-4 w-4 transition group-hover:translate-x-0.5" />}
                </button>
              </div>
            </div>
          </div>
        </motion.section>

        <section>
          <div className="mb-4 flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-pink-500 shadow-[0_0_18px_rgba(236,72,153,0.75)]" />
            <h3 className="text-sm font-extrabold uppercase tracking-[0.28em] text-pink-400">Trending Now</h3>
          </div>

          <div className="grid grid-cols-3 gap-2 md:gap-4 lg:gap-6">
            {trendingCards.map((card, idx) => (
              <motion.article
                key={card.id || idx}
                className={`group relative overflow-hidden rounded-[1.2rem] border ${card.border} bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-3 shadow-lg md:rounded-[1.6rem] md:p-5`}
                whileHover={{ y: -4 }}
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${card.accent} opacity-40 transition group-hover:opacity-60`} />
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`${card.id}-${pulseTick}-${card.body}`}
                    className="relative space-y-1 md:space-y-3"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.28 }}
                  >
                    <p className="font-mono text-[8px] uppercase tracking-wider text-white/42 md:hidden">{card.label.split(' ')[0]}</p>
                    <p className="hidden font-mono text-[11px] uppercase tracking-[0.26em] text-white/42 md:block">{card.label}</p>
                    
                    <h4 className={`text-[10px] font-bold leading-tight line-clamp-2 md:text-lg md:line-clamp-none ${card.titleClass}`}>{card.title}</h4>
                    
                    <p className="hidden text-[1.02rem] leading-7 text-white/88 md:block">{card.body}</p>
                    
                    <div className="flex items-center gap-1 text-[7px] text-white/42 md:text-xs md:gap-2">
                      <Sparkles className="h-2 w-2 md:h-3.5 md:w-3.5" />
                      <span className="truncate">{card.meta}</span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </motion.article>
            ))}
          </div>
        </section>

        <section className="flex flex-row items-center gap-3 overflow-x-auto whitespace-nowrap pb-2 md:flex-wrap md:overflow-visible md:pb-0 scrollbar-hide [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[
            { id: 'all' as const, label: 'Global', extra: shoutouts.filter(s => !s.parent_id).length },
            { id: 'for_me' as const, label: 'For You', extra: receivedCount },
            { id: 'from_me' as const, label: 'From Me', extra: sentCount },
          ].map((item) => {
            const active = item.id === tab;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={[
                  'inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold transition',
                  active
                    ? 'border-violet-400/70 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-[0_0_24px_rgba(168,85,247,0.4)]'
                    : 'border-white/10 bg-white/[0.03] text-white/65 hover:border-white/20 hover:bg-white/[0.05] hover:text-white',
                ].join(' ')}
              >
                <span>{item.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-white/15 text-white' : 'bg-white/8 text-white/60'}`}>
                  {item.extra}
                </span>
              </button>
            );
          })}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {[
              { id: 'recent' as const, label: 'Recent', icon: Sparkles },
              { id: 'hype' as const, label: 'Most Reacted', icon: TrendingUp },
            ].map((option) => {
              const Icon = option.icon;
              const active = option.id === sortMode;

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSortMode(option.id)}
                  className={[
                    'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] transition',
                    active
                      ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200'
                      : 'border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white/75',
                  ].join(' ')}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-12">
          <AnimatePresence mode="popLayout">
            {visibleShoutouts
              .filter(s => !s.parent_id) // Only top-level in core loop
              .map((shoutout, index) => {
                const isForMe = shoutout.to_alias === myName;
                const isMine = shoutout.from_alias === myName;
                const shoutoutReactions = reactions[shoutout.id] ?? {};
                const reactionCount = Object.values(shoutoutReactions).reduce((sum, ids) => sum + ids.length, 0);
                const children = shoutouts.filter(s => s.parent_id === shoutout.id);

                return (
                  <div key={shoutout.id} className="space-y-4">
                    <motion.article
                      className={`group relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015)_42%,rgba(4,120,87,0.14))] p-6 shadow-[0_20px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl ${isMine ? 'border-violet-500/20' : ''}`}
                      initial={{ opacity: 0, y: 18 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ delay: index * 0.04 }}
                    >
                      <div className="relative">
                        <div className="flex items-start justify-between gap-3 sm:gap-4">
                          <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                            <div className={`flex h-10 w-10 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-xl sm:rounded-2xl border ${isForMe ? 'border-cyan-400/35 bg-gradient-to-br from-cyan-500/15 to-blue-500/10 text-cyan-300' : 'border-violet-400/35 bg-gradient-to-br from-violet-500/15 to-pink-500/10 text-violet-300'}`}>
                              <MessageCircle className="h-4 w-4 sm:h-6 sm:w-6" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-white/48">From @{shoutout.from_alias}</span>
                                <span className="text-sm text-white/25">to</span>
                                <span className="text-xl sm:text-2xl font-extrabold tracking-tight text-white mb-0.5 sm:mb-0 line-clamp-1 break-all">@{shoutout.to_alias}</span>
                                {isForMe && <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200 shrink-0">For You</span>}
                                {isMine && <span className="rounded-full border border-violet-400/30 bg-violet-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-violet-200 shrink-0">You Posted</span>}
                              </div>
                              <p className="mt-3 sm:mt-4 max-w-3xl text-[1.05rem] leading-7 text-white/92 sm:text-[1.28rem] sm:leading-8 break-words" dangerouslySetInnerHTML={{ __html: sanitizeContent(shoutout.message) }}></p>
                              <div className="mt-3 sm:mt-4 flex flex-row items-center gap-2 sm:gap-3 text-xs text-white/35 w-full overflow-hidden">
                                <span className="font-mono uppercase tracking-[0.24em] text-[9px] sm:text-[10px] shrink-0">{timeAgo(shoutout.created_at)}</span>
                                <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 sm:px-2.5 py-0.5 sm:py-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-[0.18em] text-white/45 shrink-0 whitespace-nowrap">{reactionCount} {reactionCount === 1 ? 'reaction' : 'reactions'}</span>
                              </div>
                            </div>
                          </div>
                          <div className="relative flex items-center gap-1 sm:gap-2 shrink-0">
                            {(profile?.is_admin || isMine) && (
                              <button 
                                onClick={() => deleteShoutout(shoutout.id)} 
                                className="rounded-full p-2 text-white/20 transition hover:bg-red-500/10 hover:text-red-400"
                                title="Delete Post"
                              >
                                <Trash2 className="h-4 w-4 sm:h-5 sm:w-5" />
                              </button>
                            )}
                            {(!isMine || profile?.is_admin) && (
                              <button 
                                onClick={() => setReportingContent({ type: 'shoutout', id: shoutout.id })}
                                className="rounded-full p-2 text-white/20 transition hover:bg-amber-500/10 hover:text-amber-400"
                                title="Report Post"
                              >
                                <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-3 border-t border-white/8 pt-4 sm:pt-5">
                          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar w-full sm:w-auto pb-1 sm:pb-0 snap-x">
                            {REACTIONS.map((reaction) => {
                              const who = shoutoutReactions[reaction.emoji] ?? [];
                              const count = who.length;
                              const hasReacted = Boolean(user && who.includes(user.uid));
                              return (
                                <button key={reaction.emoji} type="button" onClick={() => toggleReaction(shoutout.id, reaction.emoji)} className={['inline-flex items-center gap-1.5 sm:gap-2 shrink-0 snap-center rounded-full border px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm transition', hasReacted ? 'border-violet-400/40 bg-violet-500/12 text-white' : `border-transparent bg-transparent text-white/65 ${reaction.border}`].join(' ')}>
                                  <span className="text-sm sm:text-base">{reaction.emoji}</span>
                                  <span className={`inline-flex items-center gap-1 font-mono text-[10px] sm:text-xs ${hasReacted ? 'text-white' : reaction.accent}`}>{count}</span>
                                </button>
                              );
                            })}
                          </div>

                          <div className="flex items-center shrink-0 w-full sm:w-auto sm:ml-auto">
                            <button
                              type="button"
                              onClick={() => toggleComments(shoutout.id)}
                              className={`flex w-full sm:w-auto items-center justify-center gap-2 rounded-full border px-4 py-2 sm:py-2.5 text-[11px] sm:text-xs font-bold transition ${activeCommentId === shoutout.id ? 'border-violet-500/40 bg-violet-500/10 text-violet-300' : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-white/20'}`}
                            >
                              <MessageCircle className="h-4 w-4" />
                              {children.length > 0 ? (
                                <span>{children.length} {children.length === 1 ? 'COMMENT' : 'COMMENTS'}</span>
                              ) : (
                                <span>ADD COMMENT</span>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.article>

                  </div>
                );
              })}
          </AnimatePresence>

          <AnimatePresence>
            {activeCommentId && (() => {
              const activeShoutout = shoutouts.find(s => s.id === activeCommentId);
              if (!activeShoutout) return null;
              const children = shoutouts.filter(s => s.parent_id === activeCommentId).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
              
              return (
                <>
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setActiveCommentId(null)}
                    className="fixed inset-0 z-[60] bg-black/60"
                  />
                  <motion.div 
                    initial={{ x: '100%', opacity: 0.5 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: '100%', opacity: 0.5 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                    className="fixed right-0 top-0 bottom-0 z-[70] w-full max-w-md border-l border-white/10 bg-[#0a0a0c]/95 p-0 shadow-2xl backdrop-blur-3xl sm:max-w-lg"
                  >
                    <div className="flex flex-col h-full">
                      <div className="flex items-center justify-between border-b border-white/8 p-6">
                        <div>
                          <h3 className="text-lg font-bold tracking-tight text-white">Shoutout Context</h3>
                          <p className="text-xs text-white/40 font-mono italic">@{activeShoutout.from_alias} to @{activeShoutout.to_alias}</p>
                        </div>
                        <button onClick={() => setActiveCommentId(null)} className="rounded-full bg-white/5 p-2 text-white/40 transition hover:bg-white/10 hover:text-white">
                          <X className="h-5 w-5" />
                        </button>
                      </div>

                      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                        <div className="mb-8 rounded-2xl bg-white/[0.03] p-5 border border-white/5">
                           <p className="text-white/85 leading-relaxed italic" dangerouslySetInnerHTML={{ __html: sanitizeContent(activeShoutout.message) }}></p>
                        </div>

                        <div className="mb-8 space-y-4">
                          <h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-cyan-400">
                             <MessageCircle className="h-3 w-3" />
                             Conversation ({children.length})
                          </h4>
                          
                          <div className="space-y-4">
                            <div className="rounded-2xl bg-violet-500/5 border border-violet-500/10 p-4">
                              <textarea
                                autoFocus
                                placeholder="Add your voice to the thread..."
                                className="w-full bg-transparent text-sm text-white placeholder-white/20 outline-none resize-none"
                                rows={3}
                                value={replyMessage}
                                onChange={(e) => setReplyMessage(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    post(activeShoutout.id, replyMessage);
                                  }
                                }}
                              />
                              <div className="mt-2 flex justify-end">
                                <button 
                                  onClick={() => post(activeShoutout.id, replyMessage)} 
                                  disabled={!replyMessage.trim() || posting}
                                  className="rounded-full bg-cyan-500 px-6 py-2 text-[11px] font-black uppercase tracking-widest text-white transition hover:bg-cyan-400 disabled:opacity-30"
                                >
                                  {posting ? 'SENDING...' : 'POST COMMENT'}
                                </button>
                              </div>
                            </div>

                            <AnimatePresence initial={false}>
                              {children.map(child => (
                                <motion.div 
                                  key={child.id}
                                  initial={{ opacity: 0, x: 20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  className="relative rounded-2xl border border-white/5 bg-white/[0.02] p-4"
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">@{child.from_alias}</span>
                                      <span className="text-[10px] text-white/20 font-mono">{timeAgo(child.created_at)}</span>
                                    </div>
                                     <div className="flex items-center gap-2">
                                      {profile?.is_admin && (
                                        <button onClick={() => deleteShoutout(child.id)} className="text-white/10 hover:text-red-400/60 transition"><Trash2 className="h-3 w-3" /></button>
                                      )}
                                      <button 
                                        onClick={() => setReportingContent({ type: 'shoutout_comment', id: child.id })}
                                        className="text-white/10 hover:text-amber-400/60 transition"
                                      >
                                        <AlertTriangle className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>
                                  <p className="text-sm text-white/80 leading-relaxed font-light">{child.message}</p>
                                </motion.div>
                              ))}
                            </AnimatePresence>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </>
              );
            })()}
          </AnimatePresence>


          {visibleShoutouts.length === 0 && (
            <div className="rounded-[2rem] border border-dashed border-white/10 bg-white/[0.02] px-6 py-20 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-violet-400/30 bg-violet-500/10 text-violet-300">
                <Megaphone className="h-7 w-7" />
              </div>
              <p className="text-xl font-semibold text-white">
                {tab === 'for_me'
                  ? 'No shoutouts have landed on your username yet'
                  : tab === 'from_me'
                    ? 'You have not posted into this space yet'
                    : 'No shoutouts are drifting through the grid yet'}
              </p>
              <p className="mt-2 text-sm text-white/45">Once messages start dropping, this feed will light up automatically.</p>
            </div>
          )}
        </section>
      </main>

      <button
        type="button"
        onClick={() => document.getElementById('composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-[0_0_28px_rgba(168,85,247,0.45)] transition hover:scale-105 md:hidden"
      >
        <Megaphone className="h-6 w-6" />
      </button>

      <ReportModal 
        isOpen={!!reportingContent}
        onClose={() => setReportingContent(null)}
        targetType={reportingContent?.type || 'shoutout'}
        targetId={reportingContent?.id || ''}
      />
    </div>
  );
}
