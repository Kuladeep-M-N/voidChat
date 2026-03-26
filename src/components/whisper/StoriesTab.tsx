import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, User, Users, ChevronRight, PenTool, X,
  Flame, Gem, TrendingUp, Search, Tag, Hash, Trash2, Heart, MessageCircle, AlertTriangle
} from 'lucide-react';
import ReportModal from '../ReportModal';
import { useNavigate, useLocation } from 'react-router-dom';
import { db } from '../../lib/firebase';
import {
  collection, query, orderBy, onSnapshot, addDoc, serverTimestamp,
  where, getDocs, doc, deleteDoc, getDoc
} from 'firebase/firestore';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'sonner';
import { containsInappropriateContent } from '../../lib/filter';

interface Story {
  id: string;
  title: string;
  authorName: string;
  authorId: string;
  excerpt: string;
  episodes: number;
  followers: number;
  likes?: number;
  tags: string[];
  color: string;
  reactions?: { mindBlown?: number; dark?: number; genius?: number; creepy?: number };
  createdAt?: any;
}

const PRESET_TAGS = [
  { label: '#horror',   style: 'neon-tag neon-tag-red' },
  { label: '#dark',     style: 'neon-tag neon-tag-purple' },
  { label: '#sci-fi',   style: 'neon-tag neon-tag-cyan' },
  { label: '#mystery',  style: 'neon-tag neon-tag-pink' },
  { label: '#theory',   style: 'neon-tag neon-tag-amber' },
  { label: '#true',     style: 'neon-tag neon-tag-red' },
  { label: '#fiction',  style: 'neon-tag neon-tag-cyan' },
  { label: '#thriller', style: 'neon-tag neon-tag-purple' },
];

const TAG_STYLE_MAP: Record<string, string> = {
  '#horror':   'neon-tag neon-tag-red',
  '#dark':     'neon-tag neon-tag-purple',
  '#sci-fi':   'neon-tag neon-tag-cyan',
  '#mystery':  'neon-tag neon-tag-pink',
  '#theory':   'neon-tag neon-tag-amber',
  '#true':     'neon-tag neon-tag-red',
  '#fiction':  'neon-tag neon-tag-cyan',
  '#thriller': 'neon-tag neon-tag-purple',
  'New':       'neon-tag neon-tag-purple',
  'Void':      'neon-tag neon-tag-cyan',
};

function getTagStyle(tag: string): string {
  return TAG_STYLE_MAP[tag] || TAG_STYLE_MAP['#dark'];
}

function CreatorBadge({ story }: { story: Story }) {
  if (story.episodes >= 5)
    return <span className="whisper-badge badge-viral">🔥 Viral</span>;
  if ((story.reactions?.genius || 0) + (story.reactions?.mindBlown || 0) >= 10)
    return <span className="whisper-badge badge-mastermind">🧠 Mastermind</span>;
  const hasDark = story.tags?.some(t => ['#horror', '#dark', '#thriller'].includes(t));
  if (hasDark)
    return <span className="whisper-badge badge-dark">👻 Dark Creator</span>;
  return null;
}

function ReadingProgress({ storyId }: { storyId: string }) {
  const totalParts = parseInt(localStorage.getItem(`whisper_total_${storyId}`) || '0');
  const lastRead = parseInt(localStorage.getItem(`whisper_progress_${storyId}`) || '0');
  if (totalParts === 0 || lastRead === 0) return null;
  const pct = Math.min(100, Math.round((lastRead / totalParts) * 100));
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
        <span>Continue reading</span>
        <span className="text-cyan-400 font-bold">{pct}%</span>
      </div>
      <div className="whisper-progress-bar">
        <div className="whisper-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ReactionMini({ reactions }: { reactions?: Story['reactions'] }) {
  if (!reactions) return null;
  const items = [
    { emoji: '🔥', count: reactions.mindBlown ?? 0 },
    { emoji: '😱', count: reactions.dark ?? 0 },
    { emoji: '🧠', count: reactions.genius ?? 0 },
    { emoji: '💀', count: reactions.creepy ?? 0 },
  ].filter(r => r.count > 0);

  if (items.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      {items.map(r => (
        <span key={r.emoji} className="text-xs text-slate-400">
          {r.emoji} <span className="font-bold">{r.count}</span>
        </span>
      ))}
    </div>
  );
}

