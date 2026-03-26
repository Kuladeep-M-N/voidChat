import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, ChevronDown, ChevronUp, Send, CornerDownRight, Trash2, AlertTriangle } from 'lucide-react';
import ReportModal from '../ReportModal';
import { db } from '../../lib/firebase';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, increment, deleteDoc
} from 'firebase/firestore';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'sonner';
import { containsInappropriateContent } from '../../lib/filter';

interface Comment {
  id: string;
  partId?: string;
  storyId: string;
  parentId: string | null;
  content: string;
  authorName: string;
  authorId: string;
  createdAt: any;
  likes: number;
}

function timeAgo(date: any) {
  if (!date) return 'just now';
  const d = date?.toDate ? date.toDate() : new Date(date);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (isNaN(diff) || diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface CommentItemProps {
  comment: Comment;
  allComments: Comment[];
  depth: number;
  onReply: (id: string, name: string) => void;
  onLike: (id: string) => void;
  onDelete: (id: string) => void;
  likedIds: Set<string>;
  isAdmin?: boolean;
}

function CommentItem({ comment, allComments, depth, onReply, onLike, onDelete, likedIds, isAdmin }: CommentItemProps) {
  const [expanded, setExpanded] = useState(true);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const replies = allComments.filter(c => c.parentId === comment.id);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="mt-2"
      style={{ marginLeft: depth > 0 ? `${Math.min(depth * 14, 40)}px` : 0 }}
    >
      <div className={`${depth > 0 ? 'whisper-comment-nested' : 'whisper-comment'}`}>
        <div className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-full bg-fuchsia-500/20 flex items-center justify-center shrink-0 text-[10px] font-bold text-fuchsia-300 border border-fuchsia-500/20 mt-0.5">
            {comment.authorName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-slate-300">@{comment.authorName}</span>
              <span className="text-[10px] text-slate-600">{timeAgo(comment.createdAt)}</span>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed break-words">{comment.content}</p>
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={() => onLike(comment.id)}
                className={`flex items-center gap-1 text-[11px] font-semibold transition-colors ${likedIds.has(comment.id) ? 'text-fuchsia-400' : 'text-slate-500 hover:text-slate-300'}`}
              >
                ♥ {comment.likes || 0}
              </button>
              <button
                onClick={() => onReply(comment.id, comment.authorName)}
                className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-cyan-400 transition-colors"
              >
                <CornerDownRight size={11} /> Reply
              </button>
              <button
                onClick={() => setIsReportModalOpen(true)}
                className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-amber-400 transition-colors"
                title="Report Comment"
              >
                <AlertTriangle size={11} /> Report
              </button>
              {replies.length > 0 && (
                <button
                  onClick={() => setExpanded(e => !e)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-300 transition-colors ml-auto"
                >
                  {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => onDelete(comment.id)}
                  className="text-[11px] font-semibold text-slate-600 hover:text-red-400 transition-colors ml-1"
                  title="Admin: Delete Comment"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recursive Nested replies */}
      {expanded && replies.length > 0 && (
        <div className="mt-1 space-y-1">
          {replies.map(reply => (
            <CommentItem
              key={reply.id}
              comment={reply}
              allComments={allComments}
              depth={depth + 1}
              onReply={onReply}
              onLike={onLike}
              onDelete={onDelete}
              likedIds={likedIds}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        targetType="whisper_story_comment"
        targetId={comment.id}
        storyId={comment.storyId}
      />
    </motion.div>
  );
}

interface StoryCommentsProps {
  partId?: string;
  storyId: string;
  onCommentCountChange?: (count: number) => void;
}

export default function StoryComments({ partId, storyId, onCommentCountChange }: StoryCommentsProps) {
  const { user, profile } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, 'whisper_story_comments'),
      partId ? where('partId', '==', partId) : where('storyId', '==', storyId)
    );
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Comment[];
      
      // Sort locally by date
      data.sort((a, b) => {
        const t1 = a.createdAt?.toMillis?.() || Date.now();
        const t2 = b.createdAt?.toMillis?.() || Date.now();
        return t1 - t2;
      });

      setComments(data);
      if (onCommentCountChange) onCommentCountChange(data.length);
    });
    return () => unsub();
  }, [partId, storyId, onCommentCountChange, user?.uid]);

  const handleDeleteComment = async (commentId: string) => {
    if (!profile?.is_admin) return;
    if (!window.confirm('Delete this comment?')) return;

    try {
      await deleteDoc(doc(db, 'whisper_story_comments', commentId));
      toast.success('Comment removed');
    } catch (err) {
      toast.error('Failed to remove comment');
    }
  };

  const handleSubmit = async () => {
    if (!text.trim() || !user || submitting) return;
    if (containsInappropriateContent(text).matches) {
      toast.error('Keep it clean in the void.');
      return;
    }
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'whisper_story_comments'), {
        partId: partId || null,
        storyId,
        parentId: replyingTo?.id || null,
        content: text.trim(),
        authorName: user.displayName || profile?.anonymous_username || 'Void Reader',
        authorId: user.uid,
        likes: 0,
        createdAt: serverTimestamp(),
      });
      setText('');
      setReplyingTo(null);
    } catch (err) {
      toast.error('Failed to post comment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLike = async (commentId: string) => {
    if (!user || likedIds.has(commentId)) return;
    setLikedIds(prev => new Set(prev).add(commentId));
    await updateDoc(doc(db, 'whisper_story_comments', commentId), {
      likes: increment(1),
    });
  };

  const rootComments = comments.filter(c => !c.parentId);

  return (
    <div className="mt-2">
      {/* Comment input */}
      <div className="flex gap-2 items-start">
        <div className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/20 flex items-center justify-center shrink-0 mt-1 text-[10px] font-bold text-purple-300">
          {(user?.displayName || profile?.anonymous_username || 'V').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 relative">
          {replyingTo && (
            <div className="flex items-center gap-1 text-[11px] text-cyan-400 mb-1 font-semibold">
              <CornerDownRight size={11} /> Replying to @{replyingTo.name}
              <button onClick={() => setReplyingTo(null)} className="ml-1 text-slate-500 hover:text-white">✕</button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
              placeholder={replyingTo ? `Reply to @${replyingTo.name}...` : 'Add a comment...'}
              className="flex-1 bg-white/5 border border-white/8 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-fuchsia-500/40 transition-colors"
              maxLength={300}
            />
            <button
              onClick={handleSubmit}
              disabled={!text.trim() || submitting}
              className="w-9 h-9 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/30 flex items-center justify-center text-fuchsia-400 hover:bg-fuchsia-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Comments list */}
      <AnimatePresence>
        <div className="mt-3 space-y-1">
          {rootComments.map(comment => (
            <CommentItem
              key={comment.id}
              comment={comment}
              allComments={comments}
              depth={0}
              onReply={(id, name) => setReplyingTo({ id, name })}
              onLike={handleLike}
              onDelete={handleDeleteComment}
              likedIds={likedIds}
              isAdmin={profile?.is_admin}
            />
          ))}
        </div>
      </AnimatePresence>
    </div>
  );
}
