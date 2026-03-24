import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send, Users, ShieldAlert, GitBranch, MessageCircle, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { db } from '../../lib/firebase';
import {
  doc, getDoc, collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, serverTimestamp, increment
} from 'firebase/firestore';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'sonner';
import { containsInappropriateContent } from '../../lib/filter';
import StoryBranchVote from './StoryBranchVote';

interface Story {
  id: string;
  title: string;
  authorName: string;
  authorId: string;
  followers: number;
  tags?: string[];
}

interface StoryPart {
  id: string;
  storyId: string;
  number: number;
  title: string;
  content: string;
  createdAt: any;
  reactions: { mindBlown: number; dark: number; genius: number; creepy: number };
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

function PartCommentSection({ partId, profile }: { partId: string; profile: any }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<PartComment[]>([]);
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const q = query(
      collection(db, 'whisper_story_comments'),
      where('partId', '==', partId),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, snap => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })) as PartComment[]);
    });
    return () => unsub();
  }, [partId, expanded]);

  const submit = async () => {
    if (!text.trim() || !user) return;
    if (containsInappropriateContent(text).matches) { toast.error('Keep it clean.'); return; }
    await addDoc(collection(db, 'whisper_story_comments'), {
      partId,
      content: text.trim(),
      authorName: profile?.anonymous_username || 'Anonymous',
      authorId: user.uid,
      createdAt: serverTimestamp(),
    });
    setText('');
  };

  return (
    <div className="mt-4 border-t border-white/5 pt-4">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors"
      >
        <MessageCircle size={13} />
        {expanded ? 'Hide' : 'Show'} comments
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 overflow-hidden"
          >
            <div className="space-y-2 mb-3 max-h-48 overflow-y-auto scrollbar-hide">
              {comments.length === 0 && (
                <p className="text-xs text-slate-600 italic pl-1">No comments yet. Be the first...</p>
              )}
              {comments.map(c => (
                <div key={c.id} className="whisper-comment text-xs">
                  <span className="font-bold text-slate-400">@{c.authorName}</span>
                  <span className="text-slate-600 ml-1.5 text-[10px]">{timeAgo(c.createdAt)}</span>
                  <p className="text-slate-300 mt-0.5">{c.content}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                placeholder="Comment on this part..."
                className="flex-1 bg-white/4 border border-white/8 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 outline-none focus:border-fuchsia-500/40 transition-colors"
                maxLength={200}
              />
              <button
                onClick={submit}
                disabled={!text.trim()}
                className="w-8 h-8 rounded-lg bg-fuchsia-500/20 border border-fuchsia-500/20 flex items-center justify-center text-fuchsia-400 hover:bg-fuchsia-500/30 disabled:opacity-40 transition-all"
              >
                <Send size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
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

function PlotTwistRating({ partId, existingRatings }: { partId: string; existingRatings?: number[] }) {
  const { user } = useAuth();
  const [localRating, setLocalRating] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(`plot_twist_${partId}`);
    if (stored !== null) { setLocalRating(parseInt(stored)); setSubmitted(true); }
  }, [partId]);

  const avg = existingRatings && existingRatings.length > 0
    ? (existingRatings.reduce((a, b) => a + b, 0) / existingRatings.length).toFixed(1)
    : null;

  const handleSubmit = async () => {
    if (localRating === null || !user || submitted) return;
    try {
      await updateDoc(doc(db, 'whisper_story_parts', partId), {
        plotTwistRatings: [...(existingRatings || []), localRating],
      });
      localStorage.setItem(`plot_twist_${partId}`, String(localRating));
      setSubmitted(true);
      toast.success('Plot Twist Rating saved!');
    } catch (err) { console.error(err); }
  };

  return (
    <div className="mt-4 p-4 rounded-xl bg-white/3 border border-white/6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">🌀 Plot Twist Rating</span>
        {avg && <span className="text-sm font-black text-fuchsia-400">{avg}/10</span>}
      </div>
      {!submitted ? (
        <div className="space-y-2">
          <input
            type="range" min={1} max={10}
            value={localRating ?? 5}
            onChange={e => setLocalRating(parseInt(e.target.value))}
            className="plot-twist-slider"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600">Predictable</span>
            <span className="text-sm font-bold text-white">{localRating ?? 5} / 10</span>
            <span className="text-xs text-slate-600">Mind-bending</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={localRating === null}
            className="w-full py-1.5 rounded-lg text-xs font-bold text-fuchsia-300 border border-fuchsia-500/30 hover:bg-fuchsia-500/10 transition-all disabled:opacity-40"
          >
            Rate this part
          </button>
        </div>
      ) : (
        <div className="text-center py-1">
          <span className="text-xs text-slate-500">
            Your rating: <span className="text-fuchsia-400 font-bold">{localRating}/10</span>
            {avg && ` · Community avg: ${avg}/10`}
          </span>
        </div>
      )}
    </div>
  );
}

export default function StoryView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [story, setStory] = useState<Story | null>(null);
  const [parts, setParts] = useState<StoryPart[]>([]);
  const [newPartTitle, setNewPartTitle] = useState('');
  const [newPartContent, setNewPartContent] = useState('');
  const [branchInputs, setBranchInputs] = useState(['', '', '']);
  const [useBranching, setUseBranching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reactedIds, setReactedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!id) return;
    (async () => {
      const snap = await getDoc(doc(db, 'whisper_stories', id));
      if (snap.exists()) setStory({ id: snap.id, ...snap.data() } as Story);
      else { toast.error('Story not found'); navigate('/whisper/stories'); }
      setLoading(false);
    })();

    const q = query(collection(db, 'whisper_story_parts'), where('storyId', '==', id), orderBy('number', 'asc'));
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as StoryPart[];
      setParts(data);
      // Store total for progress tracking
      localStorage.setItem(`whisper_total_${id}`, String(data.length));
    });
    return () => unsub();
  }, [id, navigate]);

  // Track reading progress
  useEffect(() => {
    if (parts.length > 0 && id) {
      localStorage.setItem(`whisper_progress_${id}`, String(parts.length));
    }
  }, [parts.length, id]);

  const handleReaction = async (partId: string, key: string) => {
    if (!user || reactedIds.has(`${partId}_${key}`)) return;
    setReactedIds(prev => new Set(prev).add(`${partId}_${key}`));
    try {
      await updateDoc(doc(db, 'whisper_story_parts', partId), {
        [`reactions.${key}`]: increment(1),
      });
    } catch (err) { console.error(err); }
  };

  const handlePublishPart = async () => {
    if (!newPartContent.trim() || !user || !story) return;
    if (containsInappropriateContent(newPartContent).matches) { toast.error('Keep it clean.'); return; }
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
        reactions: { mindBlown: 0, dark: 0, genius: 0, creepy: 0 },
        plotTwistRatings: [],
        branchOptions,
      });
      await updateDoc(doc(db, 'whisper_stories', story.id), { episodes: increment(1) });
      setNewPartTitle(''); setNewPartContent('');
      setBranchInputs(['', '', '']); setUseBranching(false);
      toast.success('Part published!');
    } catch (err) { toast.error('Failed to publish.'); }
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
          <div className="flex items-center gap-3 mt-2 text-sm text-slate-500">
            <span>By <span className="text-fuchsia-400 font-bold">@{story.authorName}</span></span>
            <span className="flex items-center gap-1"><Users size={13} className="text-cyan-400" /> {story.followers} following</span>
            <span className="text-slate-700">·</span>
            <span className="text-slate-500">{parts.length} {parts.length === 1 ? 'part' : 'parts'}</span>
          </div>
        </div>
      </div>

      {/* Parts Timeline */}
      <div className="max-w-2xl mx-auto space-y-10">
        {parts.length === 0 && (
          <div className="text-center py-16 text-slate-600 font-medium">
            No parts published yet. {isAuthor ? 'Write the first one below!' : 'Check back soon...'}
          </div>
        )}

        {parts.map((part, index) => (
          <motion.div
            key={part.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            className="relative"
          >
            {/* Timeline connector */}
            {index < parts.length - 1 && (
              <div className="absolute left-5 top-14 bottom-[-2.5rem] w-[2px] bg-gradient-to-b from-fuchsia-500/30 via-purple-500/15 to-transparent z-0" />
            )}

            <div className="flex gap-4 relative z-10">
              {/* Episode number bubble */}
              <div className="w-10 h-10 rounded-full border-2 border-fuchsia-500/40 bg-fuchsia-500/15 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(191,90,242,0.25)]">
                <span className="text-fuchsia-300 font-black text-sm">{part.number}</span>
              </div>

              <div className="flex-1 whisper-card p-6">
                <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-fuchsia-500/30 to-transparent rounded-t-2xl" />

                <h4 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  Part {part.number}{part.title ? `: ${part.title}` : ''}
                </h4>

                <p
                  className="text-slate-200 text-base leading-relaxed mb-6 whitespace-pre-wrap select-text"
                  style={{ fontFamily: "'Manrope', sans-serif", lineHeight: '1.85' }}
                >
                  {part.content}
                </p>

                {/* Emoji Reactions */}
                <div className="flex flex-wrap gap-2 pt-4 border-t border-white/5">
                  {REACTIONS.map(r => {
                    const count = part.reactions?.[r.key as keyof typeof part.reactions] ?? 0;
                    const reacted = reactedIds.has(`${part.id}_${r.key}`);
                    return (
                      <button
                        key={r.key}
                        onClick={() => handleReaction(part.id, r.key)}
                        className={`reaction-btn ${reacted ? 'reacted' : ''}`}
                        title={r.label}
                      >
                        <span className="emoji">{r.emoji}</span>
                        <span>{count}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Plot Twist Rating */}
                <PlotTwistRating partId={part.id} existingRatings={part.plotTwistRatings} />

                {/* Branch Voting */}
                {part.branchOptions && part.branchOptions.length > 0 && id && (
                  <StoryBranchVote storyId={id} partId={part.id} options={part.branchOptions} />
                )}

                {/* Inline Comments */}
                <PartCommentSection partId={part.id} profile={profile} />
              </div>
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
                  disabled={!newPartContent.trim()}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-40 transition-all"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #bf5af2)', boxShadow: '0 0 20px rgba(124,58,237,0.4)' }}
                >
                  <Send size={15} />
                  Publish Part {parts.length + 1}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