function StoryCard({ story, index, onClick, onDelete, isAdmin }: { 
  story: Story; 
  index: number; 
  onClick: () => void;
  onDelete?: (e: React.MouseEvent) => void;
  isAdmin?: boolean;
}) {
  const navigate = useNavigate();
  const [avgRating, setAvgRating] = useState<string>('—');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  useEffect(() => {
    if (!story.id) return;
    const q = query(collection(db, 'whisper_story_parts'), where('storyId', '==', story.id));
    getDocs(q).then(snap => {
      const allRatings: number[] = [];
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.plotTwistRatings && Array.isArray(data.plotTwistRatings)) {
          allRatings.push(...data.plotTwistRatings);
        }
      });
      if (allRatings.length > 0) {
        setAvgRating((allRatings.reduce((a, b) => a + b, 0) / allRatings.length).toFixed(1));
      } else {
        setAvgRating('—');
      }
    });
  }, [story.id]);

  return (
    <motion.div
      onClick={onClick}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4, ease: 'easeOut' }}
      className="whisper-card p-5 cursor-pointer group relative overflow-hidden"
    >
      {/* Top gradient highlight */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-fuchsia-500/40 to-transparent" />

      {/* Top row: tags + episodes */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-1.5">
          {story.tags?.slice(0, 3).map(tag => (
            <span key={tag} className={getTagStyle(tag)}>{tag}</span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && onDelete && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-all"
              title="Admin: Delete Story"
            >
              <Trash2 size={12} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsReportModalOpen(true);
            }}
            className="p-1.5 rounded-lg hover:bg-amber-500/10 text-slate-500 hover:text-amber-400 transition-all"
            title="Report Story"
          >
            <AlertTriangle size={12} />
          </button>
          <div className="flex items-center gap-1 text-[11px] font-bold text-fuchsia-400 bg-fuchsia-500/10 border border-fuchsia-500/20 px-2 py-0.5 rounded-full shrink-0">
            <BookOpen size={10} />
            {story.episodes} {story.episodes === 1 ? 'part' : 'parts'}
          </div>
        </div>
      </div>

      {/* Title + badge */}
      <div className="flex items-start gap-2 mb-1">
        <h3
          className="text-lg font-bold text-white leading-snug group-hover:text-fuchsia-300 transition-colors flex-1"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {story.title}
        </h3>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <div className="w-5 h-5 rounded-full bg-fuchsia-500/20 border border-fuchsia-500/20 flex items-center justify-center text-[10px] font-bold text-fuchsia-300">
          {story.authorName.charAt(0).toUpperCase()}
        </div>
        <span className="text-xs text-slate-400 font-medium">@{story.authorName}</span>
        <CreatorBadge story={story} />
      </div>

      <p className="text-sm text-slate-500 leading-relaxed line-clamp-2 mb-3">
        {story.excerpt}
      </p>

      {/* Continue reading progress */}
      <ReadingProgress storyId={story.id} />

      {/* Interaction Bar (Simplified Reddit Style) */}
      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/5">
        <div className="flex items-center bg-white/5 rounded-full p-1 border border-white/5 backdrop-blur-md">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-slate-400">
            <Heart size={14} className="text-pink-500/70" />
            <span>{story.likes || 0}</span>
          </div>
          <div className="w-[1px] h-4 bg-white/10" />
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-slate-400">
            <TrendingUp size={14} className="text-amber-400/70" />
            <span className="text-amber-300">{avgRating === '—' ? 'New' : avgRating}</span>
          </div>
        </div>
        
        <div className="flex-1" />
        
        <div className="flex items-center gap-1 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
          <Users size={12} className="text-indigo-400" />
          <span>{story.followers.toLocaleString()}</span>
        </div>
      </div>

      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        targetType="whisper_story"
        targetId={story.id}
        storyId={story.id}
      />
    </motion.div>
  );
}

export default function StoriesTab({ externalFilter, isComposingExternal, onCloseCompose, searchQuery = '' }: { 
  externalFilter?: string | null; 
  isComposingExternal?: boolean; 
  onCloseCompose?: () => void; 
  searchQuery?: string;
}) {
  const [stories, setStories] = useState<Story[]>([]);
  const [isComposing, setIsComposing] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newExcerpt, setNewExcerpt] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  const [penName, setPenName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [followedIds, setFollowedIds] = useState<string[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile } = useAuth();

  const isAuthorsView = location.pathname.includes('/authors');
  const queryParams = new URLSearchParams(location.search);
  const sortParam = queryParams.get('sort');
  const authorParam = queryParams.get('author');

  const [authorProfile, setAuthorProfile] = useState<{ name: string } | null>(null);

  useEffect(() => {
    if (authorParam) {
      getDoc(doc(db, 'users', authorParam)).then(snap => {
        if (snap.exists()) setAuthorProfile({ name: snap.data().anonymous_username });
      });
    } else {
      setAuthorProfile(null);
    }
  }, [authorParam]);

  useEffect(() => {
    if (isComposingExternal) setIsComposing(true);
  }, [isComposingExternal]);

  const handleCloseCompose = () => {
    setIsComposing(false);
    if (onCloseCompose) onCloseCompose();
  };

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, 'whisper_stories'));
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })) as Story[];
      
      // Sort locally by date desc
      data.sort((a, b) => {
        const t1 = a.createdAt?.toMillis?.() || Date.now();
        const t2 = b.createdAt?.toMillis?.() || Date.now();
        return t2 - t1;
      });

      setStories(data);
    });
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    const qFol = query(collection(db, 'whisper_story_follows'), where('userId', '==', user.uid));
    const unsubFol = onSnapshot(qFol, snap => {
      setFollowedIds(snap.docs.map(d => d.data().storyId));
    });
    return () => unsubFol();
  }, [user?.uid]);

  useEffect(() => {
    if (isComposing && !penName) {
      setPenName(localStorage.getItem('whisper_pen_name') || profile?.anonymous_username || 'Anonymous');
    }
  }, [isComposing, profile]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newExcerpt.trim() || !penName.trim() || !user || isSubmitting) return;
    if (containsInappropriateContent(newTitle).matches || containsInappropriateContent(newExcerpt).matches) {
      toast.error('Keep it clean in the void.');
      return;
    }
    setIsSubmitting(true);
    try {
      // Check Pen Name uniqueness globally (case-insensitive)
      const nameCheckQ = query(collection(db, 'whisper_stories'), where('authorNameLower', '==', penName.trim().toLowerCase()));
      const nameCheckSnap = await getDocs(nameCheckQ);
      if (!nameCheckSnap.empty && nameCheckSnap.docs.some(doc => doc.data().authorId !== user.uid)) {
        toast.error('Pen name is already taken by someone else in the void.');
        setIsSubmitting(false);
        return;
      }
      localStorage.setItem('whisper_pen_name', penName.trim());

      const tags = selectedTags.length > 0 ? selectedTags : ['#dark'];
      if (customTag.trim()) {
         const formattedTag = customTag.startsWith('#') ? customTag.trim().toLowerCase() : '#' + customTag.trim().toLowerCase();
         if (!tags.includes(formattedTag)) tags.push(formattedTag);
      }
      await addDoc(collection(db, 'whisper_stories'), {
        title: newTitle.trim(),
        excerpt: newExcerpt.trim(),
        authorName: penName.trim(),
        authorNameLower: penName.trim().toLowerCase(),
        authorId: user.uid,
        episodes: 0,
        followers: 0,
        likes: 0,
        tags,
        color: 'from-fuchsia-500/20 to-purple-500/20',
        reactions: { mindBlown: 0, dark: 0, genius: 0, creepy: 0 },
        createdAt: serverTimestamp(),
      });
      handleCloseCompose();
      setNewTitle('');
      setNewExcerpt('');
      setSelectedTags([]);
      setCustomTag('');
      toast.success('Story thread started!');
    } catch (err) {
      toast.error('Failed to start story.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteStory = async (e: React.MouseEvent, storyId: string) => {
    e.stopPropagation();
    if (!profile?.is_admin) return;
    if (!window.confirm('Admin: DELETE THIS STORY PERMANENTLY?')) return;

    try {
      await deleteDoc(doc(db, 'whisper_stories', storyId));
      toast.success('Story removed by admin');
    } catch (err) {
      toast.error('Failed to delete story');
    }
  };

  const toggleTag = (tag: string) =>
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : prev.length < 3 ? [...prev, tag] : prev
    );

  const filteredStories = stories.filter(s => {
    if (authorParam) return s.authorId === authorParam;
    
    const matchTag = (externalFilter && !['Following', 'Liked'].includes(externalFilter)) 
      ? s.tags?.includes(externalFilter) 
      : true;
    
    const matchSearch = searchQuery
      ? s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.excerpt.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.authorName.toLowerCase().includes(searchQuery.toLowerCase())
      : true;

    if (externalFilter === 'Following') return followedIds.includes(s.id) && matchSearch;
    
    return matchTag && matchSearch;
  });

  if (externalFilter === 'Liked' || sortParam === 'popular') {
    filteredStories.sort((a, b) => (b.likes || 0) - (a.likes || 0));
  }

  const totalReactions = (s: Story) =>
    (s.reactions?.mindBlown ?? 0) + (s.reactions?.dark ?? 0) +
    (s.reactions?.genius ?? 0) + (s.reactions?.creepy ?? 0);

  const trending = [...stories]
    .sort((a, b) => totalReactions(b) - totalReactions(a))
    .filter(s => totalReactions(s) > 0)
    .slice(0, 3);

  const underrated = [...stories]
    .filter(s => s.followers < 5 && totalReactions(s) > 0)
    .sort((a, b) => totalReactions(b) - totalReactions(a))
    .slice(0, 3);

  return (
    <div className="pb-24">
      {/* ── Compose Modal ── */}
      <AnimatePresence>
        {isComposing && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            className="mb-6 relative rounded-2xl border border-fuchsia-500/30 overflow-hidden"
            style={{ background: 'rgba(191,90,242,0.06)', backdropFilter: 'blur(20px)' }}
          >
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-fuchsia-500/60 to-transparent" />
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  ✍️ Start a New Story Thread
                </h3>
                <button onClick={handleCloseCompose} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all">
                  <X size={16} />
                </button>
              </div>

              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Story title..."
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white font-semibold mb-3 outline-none focus:border-fuchsia-500/60 transition-colors placeholder-slate-600"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                maxLength={70}
              />
              <input
                value={penName}
                onChange={e => setPenName(e.target.value)}
                placeholder="Your Author Pen Name"
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-medium mb-3 outline-none focus:border-fuchsia-500/60 transition-colors placeholder-emerald-600"
                style={{ borderLeft: '3px solid #bf5af2' }}
                maxLength={30}
              />
              <textarea
                value={newExcerpt}
                onChange={e => setNewExcerpt(e.target.value)}
                placeholder="Hook readers with a short excerpt (max 200 chars)..."
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-slate-200 mb-4 outline-none focus:border-fuchsia-500/60 h-24 resize-none transition-colors placeholder-slate-600"
                style={{ fontFamily: "'Manrope', sans-serif" }}
                maxLength={200}
              />

              {/* Tag selector */}
              <div className="mb-5">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Pick up to 3 preset tags or add your own</span>
                <div className="flex flex-wrap gap-2 mb-3">
                  {PRESET_TAGS.map(t => (
                    <button
                      key={t.label}
                      onClick={() => toggleTag(t.label)}
                      className={`${t.style} ${selectedTags.includes(t.label) ? 'active' : ''}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <input
                  value={customTag}
                  onChange={e => setCustomTag(e.target.value)}
                  placeholder="Or add a custom tag (e.g. #space)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-fuchsia-500/40 transition-colors placeholder-slate-600"
                  maxLength={20}
                />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleCreate}
                  disabled={!newTitle.trim() || !newExcerpt.trim() || isSubmitting}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-40 transition-all"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #bf5af2)', boxShadow: '0 0 24px rgba(124,58,237,0.4)' }}
                >
                  {isSubmitting && <span className="w-4 h-4 rounded-full border-2 border-white/50 border-t-transparent animate-spin" />}
                  Initialize Thread ✦
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Author Search Header ── */}
      {authorProfile && (
        <div className="mb-8 p-6 rounded-3xl bg-fuchsia-500/5 border border-fuchsia-500/10 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-fuchsia-400 uppercase tracking-widest block mb-1">Viewing Works By</span>
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>@{authorProfile.name}</h2>
          </div>
          <button 
            onClick={() => navigate('/whisper/stories')}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-all"
          >
            Clear Filter
          </button>
        </div>
      )}


      {/* ── Trending Section ── */}
      {trending.length > 0 && !externalFilter && !searchQuery && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Flame size={16} className="text-amber-400" />
            <span className="text-sm font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Trending</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {trending.map((story, i) => (
              <div
                key={story.id}
                onClick={() => navigate(`/whisper/story/${story.id}`)}
                className="trending-card"
              >
                <div className="flex flex-wrap gap-1 mb-2">
                  {story.tags?.slice(0, 2).map(tag => (
                    <span key={tag} className={`${getTagStyle(tag)} text-[10px] px-1.5 py-0.5`}>{tag}</span>
                  ))}
                </div>
                <p className="text-sm font-bold text-white leading-snug line-clamp-2 mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  {story.title}
                </p>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>🔥 {totalReactions(story)}</span>
                  <span>•</span>
                  <span>@{story.authorName}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Underrated Gems ── */}
      {underrated.length > 0 && !externalFilter && !searchQuery && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Gem size={15} className="text-cyan-400" />
            <span className="text-sm font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Underrated Gems</span>
          </div>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
            {underrated.map(story => (
              <div
                key={story.id}
                onClick={() => navigate(`/whisper/story/${story.id}`)}
                className="min-w-[200px] whisper-card whisper-card-glow-cyan p-4 cursor-pointer shrink-0"
              >
                <p className="text-sm font-bold text-white mb-1 line-clamp-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  {story.title}
                </p>
                <div className="text-xs text-slate-500">💎 Hidden gem · @{story.authorName}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── All Stories Grid ── */}
      {filteredStories.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp size={14} className="text-slate-500" />
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            {externalFilter ? `Stories tagged ${externalFilter}` : 'All Stories'}
          </span>
        </div>
      )}

      {filteredStories.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-24 rounded-3xl border border-white/5 bg-white/2"
        >
          <BookOpen className="mx-auto text-slate-600 mb-4" size={36} />
          <p className="text-slate-400 font-bold mb-1" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            {externalFilter === 'Following' 
              ? "You aren't following any authors yet." 
              : (searchQuery || externalFilter ? 'No stories match your filter.' : 'No stories yet in the void.')}
          </p>
          <p className="text-slate-600 text-sm">
            {externalFilter === 'Following'
              ? 'Explore the void to find inspiration and follow creators!'
              : (searchQuery || externalFilter ? 'Try a different tag or search term.' : 'Be the first to start a thread.')}
          </p>
        </motion.div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filteredStories.map((story, i) => (
            <StoryCard
              key={story.id}
              story={story}
              index={i}
              onClick={() => navigate(`/whisper/story/${story.id}`)}
              isAdmin={profile?.is_admin}
              onDelete={(e) => handleDeleteStory(e, story.id)}
            />
          ))}
        </div>
      )}

    </div>
  );
}
