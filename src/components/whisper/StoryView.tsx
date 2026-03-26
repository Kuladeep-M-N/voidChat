import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send, Users, ShieldAlert, GitBranch, Copy, Check, Heart, Trash2, MessageCircle, TrendingUp, Sparkles, AlertTriangle } from 'lucide-react';
import ReportModal from '../ReportModal';
import { db } from '../../lib/firebase';
import {
  doc, getDoc, collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, serverTimestamp, increment, deleteDoc, getDocs
} from 'firebase/firestore';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'sonner';
import { containsInappropriateContent } from '../../lib/filter';
import StoryBranchVote from './StoryBranchVote';
import StoryComments from './StoryComments';

interface Story {
  id: string;
  title: string;
  authorName: string;
  authorId: string;
  followers: number;
  likes?: number;
  tags?: string[];
}

interface StoryPart {
  id: string;
  storyId: string;
  number: number;
  title: string;
  content: string;
  createdAt: any;
  upvotes: number;
  downvotes: number;
  plotTwistRatings?: number[];
  branchOptions?: { label: string }[];
}

interface PartComment {
  id: string;
  partId: string;
  content: string;
  authorName: string;
  createdAt: any;
}

const REACTIONS = [
  { key: 'mindBlown', emoji: '🔥', label: 'Mind-blown' },
  { key: 'dark',      emoji: '😱', label: 'Dark' },
  { key: 'genius',    emoji: '🧠', label: 'Genius' },
  { key: 'creepy',    emoji: '💀', label: 'Creepy' },
] as const;

