import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Bookmark,
  Compass,
  Flame,
  Lightbulb,
  AlertTriangle,
  MessageCircle,
  Search,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  getDoc,
  getDocs,
  deleteDoc,
  serverTimestamp,
  increment,
  limit
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';
import { containsInappropriateContent } from '../lib/filter';
import ReportModal from '../components/ReportModal';
import { useSystemConfig } from '../hooks/useSystemConfig';
import { ShieldAlert } from 'lucide-react';
import FeatureDisabledBanner from '../components/FeatureDisabledBanner';
import { sanitizeContent } from '../lib/sanitize';

interface Confession {
  id: string;
  content: string;
  likes: number;
  created_at: any; // Handle string or Timestamp
  user_id: string;
  category: string;
}

interface Comment {
  id: string;
  confession_id: string;
  content: string;
  created_at: string;
  user_id: string;
  anonymous_username: string;
}

interface CategoryMeta {
  key: string;
  label: string;
  icon: string;
  accent: string;
  aura: string;
  description: string;
}

const CATEGORIES: CategoryMeta[] = [
  {
    key: 'all',
    label: 'All',
    icon: 'O',
    accent: '#f97316',
    aura: 'from-orange-500/20 via-rose-500/10 to-transparent',
    description: 'Everything the void is holding right now.',
  },
  {
    key: 'crush',
    label: 'Crush',
    icon: 'H',
    accent: '#fb7185',
    aura: 'from-rose-500/20 via-pink-500/10 to-transparent',
    description: 'Dangerous eye contact and unspoken chaos.',
  },
  {
    key: 'academic',
    label: 'Academic',
    icon: 'A',
    accent: '#38bdf8',
    aura: 'from-sky-500/20 via-cyan-500/10 to-transparent',
    description: 'Deadlines, grades, panic, redemption.',
  },
  {
    key: 'funny',
    label: 'Funny',
    icon: 'F',
    accent: '#facc15',
    aura: 'from-yellow-400/20 via-amber-500/10 to-transparent',
    description: 'Glorious nonsense worth screenshotting.',
  },
  {
    key: 'random',
    label: 'Random',
    icon: 'R',
    accent: '#a855f7',
    aura: 'from-violet-500/20 via-fuchsia-500/10 to-transparent',
    description: 'Pure noise, secret lore, and side quests.',
  },
];

const LOCAL_STORAGE_KEYS = {
  bookmarks: 'voidchat-confession-bookmarks',
  dismissed: 'voidchat-confession-dismissed',
  draft: 'voidchat-confession-draft',
};

const COLORS = ['#f97316', '#ec4899', '#38bdf8', '#a855f7', '#22c55e', '#f59e0b'];

const readStoredIds = (key: string) => {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return new Set<string>(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
};

const writeStoredIds = (key: string, value: Set<string>) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(Array.from(value)));
};

const getDraft = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(LOCAL_STORAGE_KEYS.draft) ?? '';
};

const getColor = (seed: string) => COLORS[seed.charCodeAt(0) % COLORS.length];
const getInitials = (seed: string) => seed.slice(0, 2).toUpperCase();

