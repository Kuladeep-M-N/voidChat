import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, MessageCircle, ArrowUp, Send, Network, Hash, ChevronDown, ChevronUp } from 'lucide-react';
import { db } from '../../lib/firebase';
import {
  collection, query, orderBy, onSnapshot, addDoc,
  updateDoc, doc, serverTimestamp, increment
} from 'firebase/firestore';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'sonner';
import { containsInappropriateContent } from '../../lib/filter';
import TheoryComments from './TheoryComments';

interface Theory {
  id: string;
  content: string;
  authorName: string;
  authorId: string;
  upvotes: number;
  comments: number;
  tags: string[];
  createdAt: any;
}

const THEORY_TAGS = [
  { label: '#conspiracy',    style: 'neon-tag neon-tag-red' },
  { label: '#mind-bending',  style: 'neon-tag neon-tag-purple' },
  { label: '#dark',          style: 'neon-tag neon-tag-pink' },
  { label: '#sci-fi',        style: 'neon-tag neon-tag-cyan' },
  { label: '#psychology',    style: 'neon-tag neon-tag-amber' },
  { label: '#occult',        style: 'neon-tag neon-tag-red' },
];

const TAG_STYLE_MAP: Record<string, string> = {
  '#conspiracy':  'neon-tag neon-tag-red',
  '#mind-bending':'neon-tag neon-tag-purple',
  '#dark':        'neon-tag neon-tag-pink',
  '#sci-fi':      'neon-tag neon-tag-cyan',
  '#psychology':  'neon-tag neon-tag-amber',
  '#occult':      'neon-tag neon-tag-red',
};