function timeAgo(date: any) {
  if (!date) return '';
  const d = date?.toDate ? date.toDate() : new Date(date);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (isNaN(diff) || diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}



function QuoteHighlight({ storyTitle }: { storyTitle: string }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim().length < 10) {
      setTooltip(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setTooltip({
      x: rect.left + rect.width / 2,
      y: rect.top + window.scrollY,
      text: sel.toString().trim(),
    });
  }, [storyTitle]);

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  const handleCopy = () => {
    if (!tooltip) return;
    navigator.clipboard.writeText(`"${tooltip.text}" — from Whisper Space: ${storyTitle}`);
    setCopied(true);
    setTimeout(() => { setCopied(false); setTooltip(null); }, 1500);
  };

  if (!tooltip) return null;
  return (
    <div
      style={{ position: 'fixed', left: tooltip.x, top: tooltip.y, zIndex: 999, transform: 'translateX(-50%) translateY(-120%)' }}
    >
      <button
        onClick={handleCopy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-fuchsia-300 bg-[#0d0d1a] border border-fuchsia-500/40 shadow-xl backdrop-blur-sm hover:bg-fuchsia-500/15 transition-all"
        style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 12px rgba(191,90,242,0.3)' }}
      >
        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        {copied ? 'Copied!' : '📋 Copy Quote'}
      </button>
    </div>
  );
}

function PartInteractionBar({ part, story, isAuthor, votedIds, onVote }: { 
  part: StoryPart; 
  story: Story; 
  isAuthor: boolean; 
  votedIds: Set<string>;
  onVote: (partId: string, type: 'up' | 'down') => void;
}) {
  const [activeUnit, setActiveUnit] = useState<'none' | 'vote' | 'comment' | 'rating'>('none');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(0);

  useEffect(() => {
    const q = query(collection(db, 'whisper_part_comments'), where('partId', '==', part.id));
    const unsub = onSnapshot(q, snap => setCommentCount(snap.size));
    return () => unsub();
  }, [part.id]);

  const totalVotes = (part.upvotes || 0) - (part.downvotes || 0);
  const avgRating = part.plotTwistRatings && part.plotTwistRatings.length > 0
    ? (part.plotTwistRatings.reduce((a, b) => a + b, 0) / part.plotTwistRatings.length).toFixed(1)
    : '—';

  return (
    <div className="relative mt-6 pt-4 border-t border-white/5">
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-white/5 rounded-full p-1 border border-white/5 backdrop-blur-md">
          <div className="flex items-center gap-0.5 bg-black/20 rounded-full p-0.5 mr-1">
            <button 
              onClick={() => onVote(part.id, 'up')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full transition-all ${votedIds.has(`${part.id}_up`) ? 'text-orange-500 bg-orange-500/10' : 'text-slate-500 hover:text-orange-400 hover:bg-white/5'}`}
            >
              <ArrowLeft size={16} className="rotate-90" />
              <span className="text-[11px] font-black">{part.upvotes || 0}</span>
            </button>
            <div className="w-[1px] h-3 bg-white/10 mx-0.5" />
            <button 
              onClick={() => onVote(part.id, 'down')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full transition-all ${votedIds.has(`${part.id}_down`) ? 'text-indigo-500 bg-indigo-500/10' : 'text-slate-500 hover:text-indigo-400 hover:bg-white/5'}`}
            >
              <ArrowLeft size={16} className="-rotate-90" />
              <span className="text-[11px] font-black">{part.downvotes || 0}</span>
            </button>
          </div>
          
          <div className="w-[1px] h-4 bg-white/10" />
          
          <button 
            onClick={() => setActiveUnit(activeUnit === 'comment' ? 'none' : 'comment')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${activeUnit === 'comment' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white'}`}
          >
            <MessageCircle size={14} className={activeUnit === 'comment' ? 'fill-current' : 'text-cyan-400/70'} />
            <span>{commentCount}</span>
          </button>
          <div className="w-[1px] h-4 bg-white/10" />
          <button 
            onClick={() => setActiveUnit(activeUnit === 'rating' ? 'none' : 'rating')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${activeUnit === 'rating' ? 'bg-amber-500/20 text-amber-400' : 'text-slate-400 hover:text-white'}`}
          >
            <TrendingUp size={14} className={activeUnit === 'rating' ? 'fill-current' : 'text-amber-400/70'} />
            <span className="text-amber-300">{avgRating}</span>
          </button>
          
          <div className="w-[1px] h-4 bg-white/10" />
          
          <button 
            onClick={() => setIsReportModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-slate-400 hover:text-amber-400 transition-all hover:bg-amber-500/10"
            title="Report Part"
          >
            <AlertTriangle size={14} className="text-slate-500 hover:text-amber-400" />
          </button>
        </div>
      </div>
      
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        targetType="whisper_story_part"
        targetId={part.id}
        storyId={part.storyId}
      />

      {/* Interaction Pop-up Units */}
      <AnimatePresence>
        {activeUnit !== 'none' && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40" onClick={() => setActiveUnit('none')} 
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              className={`absolute top-full left-0 mt-2 z-[100] rounded-2xl bg-[#0a0a14] border border-white/10 shadow-2xl backdrop-blur-2xl overflow-hidden ${activeUnit === 'comment' ? 'w-[450px]' : 'w-72'}`}
            >
              <div className="p-4">
                {activeUnit === 'vote' && (
                  <div className="space-y-4">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">Vote Insight</p>
                    <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-center">
                        <div className="text-2xl font-black text-white mb-1">{totalVotes}</div>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Community Score</p>
                    </div>
                  </div>
                )}

                {activeUnit === 'comment' && (
                  <div className="max-h-[400px] flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Part Discussion</p>
                      <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full">{commentCount} comments</span>
                    </div>
                    <div className="overflow-y-auto scrollbar-hide pr-1">
                      <StoryComments partId={part.id} storyId={story.id} />
                    </div>
                  </div>
                )}

                {activeUnit === 'rating' && (
                  <div className="space-y-4">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Plot Complexity</p>
                    <div className="py-4 text-center rounded-xl bg-white/5 border border-white/5">
                      <div className="text-4xl font-black text-white glow-text-fuchsia mb-1" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                        {avgRating}
                      </div>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Average Reader Score</p>
                    </div>
                    <p className="text-xs text-slate-400 text-center leading-relaxed">
                      This score reflects how "unthinkable" readers found this specific plot development.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function PlotRating({ partId, authorId, existingRatings }: { partId: string; authorId: string; existingRatings?: number[] }) {
  const { user } = useAuth();
  const isAuthor = user?.uid === authorId;
  const [localRating, setLocalRating] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(`plot_twist_${partId}`);
    if (stored !== null) { setLocalRating(parseInt(stored)); setSubmitted(true); }
  }, [partId]);

  const handleSubmit = async (r: number) => {
    if (isAuthor || !user || submitted) return;
    try {
      await updateDoc(doc(db, 'whisper_story_parts', partId), {
        plotTwistRatings: [...(existingRatings || []), r],
      });
      localStorage.setItem(`plot_twist_${partId}`, String(r));
      setLocalRating(r);
      setSubmitted(true);
      toast.success('Your calculation added to the void.');
    } catch (err) { console.error(err); }
  };

  if (isAuthor || submitted) return null; // We'll show the result in the interaction bar pop-up instead of a permanent box if already submitted

  return (
    <div className="mt-4 p-6 rounded-2xl bg-[#080810] border border-fuchsia-500/20 backdrop-blur-xl relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
        <Sparkles size={64} className="text-fuchsia-500" />
      </div>

      <div className="relative z-10 mb-4">
        <h5 className="text-sm font-bold text-white mb-1 uppercase tracking-widest" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Calculate Complexity
        </h5>
        <p className="text-[11px] text-slate-500">How predictable was this development?</p>
      </div>

      <div className="relative z-10">
        <div className="flex flex-wrap gap-1.5 justify-between">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
            <button
              key={num}
              onClick={() => handleSubmit(num)}
              className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[10px] font-black text-slate-400 hover:bg-fuchsia-600 hover:border-fuchsia-500 hover:text-white transition-all transform hover:-translate-y-1 active:scale-95 shadow-lg"
            >
              {num}
            </button>
          ))}
        </div>
        <div className="flex justify-between mt-3 text-[9px] font-bold text-slate-600 uppercase tracking-widest px-1">
          <span>Obvious</span>
          <span>Mastermind</span>
        </div>
      </div>
    </div>
  );
}

export default function StoryView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [isStoryReportModalOpen, setIsStoryReportModalOpen] = useState(false);

  const [story, setStory] = useState<Story | null>(null);
  const [parts, setParts] = useState<StoryPart[]>([]);
  const [newPartTitle, setNewPartTitle] = useState('');
  const [newPartContent, setNewPartContent] = useState('');
  const [branchInputs, setBranchInputs] = useState(['', '', '']);
  const [useBranching, setUseBranching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  
  const [isFollowing, setIsFollowing] = useState(false);
  const [followId, setFollowId] = useState<string | null>(null);
  const [togglingFollow, setTogglingFollow] = useState(false);

  const [isLiked, setIsLiked] = useState(false);
  const [likeId, setLikeId] = useState<string | null>(null);
  const [togglingLike, setTogglingLike] = useState(false);

  // 1. Fetch Story Metadata
  useEffect(() => {
    if (!id || !user?.uid) return;
    
    // Use onSnapshot for story metadata too, for real-time follower/episodes/likes counts
    const unsub = onSnapshot(doc(db, 'whisper_stories', id), 
      (snap) => {
        if (snap.exists()) {
          setStory({ id: snap.id, ...snap.data() } as Story);
        } else {
          toast.error('Story not found');
          navigate('/whisper/stories');
        }
        setLoading(false);
      },
      (err) => {
        console.error('Story metadata listener error:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [id, user?.uid, navigate]);

  // 2. Real-time Parts Listener
  useEffect(() => {
    if (!id || !user?.uid) return;

    // Remove orderBy from query to avoid index issues and fix instant optimistic updates
    const q = query(
      collection(db, 'whisper_story_parts'), 
      where('storyId', '==', id)
    );

    const unsub = onSnapshot(q, 
      { includeMetadataChanges: true }, 
      (snap) => {
        const data = snap.docs.map(d => ({ 
          id: d.id, 
          ...d.data({ serverTimestamps: 'estimate' }) 
        })) as StoryPart[];
        
        // Sort locally by number
        data.sort((a, b) => (a.number || 0) - (b.number || 0));
        
        setParts(data);
        localStorage.setItem(`whisper_total_${id}`, String(data.length));
      },
      (err) => {
        console.error('Story parts listener error:', err);
      }
    );

    return () => unsub();
  }, [id, user?.uid]);

  useEffect(() => {
    if (!id || !user?.uid) return;
    const qFollow = query(collection(db, 'whisper_story_follows'), where('storyId', '==', id), where('userId', '==', user.uid));
    const unsubFollow = onSnapshot(qFollow, snap => {
      if (!snap.empty) {
        setIsFollowing(true);
        setFollowId(snap.docs[0].id);
      } else {
        setIsFollowing(false);
        setFollowId(null);
      }
    });

    const qLike = query(collection(db, 'whisper_story_likes'), where('storyId', '==', id), where('userId', '==', user.uid));
    const unsubLike = onSnapshot(qLike, snap => {
      if (!snap.empty) {
        setIsLiked(true);
        setLikeId(snap.docs[0].id);
      } else {
        setIsLiked(false);
        setLikeId(null);
      }
    });

    return () => {
      unsubFollow();
      unsubLike();
    };
  }, [id, user]);

  // Track reading progress
  useEffect(() => {
    if (parts.length > 0 && id) {
      localStorage.setItem(`whisper_progress_${id}`, String(parts.length));
    }
  }, [parts.length, id]);

  const handleVote = async (partId: string, type: 'up' | 'down') => {
    if (!user) return;
    const voteKey = `${partId}_${type}`;
    const otherType = type === 'up' ? 'down' : 'up';
    const otherVoteKey = `${partId}_${otherType}`;
    
    const hasVotedThis = votedIds.has(voteKey);
    const hasVotedOther = votedIds.has(otherVoteKey);

    // Optimistic Update
    setVotedIds(prev => {
      const next = new Set(prev);
      if (hasVotedThis) {
        next.delete(voteKey);
      } else {
        next.add(voteKey);
        if (hasVotedOther) next.delete(otherVoteKey);
      }
      return next;
    });

    try {
      const updates: any = {};
      const thisField = type === 'up' ? 'upvotes' : 'downvotes';
      const otherField = type === 'up' ? 'downvotes' : 'upvotes';

      if (hasVotedThis) {
        updates[thisField] = increment(-1);
      } else {
        updates[thisField] = increment(1);
        if (hasVotedOther) {
          updates[otherField] = increment(-1);
        }
      }

      await updateDoc(doc(db, 'whisper_story_parts', partId), updates);
    } catch (err) { 
      console.error(err); 
      // Rollback
      setVotedIds(prev => {
        const next = new Set(prev);
        if (hasVotedThis) {
          next.add(voteKey);
        } else {
          next.delete(voteKey);
          if (hasVotedOther) next.add(otherVoteKey);
        }
        return next;
      });
      toast.error('Failed to vote');
    }
  };

  const toggleFollow = async () => {
    if (!user || !story || togglingFollow) return;
    setTogglingFollow(true);
    try {
      if (isFollowing && followId) {
        await deleteDoc(doc(db, 'whisper_story_follows', followId));
        await updateDoc(doc(db, 'whisper_stories', story.id), { followers: increment(-1) });
      } else {
        await addDoc(collection(db, 'whisper_story_follows'), {
          storyId: story.id,
          userId: user.uid,
          createdAt: serverTimestamp()
        });
        await updateDoc(doc(db, 'whisper_stories', story.id), { followers: increment(1) });
      }
    } catch (e) { console.error(e); }
    finally { setTogglingFollow(false); }
  };

  const toggleLike = async () => {
    if (!user || !story || togglingLike) return;
    setTogglingLike(true);
    try {
      if (isLiked && likeId) {
        await deleteDoc(doc(db, 'whisper_story_likes', likeId));
        await updateDoc(doc(db, 'whisper_stories', story.id), { likes: increment(-1) });
      } else {
        await addDoc(collection(db, 'whisper_story_likes'), {
          storyId: story.id,
          userId: user.uid,
          createdAt: serverTimestamp()
        });
        await updateDoc(doc(db, 'whisper_stories', story.id), { likes: increment(1) });
      }
    } catch (e) { console.error(e); }
    finally { setTogglingLike(false); }
  };

  const handlePublishPart = async () => {
    if (!newPartContent.trim() || !user || !story || isSubmitting) return;
    if (containsInappropriateContent(newPartContent).matches) { toast.error('Keep it clean.'); return; }
    setIsSubmitting(true);
    try {
      const branchOptions = useBranching
        ? branchInputs.filter(b => b.trim()).map(b => ({ label: b.trim() }))
        : [];
      await addDoc(collection(db, 'whisper_story_parts'), {
        storyId: story.id,
        number: parts.length + 1,
        title: newPartTitle.trim(),
        content: newPartContent.trim(),
        createdAt: serverTimestamp(),
        upvotes: 0,
        downvotes: 0,
        plotTwistRatings: [],
        branchOptions,
      });
      await updateDoc(doc(db, 'whisper_stories', story.id), { episodes: increment(1) });

      // Notify followers
      const followsSnap = await getDocs(query(collection(db, 'whisper_story_follows'), where('storyId', '==', story.id)));
      const notificationPromises = followsSnap.docs.map(fDoc => {
        const followerId = fDoc.data().userId;
        if (followerId === user.uid) return Promise.resolve(); // Don't notify the author
        return addDoc(collection(db, 'notifications'), {
          user_id: followerId,
          type: 'whisper_update',
          title: `New episode in "${story.title}"`,
          message: `Part ${parts.length + 1} has been published by @${story.authorName}`,
          link: `/whisper/story/${story.id}`,
          read: false,
          created_at: serverTimestamp()
        });
      });
      await Promise.all(notificationPromises);

      setNewPartTitle(''); setNewPartContent('');
      setBranchInputs(['', '', '']); setUseBranching(false);
      toast.success('Part published!');
    } catch (err) { toast.error('Failed to publish.'); }
    finally { setIsSubmitting(false); }
  };

  const handleDeleteStory = async () => {
    if (!story || !id || !profile?.is_admin) return;
    if (!window.confirm('PERMANENTLY DELETE STORY? This removes all parts, comments, and interactions.')) return;

    try {
      setIsSubmitting(true);
      await deleteDoc(doc(db, 'whisper_stories', id));
      
      // Cleanup parts
      const partsQuery = query(collection(db, 'whisper_story_parts'), where('storyId', '==', id));
      const partsSnap = await getDocs(partsQuery);
      await Promise.all(partsSnap.docs.map(d => deleteDoc(d.ref)));

      toast.success('Story deleted');
      navigate('/whisper/stories');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete story');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePart = async (partId: string) => {
    if (!profile?.is_admin) return;
    if (!window.confirm('Delete this episode?')) return;

    try {
      await deleteDoc(doc(db, 'whisper_story_parts', partId));
      if (story) {
        await updateDoc(doc(db, 'whisper_stories', story.id), { episodes: increment(-1) });
      }
      toast.success('Part deleted');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete part');
    }
  };

  if (loading) return (
    <div className="flex justify-center items-center h-64">
      <div className="w-8 h-8 rounded-full border-2 border-fuchsia-500 border-t-transparent animate-spin" />
    </div>
  );
  if (!story) return null;

  const isAuthor = user?.uid === story.authorId;
  const progressPct = parts.length > 0 ? 100 : 0; // full read = 100%

  return (
    <div className="pb-24 relative">
      <QuoteHighlight storyTitle={story.title} />

      {/* Top progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-[3px]">
        <div
          className="h-full"
          style={{
            width: `${progressPct}%`,
            background: 'linear-gradient(90deg, #7c3aed, #0acffe)',
            boxShadow: '0 0 8px rgba(10,207,254,0.6)',
            transition: 'width 1s ease',
          }}
        />
      </div>

      {/* Back + Header */}
      <div className="flex items-start gap-3 mb-8">
        <button
          onClick={() => navigate('/whisper/stories')}
          className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all shrink-0 mt-1"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {story.tags?.map(tag => (
              <span key={tag} className="neon-tag neon-tag-purple">{tag}</span>
            ))}
          </div>
          <h1
            className="text-2xl sm:text-4xl font-black text-white leading-tight"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {story.title}
          </h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-slate-500 flex-wrap">
            <span className="flex items-center gap-2">By <span className="text-fuchsia-400 font-bold">@{story.authorName}</span>
              {user && user.uid !== story.authorId && (
                <>
                  <button onClick={toggleFollow} disabled={togglingFollow} className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all border ${isFollowing ? 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30 hover:bg-fuchsia-500/30' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}>
                    {isFollowing ? '✓ Following' : '+ Follow'}
                  </button>
                  <button 
                    onClick={toggleLike} 
                    disabled={togglingLike} 
                    className={`h-9 px-4 rounded-xl flex items-center gap-2 text-xs font-bold transition-all border shadow-[0_4px_12px_rgba(0,0,0,0.5)] ${isLiked ? 'bg-pink-500/20 text-pink-400 border-pink-500/40 hover:bg-pink-500/30' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}
                  >
                    <Heart size={14} className={isLiked ? 'fill-current' : ''} />
                    {isLiked ? 'Story Liked' : 'Like this Story'}
                    <span className="ml-1 opacity-60">· {story.likes || 0}</span>
                  </button>
                  <button 
                    onClick={() => setIsStoryReportModalOpen(true)}
                    className="h-9 px-4 rounded-xl flex items-center gap-2 text-xs font-bold transition-all border shadow-[0_4px_12px_rgba(0,0,0,0.5)] bg-white/5 text-slate-300 border-white/10 hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30"
                    title="Report Story"
                  >
                    <AlertTriangle size={14} />
                    Report
                  </button>
                  {profile?.is_admin && (
                    <button 
                      onClick={handleDeleteStory}
                      className="px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 border border-red-500/30 text-[10px] font-bold hover:bg-red-500/20 transition-all ml-1 flex items-center gap-1"
                    >
                      <Trash2 size={10} /> Delete
                    </button>
                  )}
                </>
              )}
            </span>
            <span className="flex items-center gap-1"><Users size={13} className="text-cyan-400" /> {story.followers} following</span>
            <span className="text-slate-700">·</span>
            <span className="text-slate-500">{parts.length} {parts.length === 1 ? 'part' : 'parts'}</span>
          </div>
        </div>
      </div>

      {/* Storyboard Layout */}
      <div className="storyboard-container space-y-16">
        {parts.length === 0 && (
          <div className="text-center py-16 text-slate-600 font-medium">
            No parts published yet. {isAuthor ? 'Write the first one below!' : 'Check back soon...'}
          </div>
        )}

        {parts.map((part, index) => (
            <motion.div
              key={part.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="storyboard-part"
              style={{ zIndex: parts.length - index }}
            >
            <div className="storyboard-number">{part.number}</div>

            <div className="story-card-premium">
                <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-fuchsia-500/30 to-transparent rounded-t-2xl" />

                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    Part {part.number}{part.title ? `: ${part.title}` : ''}
                  </h4>
                  {profile?.is_admin && (
                    <button
                      onClick={() => handleDeletePart(part.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-all"
                      title="Admin: Delete Part"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <p
                  className="text-slate-200 text-base leading-relaxed mb-6 whitespace-pre-wrap select-text"
                  style={{ fontFamily: "'Manrope', sans-serif", lineHeight: '1.85' }}
                >
                  {part.content}
                </p>

                {/* Multi-Interaction Bar (Reddit Style) */}
                <PartInteractionBar 
                  part={part} 
                  story={story} 
                  isAuthor={isAuthor}
                  votedIds={votedIds}
                  onVote={handleVote}
                />

                {/* Plot Rating (Internal Component for better organization) */}
                {/* We'll keep PlotRating but make it more premium */}
                <div className="mt-8">
                  <PlotRating partId={part.id} authorId={story.authorId} existingRatings={part.plotTwistRatings} />
                </div>

                {/* Branch Voting */}
                {part.branchOptions && part.branchOptions.length > 0 && id && (
                  <div className="mt-8">
                    <StoryBranchVote storyId={id} partId={part.id} options={part.branchOptions} />
                  </div>
                )}
            </div>
          </motion.div>
        ))}


        {/* Author Controls */}
        {isAuthor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="rounded-2xl border border-fuchsia-500/25 overflow-hidden"
            style={{ background: 'rgba(191,90,242,0.06)', backdropFilter: 'blur(16px)' }}
          >
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-fuchsia-500/50 to-transparent" />
            <div className="p-6">
              <div className="flex items-center gap-2 mb-5">
                <ShieldAlert size={16} className="text-fuchsia-400" />
                <span className="font-bold text-white text-sm" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  Author Controls — Publish Part {parts.length + 1}
                </span>
              </div>

              <input
                value={newPartTitle}
                onChange={e => setNewPartTitle(e.target.value)}
                placeholder={`Part ${parts.length + 1} title (optional)`}
                className="w-full bg-black/30 border border-white/8 rounded-xl px-4 py-2.5 text-white text-sm mb-3 outline-none focus:border-fuchsia-500/50 transition-colors placeholder-slate-600"
              />
              <textarea
                value={newPartContent}
                onChange={e => setNewPartContent(e.target.value)}
                placeholder="Write the next episode..."
                className="w-full bg-black/30 border border-white/8 rounded-xl px-4 py-3 text-slate-200 resize-none h-36 outline-none focus:border-fuchsia-500/50 transition-colors placeholder-slate-600 mb-4"
                style={{ fontFamily: "'Manrope', sans-serif" }}
              />

              {/* Branching options toggle */}
              <div className="mb-4">
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={useBranching}
                    onChange={e => setUseBranching(e.target.checked)}
                    className="w-4 h-4 accent-fuchsia-500"
                  />
                  <span className="text-sm text-slate-300 font-medium flex items-center gap-1.5">
                    <GitBranch size={14} className="text-fuchsia-400" />
                    Add community voting options (branching)
                  </span>
                </label>

                {useBranching && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-2 overflow-hidden"
                  >
                    {branchInputs.map((val, i) => (
                      <input
                        key={i}
                        value={val}
                        onChange={e => {
                          const next = [...branchInputs];
                          next[i] = e.target.value;
                          setBranchInputs(next);
                        }}
                        placeholder={`Option ${String.fromCharCode(65 + i)}: What happens next?`}
                        className="w-full bg-black/30 border border-white/8 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-fuchsia-500/40 transition-colors placeholder-slate-600"
                        maxLength={100}
                      />
                    ))}
                  </motion.div>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handlePublishPart}
                  disabled={!newPartContent.trim() || isSubmitting}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-40 transition-all"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #bf5af2)', boxShadow: '0 0 20px rgba(124,58,237,0.4)' }}
                >
                  {isSubmitting ? <span className="w-4 h-4 rounded-full border-2 border-white/50 border-t-transparent animate-spin" /> : <Send size={15} />}
                  Publish Part {parts.length + 1}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <ReportModal
        isOpen={isStoryReportModalOpen}
        onClose={() => setIsStoryReportModalOpen(false)}
        targetType="whisper_story"
        targetId={story?.id}
        storyId={story?.id}
      />
    </div>
  );
}