const timeAgo = (date: any) => {
  if (!date) return 'just now';
  const d = date?.toDate ? date.toDate() : new Date(date);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (isNaN(diff)) return 'just now';
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const getCategoryMeta = (key: string) => CATEGORIES.find((item) => item.key === key) ?? CATEGORIES[CATEGORIES.length - 1];

const getHeatScore = (confession: Confession, commentCount: number) => {
  const createdDate = confession.created_at?.toDate ? confession.created_at.toDate() : new Date(confession.created_at);
  const ageInHours = Math.max((Date.now() - createdDate.getTime()) / 36e5, 1);
  if (isNaN(ageInHours)) return 0;
  return (confession.likes || 0) * 3 + (commentCount || 0) * 4 + 18 / ageInHours;
};

const calculateTrendScore = (confession: Confession, replies: number) => {
  const reactions = confession.likes || 0;
  const createdDate = confession.created_at?.toDate ? confession.created_at.toDate() : new Date(confession.created_at);
  const ageInMinutes = (Date.now() - createdDate.getTime()) / (1000 * 60);
  if (isNaN(ageInMinutes)) return 0;
  // Weight recent activity (higher for newer posts)
  const recencyWeight = Math.max(0, 100 - (ageInMinutes / 10));
  return reactions + (replies * 3) + recencyWeight;
};

const getVibeInfo = (confession: Confession, commentCount: number = 0) => {
  const vibes: Record<string, { label: string; emoji: string; color: string; level: number }> = {
    random: { label: 'Spicy', emoji: '🔥', color: 'from-orange-500 to-rose-500', level: 8 },
    crush: { label: 'Romantic', emoji: '❤️', color: 'from-rose-500 to-pink-500', level: 7 },
    funny: { label: 'Funny', emoji: '😂', color: 'from-yellow-400 to-amber-500', level: 9 },
    academic: { label: 'Awkward', emoji: '😳', color: 'from-sky-500 to-indigo-600', level: 5 },
    default: { label: 'Sad', emoji: '💔', color: 'from-indigo-600 to-slate-700', level: 4 }
  };
  
  const baseVibe = vibes[confession.category] || vibes.random;
  
  // Dynamic intensity logic: +5% (+0.5) per like, +10% (+1.0) per comment
  const interactionBonus = (confession.likes || 0) * 0.5 + (commentCount || 0) * 1.0;
  const dynamicLevel = Math.min(10, baseVibe.level + interactionBonus);
  
  return { ...baseVibe, level: dynamicLevel };
};

function CommentPanel({
  confession,
  user,
  profile,
  onClose,
  onReport,
}: {
  confession: Confession;
  user: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any;
  onClose: () => void;
  onReport: (type: 'confession' | 'user' | 'confession_comment', id: string) => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [nameCache] = useState<Map<string, string>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);
  const { config } = useSystemConfig();
  const isDisabled = config.disableConfessions && !profile?.is_admin;
  const safeMode = (config.safeMode || isDisabled) && !profile?.is_admin;
  const meta = getCategoryMeta(confession.category);

  useEffect(() => {
    const q = query(
      collection(db, 'confession_comments'),
      where('confession_id', '==', confession.id),
      orderBy('created_at', 'asc')
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const commentsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as any[];

      const userIds = [...new Set(commentsData.map(c => c.user_id))];
      
      for (const userId of userIds) {
        if (!nameCache.has(userId)) {
          const userDoc = await getDoc(doc(db, 'users', userId));
          if (userDoc.exists()) {
            nameCache.set(userId, userDoc.data().anonymous_username);
          } else {
            nameCache.set(userId, '???');
          }
        }
      }

      setComments(commentsData.map(c => ({
        ...c,
        anonymous_username: nameCache.get(c.user_id) || '???'
      })));
    });

    return () => unsubscribe();
  }, [confession.id, nameCache]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  const post = async () => {
    const content = text.trim();
    if (!content || !user || posting) return;

    // Safety Check: Content Filtering
    const filterResult = containsInappropriateContent(content);
    if (filterResult.matches) {
      toast.error(`Comment contains inappropriate language: "${filterResult.word}". Please keep it clean.`);
      return;
    }

    setPosting(true);
    const optimistic: Comment = {
      id: `OPT_${Date.now()}`,
      confession_id: confession.id,
      content,
      created_at: new Date().toISOString(),
      user_id: user.uid,
      anonymous_username: profile?.anonymous_username ?? '???',
    };

    setComments((current) => [...current, optimistic]);
    setText('');

    try {
      await addDoc(collection(db, 'confession_comments'), {
        confession_id: confession.id,
        user_id: user.uid,
        content,
        created_at: serverTimestamp(),
      });
    } catch (error) {
      console.error('Comment post error:', error);
      setComments((current) => current.filter((entry) => entry.id !== optimistic.id));
      toast.error('Failed to post comment');
    }

    setPosting(false);
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
      <motion.div
        className="confession-modal relative mx-4 flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[2rem] rounded-b-none border border-white/10 md:rounded-[2rem]"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      >
        <div className={`absolute inset-x-0 top-0 h-40 bg-gradient-to-br ${meta.aura} opacity-90`} />
        <div className="relative border-b border-white/10 px-5 py-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <span className="confession-tag" style={{ color: meta.accent, borderColor: `${meta.accent}40` }}>
                {meta.label} thread
              </span>
              <h3 className="mt-3 text-lg font-semibold text-white">Anonymous replies</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300 break-all overflow-hidden" dangerouslySetInnerHTML={{ __html: sanitizeContent(confession.content) }}></p>
            </div>
            <button
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
              aria-label="Close comments"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>{timeAgo(confession.created_at)}</span>
            <span>{confession.likes} likes</span>
            <span>{comments.length} replies</span>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {comments.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/4 px-6 py-12 text-center">
              <MessageCircle className="mx-auto mb-3 text-slate-500" size={28} />
              <p className="text-sm text-slate-300">Nobody has replied yet.</p>
              <p className="mt-1 text-xs text-slate-500">Start the thread and set the tone.</p>
            </div>
          ) : (
            comments.map((comment) => {
              const isMe = comment.user_id === user?.uid;
              const color = getColor(comment.anonymous_username);
              return (
                <div key={comment.id} className="flex gap-3">
                  <div
                    className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-xs font-bold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {getInitials(comment.anonymous_username)}
                  </div>
                  <div className="flex-1 rounded-[1.4rem] border border-white/8 bg-white/4 px-4 py-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-semibold" style={{ color }}>
                        {isMe ? `You (${comment.anonymous_username})` : comment.anonymous_username}
                      </span>
                      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        {timeAgo(comment.created_at)}
                      </span>
                    </div>
                    <p className="text-sm leading-6 text-slate-200 break-all overflow-hidden" dangerouslySetInnerHTML={{ __html: sanitizeContent(comment.content) }}></p>
                    <div className="mt-2 flex items-center gap-3">
                      {(!isMe || profile?.is_admin) && (
                        <button 
                          onClick={() => onReport('confession_comment', comment.id)}
                          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 hover:text-amber-400 transition"
                        >
                          <AlertTriangle size={10} />
                          Report
                        </button>
                      )}
                      {profile?.is_admin && (
                        <button 
                          onClick={async () => {
                            if (!window.confirm('Erase this anonymous reply?')) return;
                            try {
                              await deleteDoc(doc(db, 'confession_comments', comment.id));
                              toast.success('Reply erased.');
                            } catch (err) {
                              toast.error('Failed to delete.');
                            }
                          }}
                          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-red-500/70 hover:text-red-400 transition"
                        >
                          <Trash2 size={10} />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-white/10 bg-black/20 px-4 py-4">
          <div className="flex items-center gap-3 rounded-[1.5rem] border border-white/10 bg-white/5 p-2">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-xs font-bold text-white"
              style={{ backgroundColor: getColor(profile?.anonymous_username ?? 'me') }}
            >
              {getInitials(profile?.anonymous_username ?? 'me')}
            </div>
            <input
              className="input-field flex-1 border-0 bg-transparent px-2 py-2 text-sm shadow-none focus:bg-transparent focus:shadow-none"
              placeholder="Drop a reply..."
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && post()}
              maxLength={300}
              autoFocus
            />
            <motion.button
              onClick={post}
              disabled={!text.trim() || posting || safeMode}
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-pink-500 text-white transition disabled:cursor-not-allowed disabled:opacity-40"
              whileTap={{ scale: 0.92 }}
              aria-label="Send comment"
            >
              {safeMode ? <ShieldAlert size={16} /> : <Send size={16} />}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Confessions() {
  const { user, profile, loading } = useAuth();
  const { config } = useSystemConfig();
  const isDisabled = config.disableConfessions && !profile?.is_admin;
  const safeMode = (config.safeMode || isDisabled) && !profile?.is_admin;
  const navigate = useNavigate();

  const [confessions, setConfessions] = useState<Confession[]>([]);
  const [text, setText] = useState(getDraft);
  const [category, setCategory] = useState('random');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'new' | 'hot' | 'discussed'>('hot');
  const [filterCat, setFilterCat] = useState('all');
  const [commentTarget, setCommentTarget] = useState<Confession | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(() => readStoredIds(LOCAL_STORAGE_KEYS.bookmarks));
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => readStoredIds(LOCAL_STORAGE_KEYS.dismissed));
  const [onlyBookmarked, setOnlyBookmarked] = useState(false);
  const [search, setSearch] = useState('');
  const [reportingContent, setReportingContent] = useState<{ type: 'confession' | 'user' | 'confession_comment'; id: string } | null>(null);
  const [reportCounts, setReportCounts] = useState<Record<string, number>>({});
  const deferredSearch = useDeferredValue(search);
  const trendingPost = useMemo(() => {
    if (confessions.length === 0) return null;
    return [...confessions].sort((a, b) => 
      calculateTrendScore(b, commentCounts[b.id] || 0) - calculateTrendScore(a, commentCounts[a.id] || 0)
    )[0];
  }, [confessions, commentCounts]);

  useEffect(() => {
    if (!loading && !user) navigate('/join');
  }, [loading, navigate, user]);

  useEffect(() => {
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.draft, text);
  }, [text]);

  useEffect(() => {
    if (!user) return;

    // Load confessions
    const qConfessions = query(
      collection(db, 'confessions'),
      orderBy('created_at', 'desc'),
      limit(50)
    );

    const unsubscribeConfessions = onSnapshot(qConfessions, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Confession[];
      
      setConfessions(data);
      
      // Clean up orphaned bookmarks
      const validIds = new Set(data.map(c => c.id));
      setBookmarkedIds((current) => {
        const next = new Set<string>();
        current.forEach(id => {
          if (validIds.has(id)) next.add(id);
        });
        if (next.size !== current.size) {
          writeStoredIds(LOCAL_STORAGE_KEYS.bookmarks, next);
        }
        return next;
      });
    });

    // Load comment counts (approximate - real-time updates handled via snapshot)
    const qComments = query(collection(db, 'confession_comments'));
    const unsubscribeComments = onSnapshot(qComments, (snapshot) => {
      const counts: Record<string, number> = {};
      snapshot.docs.forEach((doc) => {
        const confessionId = doc.data().confession_id;
        if (confessionId) {
          counts[confessionId] = (counts[confessionId] || 0) + 1;
        }
      });
      setCommentCounts(counts);
    });

    // Load report counts
    const qReports = query(
      collection(db, 'reports'),
      where('target_type', '==', 'confession')
    );
    const unsubscribeReports = onSnapshot(qReports, (snapshot) => {
      const rCounts: Record<string, number> = {};
      snapshot.docs.forEach((doc) => {
        const targetId = doc.data().target_id;
        if (targetId) {
          rCounts[targetId] = (rCounts[targetId] || 0) + 1;
        }
      });
      setReportCounts(rCounts);
    });

    return () => {
      unsubscribeConfessions();
      unsubscribeComments();
      unsubscribeReports();
    };
  }, [user]);

  const post = async () => {
    const content = text.trim();
    if (!content || !user || posting) return;

    // Safety Check: Content Filtering
    const filterResult = containsInappropriateContent(content);
    if (filterResult.matches) {
      toast.error(`Confession contains inappropriate language: "${filterResult.word}". Please keep it clean.`);
      return;
    }

    setPosting(true);
    setPostError('');

    const optimisticId = `OPT_${Date.now()}`;
    const optimistic: Confession = {
      id: optimisticId,
      content,
      user_id: user.uid,
      category,
      likes: 0,
      created_at: new Date().toISOString(),
    };

    setConfessions((current) => [optimistic, ...current]);
    setText('');

    try {
      await addDoc(collection(db, 'confessions'), {
        content,
        user_id: user.uid,
        category,
        likes: 0,
        created_at: serverTimestamp(),
      });
      window.localStorage.removeItem(LOCAL_STORAGE_KEYS.draft);
    } catch (error: any) {
      console.error('Post error:', error);
      setPostError(`Failed: ${error.message}`);
      setConfessions((current) => current.filter((entry) => entry.id !== optimisticId));
      setText(content);
    }

    setPosting(false);
  };

  const like = async (confession: Confession) => {
    if (likedIds.has(confession.id)) return;

    setLikedIds((current) => new Set(current).add(confession.id));
    setConfessions((current) =>
      current.map((entry) => (entry.id === confession.id ? { ...entry, likes: entry.likes + 1 } : entry)),
    );

    try {
      await updateDoc(doc(db, 'confessions', confession.id), {
        likes: increment(1)
      });
    } catch (error) {
      console.error('Like error:', error);
    }
  };

  // Scroll to confession from hash
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash && confessions.length > 0) {
      setTimeout(() => {
        const element = document.getElementById(hash);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.classList.add('ring-2', 'ring-orange-500', 'ring-offset-8', 'ring-offset-[#09060d]');
          setTimeout(() => {
            element.classList.remove('ring-2', 'ring-orange-500', 'ring-offset-8', 'ring-offset-[#09060d]');
          }, 3000);
        }
      }, 500);
    }
  }, [confessions, window.location.hash]);

  const deleteOwn = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this confession? This action cannot be undone.')) return;
    setConfessions((current) => current.filter((entry) => entry.id !== id));
    try {
      await deleteDoc(doc(db, 'confessions', id));
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Failed to delete confession');
    }
  };

  const toggleBookmark = (id: string) => {
    setBookmarkedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeStoredIds(LOCAL_STORAGE_KEYS.bookmarks, next);
      return next;
    });
  };

  const dismissConfession = (id: string) => {
    setDismissedIds((current) => {
      const next = new Set(current).add(id);
      writeStoredIds(LOCAL_STORAGE_KEYS.dismissed, next);
      return next;
    });
  };

  const reviveDismissed = () => {
    const next = new Set<string>();
    setDismissedIds(next);
    writeStoredIds(LOCAL_STORAGE_KEYS.dismissed, next);
  };

  const filteredConfessions = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();

    return confessions
      .filter((entry) => filterCat === 'all' || entry.category === filterCat)
      .filter((entry) => (reportCounts[entry.id] || 0) < 5)
      .filter((entry) => !onlyBookmarked || bookmarkedIds.has(entry.id))
      .filter((entry) => !dismissedIds.has(entry.id))
      .filter((entry) => !term || entry.content.toLowerCase().includes(term))
      .sort((left, right) => {
        if (sortBy === 'new') {
          return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        }
        if (sortBy === 'discussed') {
          return (commentCounts[right.id] || 0) - (commentCounts[left.id] || 0);
        }
        return getHeatScore(right, commentCounts[right.id] || 0) - getHeatScore(left, commentCounts[left.id] || 0);
      });
  }, [bookmarkedIds, commentCounts, confessions, deferredSearch, dismissedIds, filterCat, onlyBookmarked, sortBy, reportCounts]);

  const spotlight = filteredConfessions[0] ?? confessions[0] ?? null;
  const latestDrop = confessions[0] ?? null;
  const totalComments = Object.values(commentCounts).reduce((sum, count) => sum + count, 0);
  const todayCount = confessions.filter((entry) => {
    const created = new Date(entry.created_at);
    const now = new Date();
    return created.toDateString() === now.toDateString();
  }).length;
  const activeCategories = CATEGORIES.slice(1)
    .map((meta) => ({
      ...meta,
      count: confessions.filter((entry) => entry.category === meta.key).length,
    }))
    .sort((left, right) => right.count - left.count);
  const trendingCategory = activeCategories[0];
  const composerMeta = getCategoryMeta(category);
  const spotlightMeta = spotlight ? getCategoryMeta(spotlight.category) : composerMeta;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="confession-space min-h-screen">
      <div className="confession-noise" />
      <div className="ambient-blob left-[-8rem] top-[5rem] h-[24rem] w-[24rem] bg-orange-600/10" />
      <div className="ambient-blob bottom-[-8rem] right-[-3rem] h-[28rem] w-[28rem] bg-pink-600/10" />

      <header className="sticky top-0 z-20 border-b border-white/8 bg-[#09060d]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
              aria-label="Back to dashboard"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-orange-300/80">Confession space</p>
              <h1 className="text-xl font-semibold text-white">Drop it and disappear</h1>
            </div>
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <div className="confession-pill">
              <Sparkles size={14} />
              {todayCount} dropped today
            </div>
            <div className="confession-pill">
              <MessageCircle size={14} />
              {totalComments} total replies
            </div>
            <div className="confession-pill">
              <Bookmark size={14} />
              {bookmarkedIds.size} saved
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {config.disableConfessions && <FeatureDisabledBanner featureName="Confessions" />}
          <motion.div
            className="confession-hero overflow-hidden rounded-[2rem] border border-white/10"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${spotlightMeta.aura}`} />
            <div className="relative grid gap-6 p-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="confession-tag" style={{ color: spotlightMeta.accent, borderColor: `${spotlightMeta.accent}55` }}>
                    Spotlight confession
                  </span>
                  {profile?.is_admin && <span className="text-[10px] font-black bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full border border-red-500/20">ADMIN</span>}
                  {trendingCategory && (
                    <span className="confession-tag">
                      <TrendingUp size={12} />
                      {trendingCategory.label} is trending
                    </span>
                  )}
                </div>

                <h2 className="max-w-2xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
                  Say it once. Let the room react.
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                  A cleaner anonymous feed with better rhythm, faster browsing, and a stronger spotlight on what is
                  actually interesting.
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <div className="confession-pill">
                    <Sparkles size={14} />
                    {confessions.length} posts live
                  </div>
                  <div className="confession-pill">
                    <TrendingUp size={14} />
                    {trendingCategory?.label ?? 'Random'} active
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4">
                  {/* Trending Box */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-3 sm:p-4 backdrop-blur-md transition-all hover:border-orange-500/30 cursor-pointer"
                    onClick={() => {
                      if (trendingPost) {
                        const element = document.getElementById(trendingPost.id);
                        if (element) {
                          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          element.classList.add('ring-2', 'ring-orange-500', 'ring-offset-8', 'ring-offset-[#09060d]');
                          setTimeout(() => {
                            element.classList.remove('ring-2', 'ring-orange-500', 'ring-offset-8', 'ring-offset-[#09060d]');
                          }, 3000);
                        }
                      }
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                    <div className="relative z-10">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500/20 text-orange-400">
                          <Flame size={16} className="animate-pulse" />
                        </div>
                        <h4 className="text-[11px] font-black uppercase tracking-[0.15em] text-white">Trending</h4>
                      </div>
                      
                      {trendingPost ? (
                        <div className="mt-3">
                          <p className="line-clamp-2 text-xs italic leading-relaxed text-slate-300 break-all overflow-hidden">
                            "{trendingPost.content}"
                          </p>
                          <div className="mt-3 flex items-center justify-between text-[10px]">
                            <span className="font-bold text-orange-400/80 uppercase tracking-widest">
                              {trendingPost.category}
                            </span>
                            <div className="flex items-center gap-2 text-slate-500">
                              <span className="flex items-center gap-1">
                                <Flame size={10} /> {trendingPost.likes}
                              </span>
                              <span className="flex items-center gap-1">
                                <MessageCircle size={10} /> {commentCounts[trendingPost.id] || 0}
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-4 text-xs text-slate-500">Finding trends...</p>
                      )}
                    </div>
                  </motion.div>

                  {/* Vibe Box */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1 }}
                    className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-3 sm:p-4 backdrop-blur-md transition-all hover:border-purple-500/30"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                    <div className="relative z-10">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-500">Vibe Check</div>
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r ${spotlight ? getVibeInfo(spotlight, commentCounts[spotlight.id] || 0).color : 'from-slate-500 to-slate-700'} text-[9px] font-black text-white uppercase tracking-widest`}>
                          <span>{spotlight ? getVibeInfo(spotlight, commentCounts[spotlight.id] || 0).emoji : '✨'}</span>
                          <span>{spotlight ? getVibeInfo(spotlight, commentCounts[spotlight.id] || 0).label : 'Calm'}</span>
                        </div>
                      </div>
                      
                      <div className="mt-8">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: spotlight ? `${getVibeInfo(spotlight, commentCounts[spotlight.id] || 0).level * 10}%` : '0%' }}
                            transition={{ duration: 1.2, ease: "easeOut" }}
                            className={`h-full bg-gradient-to-r ${spotlight ? getVibeInfo(spotlight, commentCounts[spotlight.id] || 0).color : 'from-slate-500 to-slate-700'}`}
                          />
                        </div>
                        <div className="mt-2 flex justify-between text-[9px] font-bold uppercase tracking-widest text-slate-600">
                          <span>Mellow</span>
                          <span>Intense</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 lg:flex lg:flex-col lg:gap-4">
                {/* Spotlight Card: Mini on mobile, detailed on desktop */}
                <div className="col-span-1 lg:col-span-full">
                  <div className="lg:hidden confession-mini-panel h-full flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: spotlightMeta.accent }}>{spotlightMeta.label}</span>
                      <p className="text-[11px] leading-relaxed text-slate-300 line-clamp-2 break-all overflow-hidden">{spotlight?.content ?? 'Spotlight'}</p>
                    </div>
                    {spotlight && (
                      <button
                        onClick={() => setCommentTarget(spotlight)}
                        className="mt-2 text-[10px] font-bold uppercase tracking-widest text-orange-400/80 hover:text-orange-400 transition-colors"
                      >
                        Open thread
                      </button>
                    )}
                  </div>
                  <div className="hidden lg:block confession-spotlight-card">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="confession-tag" style={{ color: spotlightMeta.accent, borderColor: `${spotlightMeta.accent}45` }}>
                        {spotlightMeta.label}
                      </span>
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        {spotlight ? timeAgo(spotlight.created_at) : 'waiting'}
                      </span>
                    </div>
                    <div className="max-h-[220px] overflow-y-auto custom-scrollbar-voice pr-2">
                      <p className="text-sm leading-7 text-slate-100 break-all">
                        {spotlight?.content ?? 'Your next confession can become the spotlight.'}
                      </p>
                    </div>
                    <div className="mt-5 flex items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Flame size={14} />
                        {spotlight?.likes ?? 0}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle size={14} />
                        {spotlight ? commentCounts[spotlight.id] || 0 : 0}
                      </span>
                      {spotlight && (
                        <button
                          onClick={() => setCommentTarget(spotlight)}
                          className="rounded-full border border-white/10 px-3 py-1.5 text-slate-200 transition hover:bg-white/10"
                        >
                          Open thread
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="confession-mini-panel h-full flex flex-col justify-between">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Freshest drop</p>
                  <p className="mt-1 text-[11px] text-slate-200 line-clamp-2 break-all overflow-hidden">{latestDrop ? latestDrop.content.slice(0, 88) : 'No confessions yet.'}</p>
                </div>
                <div className="confession-mini-panel h-full flex flex-col justify-between">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Collections</p>
                  <p className="mt-1 text-[11px] text-slate-200 line-clamp-2">{bookmarkedIds.size} saved.</p>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.section
            className="confession-composer rounded-[2rem] border border-white/10 p-5 sm:p-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 }}
          >
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-orange-300/80">Compose</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Post something real</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  Pick a lane, write it clean, and send it.
                </p>
              </div>
              <div className="rounded-[1.25rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                <span className="block text-[11px] uppercase tracking-[0.22em] text-slate-500">Current mood</span>
                <span className="mt-1 inline-flex items-center gap-2 font-medium text-white">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: composerMeta.accent }} />
                  {composerMeta.label}: {composerMeta.description}
                </span>
              </div>
            </div>

            <div className="mb-4 flex flex-row gap-2 overflow-x-auto pb-2 scrollbar-hide sm:flex-wrap sm:pb-0">
              {CATEGORIES.slice(1).map((item) => (
                <button
                  key={item.key}
                  onClick={() => setCategory(item.key)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    category === item.key ? 'text-white shadow-lg' : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-white'
                  }`}
                  style={
                    category === item.key
                      ? {
                          borderColor: `${item.accent}55`,
                          background: `linear-gradient(135deg, ${item.accent}33, rgba(255,255,255,0.04))`,
                          boxShadow: `0 18px 40px ${item.accent}20`,
                        }
                      : undefined
                  }
                >
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 text-[11px]">
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              ))}
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-black/20 p-3 shadow-2xl shadow-black/20">
              <textarea
                className="input-field min-h-[150px] resize-none border-0 bg-transparent px-3 py-3 text-base leading-7 shadow-none placeholder:text-slate-500 focus:bg-transparent focus:shadow-none"
                placeholder="Type what you have been holding in..."
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setPostError('');
                }}
                rows={5}
                maxLength={500}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 px-3 pt-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                  <Lightbulb size={12} />
                  Anonymous mode
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{text.length}/500</span>
                  <span>{text.trim().split(/\s+/).filter(Boolean).length} words</span>
                </div>
              </div>
            </div>

            {postError ? <p className="mt-3 text-sm text-red-400">{postError}</p> : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-500">Your draft stays here until you send it or clear it.</p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => {
                    setText('');
                    window.localStorage.removeItem(LOCAL_STORAGE_KEYS.draft);
                  }}
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/8 hover:text-white"
                >
                  Clear draft
                </button>
                <button
                  onClick={post}
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500 via-pink-500 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(249,115,22,0.35)] transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!text.trim() || posting || safeMode || isDisabled}
                >
                  {safeMode || isDisabled ? <ShieldAlert size={16} /> : <Sparkles size={16} />}
                  {posting ? 'Posting...' : safeMode ? 'Safe Mode' : isDisabled ? 'Confessions Disabled' : 'Post confession'}
                </button>
              </div>
            </div>
          </motion.section>

          <section className="rounded-[2rem] border border-white/10 bg-white/4 p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Browse</p>
                <h3 className="mt-1 text-xl font-semibold text-white">Find the juicy stuff faster</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setOnlyBookmarked((current) => !current)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    onlyBookmarked ? 'border-orange-400/50 bg-orange-500/15 text-orange-200' : 'border-white/10 text-slate-300 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  <Bookmark className="mr-2 inline" size={14} />
                  Saved only
                </button>
                <button
                  onClick={reviveDismissed}
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/8 hover:text-white"
                >
                  Restore hidden
                </button>
              </div>
            </div>

            <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
              <label className="flex items-center gap-3 rounded-[1.25rem] border border-white/10 bg-black/20 px-4 py-3">
                <Search size={16} className="text-slate-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by keyword..."
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {(['hot', 'new', 'discussed'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSortBy(mode)}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      sortBy === mode ? 'border-orange-400/50 bg-orange-500/15 text-orange-200' : 'border-white/10 text-slate-300 hover:bg-white/8 hover:text-white'
                    }`}
                  >
                    {mode === 'hot' ? 'Hot' : mode === 'new' ? 'New' : 'Discussed'}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setFilterCat(item.key)}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      filterCat === item.key ? 'border-white/20 text-white' : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-white'
                    }`}
                    style={filterCat === item.key ? { backgroundColor: `${item.accent}22` } : undefined}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-row flex-nowrap gap-3 overflow-x-auto pb-4 scrollbar-hide sm:grid sm:grid-cols-2 lg:grid-cols-4 sm:pb-0">
              {activeCategories.map((item) => (
                <div key={item.key} className="confession-mini-panel min-w-[240px] shrink-0 sm:min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">{item.label}</span>
                    <span className="rounded-full px-2 py-1 text-[11px]" style={{ backgroundColor: `${item.accent}20`, color: item.accent }}>
                      {item.count}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{item.description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Feed</p>
                <h3 className="mt-1 text-2xl font-semibold text-white">{filteredConfessions.length} confessions on deck</h3>
              </div>
              <p className="text-sm text-slate-500">Hot ranking blends likes, replies, and freshness.</p>
            </div>

            <AnimatePresence mode="popLayout">
              {filteredConfessions.map((confession, index) => {
                const meta = getCategoryMeta(confession.category);
                const isBookmarked = bookmarkedIds.has(confession.id);
                const isLiked = likedIds.has(confession.id);
                const comments = commentCounts[confession.id] || 0;

                return (
                  <motion.article
                    key={confession.id}
                    id={confession.id}
                    layout
                    className="confession-card group overflow-hidden rounded-[2rem] border border-white/10"
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    transition={{ delay: index < 5 ? index * 0.04 : 0 }}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${meta.aura} opacity-70`} />
                    <div className="relative p-5 sm:p-6">
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="confession-tag" style={{ color: meta.accent, borderColor: `${meta.accent}45` }}>
                            {meta.label}
                          </span>
                          <span className="confession-tag">
                            <Compass size={12} />
                            Heat {Math.round(getHeatScore(confession, comments))}
                          </span>
                        </div>
                        <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                          {timeAgo(confession.created_at)}
                        </span>
                      </div>

                      <div className="max-h-[300px] overflow-y-auto custom-scrollbar-voice pr-2">
                        <p className="text-[15px] leading-7 text-slate-100 sm:text-base break-all">{confession.content}</p>
                      </div>

                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => like(confession)}
                            className={`confession-action ${isLiked ? 'confession-action-active' : ''}`}
                          >
                            <Flame size={15} />
                            {confession.likes}
                          </button>
                          <button
                            onClick={() => setCommentTarget(confession)}
                            className="confession-action"
                          >
                            <MessageCircle size={15} />
                            {comments}
                          </button>
                          <button
                            onClick={() => toggleBookmark(confession.id)}
                            className={`confession-action ${isBookmarked ? 'confession-action-active' : ''}`}
                          >
                            <Bookmark size={15} />
                            {isBookmarked ? 'Saved' : 'Save'}
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => dismissConfession(confession.id)}
                            className="confession-action text-slate-400"
                          >
                            <X size={15} />
                            Hide
                          </button>
                          {profile?.is_admin && (
                            <button
                              onClick={() => deleteOwn(confession.id)}
                              className="confession-action text-red-400 hover:border-red-400/30 hover:bg-red-500/10"
                            >
                              <Trash2 size={15} />
                              Delete
                            </button>
                          )}
                          {(confession.user_id === user?.uid) ? (
                            <button
                              onClick={() => deleteOwn(confession.id)}
                              className="confession-action text-red-300 hover:border-red-400/30 hover:bg-red-500/10"
                            >
                              <Trash2 size={15} />
                              Delete
                            </button>
                          ) : null}
                          <button
                            onClick={() => setReportingContent({ type: 'confession', id: confession.id })}
                            className="confession-action text-amber-300/80 hover:border-amber-400/30 hover:bg-amber-500/10 hover:text-amber-400 font-bold"
                          >
                            <AlertTriangle size={15} />
                            Report
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>

            {filteredConfessions.length === 0 ? (
              <div className="rounded-[2rem] border border-dashed border-white/10 bg-white/4 px-6 py-16 text-center">
                <Sparkles className="mx-auto mb-3 text-slate-500" size={28} />
                <p className="text-lg font-medium text-slate-200">Nothing matches this mix right now.</p>
                <p className="mt-2 text-sm text-slate-500">
                  Change the filters, restore hidden posts, or launch the next confession yourself.
                </p>
              </div>
            ) : null}
          </section>
      </main>

      <AnimatePresence>
        {commentTarget ? (
          <CommentPanel
            key={commentTarget.id}
            confession={commentTarget}
            user={user}
            profile={profile}
            onClose={() => setCommentTarget(null)}
            onReport={(type, id) => setReportingContent({ type, id })}
          />
        ) : null}
      </AnimatePresence>

      <ReportModal 
        isOpen={!!reportingContent}
        onClose={() => setReportingContent(null)}
        targetType={reportingContent?.type || 'confession'}
        targetId={reportingContent?.id || ''}
      />
    </div>
  );
}