function timeAgo(date: any) {
  if (!date) return 'just now';
  const d = date?.toDate ? date.toDate() : new Date(date);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (isNaN(diff) || diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function TheoriesTab() {
  const [theories, setTheories] = useState<Theory[]>([]);
  const [newTheory, setNewTheory] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [upvotedIds, setUpvotedIds] = useState<Set<string>>(new Set());
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const { user, profile } = useAuth();

  useEffect(() => {
    const q = query(collection(db, 'whisper_theories'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Theory[];
      data.sort((a, b) => {
        const sa = a.upvotes + (a.comments * 2);
        const sb = b.upvotes + (b.comments * 2);
        return sb - sa;
      });
      setTheories(data);
    });
    return () => unsub();
  }, []);

  const handlePost = async () => {
    if (!newTheory.trim() || !user) return;
    if (containsInappropriateContent(newTheory).matches) { toast.error('Keep it clean.'); return; }
    try {
      const tags = selectedTags.length > 0 ? selectedTags : ['#mind-bending'];
      await addDoc(collection(db, 'whisper_theories'), {
        content: newTheory.trim(),
        authorName: profile?.anonymous_username || 'Anonymous',
        authorId: user.uid,
        upvotes: 0,
        comments: 0,
        tags,
        createdAt: serverTimestamp(),
      });
      setNewTheory('');
      setSelectedTags([]);
      toast.success('Theory dropped.');
    } catch (err) {
      toast.error('Failed to post theory.');
    }
  };

  const handleUpvote = async (id: string) => {
    if (!user || upvotedIds.has(id)) return;
    setUpvotedIds(prev => new Set(prev).add(id));
    await updateDoc(doc(db, 'whisper_theories', id), { upvotes: increment(1) });
  };

  const toggleTag = (tag: string) =>
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : prev.length < 2 ? [...prev, tag] : prev
    );

  const toggleComments = (id: string) =>
    setExpandedComments(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const updateCommentCount = useCallback((theoryId: string, count: number) => {
    setCommentCounts(prev => ({ ...prev, [theoryId]: count }));
  }, []);

  const filtered = activeFilter
    ? theories.filter(t => t.tags?.includes(activeFilter))
    : theories;

  const hot = filtered.filter(t => t.upvotes > 3 || t.comments > 2);

  return (
    <div className="pb-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center">
          <Network className="text-cyan-400" size={20} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Theories</h2>
          <p className="text-xs text-cyan-400/70" style={{ fontFamily: "'Manrope', sans-serif" }}>Connect the dots. Uncover the truth.</p>
        </div>
      </div>

      {/* Compose Box */}
      <div
        className="rounded-2xl border border-white/8 p-5 mb-6 transition-all focus-within:border-cyan-500/40"
        style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(16px)' }}
      >
        <textarea
          value={newTheory}
          onChange={e => setNewTheory(e.target.value)}
          placeholder="Drop a theory... What's really going on?"
          className="w-full bg-transparent border-none outline-none text-white placeholder-slate-600 resize-none h-20 text-base"
          style={{ fontFamily: "'Manrope', sans-serif" }}
        />

        {/* Tag picker */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {THEORY_TAGS.map(t => (
            <button
              key={t.label}
              onClick={() => toggleTag(t.label)}
              className={`${t.style} ${selectedTags.includes(t.label) ? 'active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex justify-between items-center border-t border-white/5 pt-3">
          <span className="text-xs text-slate-600 font-medium">@{profile?.anonymous_username || 'Anonymous'}</span>
          <button
            onClick={handlePost}
            disabled={!newTheory.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm disabled:opacity-40 transition-all"
            style={{ background: 'linear-gradient(135deg, #0891b2, #06cefd)', color: '#050505' }}
          >
            <Send size={14} />
            Drop Theory
          </button>
        </div>
      </div>

      {/* Tag filter bar */}
      <div className="flex gap-1.5 mb-6 overflow-x-auto scrollbar-hide">
        <button
          onClick={() => setActiveFilter(null)}
          className={`neon-tag whitespace-nowrap ${!activeFilter ? 'neon-tag-cyan active' : 'neon-tag-cyan'}`}
        >
          All
        </button>
        {THEORY_TAGS.map(t => (
          <button
            key={t.label}
            onClick={() => setActiveFilter(activeFilter === t.label ? null : t.label)}
            className={`${t.style} whitespace-nowrap ${activeFilter === t.label ? 'active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Theory list */}
      {filtered.length === 0 && (
        <div className="text-center py-20 text-slate-600 font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          No theories yet. Start the conspiracy.
        </div>
      )}

      <div className="space-y-4">
        {filtered.map((theory, i) => {
          const isHot = theory.upvotes > 3 || theory.comments > 2;
          const commentExpanded = expandedComments.has(theory.id);
          const liveCommentCount = commentCounts[theory.id] ?? theory.comments;

          return (
            <motion.div
              key={theory.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className={`whisper-card whisper-card-glow-cyan relative overflow-hidden ${isHot ? 'border-cyan-500/20' : ''}`}
            >
              {isHot && (
                <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/60 to-transparent" />
              )}
              <div className="p-5">
                {/* Author + time */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-full bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center text-[11px] font-bold text-cyan-300">
                    {theory.authorName.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-bold text-slate-300">@{theory.authorName}</span>
                  {isHot && (
                    <span className="ml-1 flex items-center gap-1 neon-tag neon-tag-amber">
                      <Flame size={9} /> Hot
                    </span>
                  )}
                  <span className="text-xs text-slate-600 ml-auto">{timeAgo(theory.createdAt)}</span>
                </div>

                {/* Tags */}
                {theory.tags && theory.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {theory.tags.map(tag => (
                      <span key={tag} className={TAG_STYLE_MAP[tag] || 'neon-tag neon-tag-purple'}>{tag}</span>
                    ))}
                  </div>
                )}

                {/* Content */}
                <p
                  className="text-slate-200 text-base leading-relaxed mb-4"
                  style={{ fontFamily: "'Manrope', sans-serif" }}
                >
                  "{theory.content}"
                </p>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-3 border-t border-white/5">
                  <button
                    onClick={() => handleUpvote(theory.id)}
                    className={`reaction-btn ${upvotedIds.has(theory.id) ? 'reacted' : ''}`}
                  >
                    <span className="emoji">▲</span>
                    <span>{theory.upvotes}</span>
                  </button>

                  <button
                    onClick={() => toggleComments(theory.id)}
                    className="reaction-btn"
                  >
                    <span className="emoji"><MessageCircle size={14} /></span>
                    <span>{liveCommentCount}</span>
                    {commentExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>

                {/* Nested comment section */}
                <AnimatePresence>
                  {commentExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <TheoryComments
                        theoryId={theory.id}
                        onCommentCountChange={(count) => updateCommentCount(theory.id, count)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
