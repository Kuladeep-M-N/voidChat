import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitBranch, CheckCircle2 } from 'lucide-react';
import { db } from '../../lib/firebase';
import {
  collection, query, where, onSnapshot,
  addDoc, serverTimestamp, updateDoc, doc
} from 'firebase/firestore';
import { useAuth } from '../../hooks/useAuth';

interface BranchOption {
  label: string;
  icon?: string;
}

interface StoryBranchVoteProps {
  storyId: string;
  partId: string;
  options: BranchOption[];
}

interface Vote {
  id: string;
  partId: string;
  optionIndex: number;
  userId: string;
}

export default function StoryBranchVote({ storyId, partId, options }: StoryBranchVoteProps) {
  const { user } = useAuth();
  const [votes, setVotes] = useState<Vote[]>([]);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'whisper_branch_votes'),
      where('partId', '==', partId)
    );
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Vote[];
      setVotes(data);
      if (user) {
        const mine = data.find(v => v.userId === user.uid);
        if (mine) setMyVote(mine.optionIndex);
      }
    });
    return () => unsub();
  }, [partId, user]);

  // Also check localStorage for voted state
  useEffect(() => {
    const stored = localStorage.getItem(`branch_vote_${partId}`);
    if (stored !== null) setMyVote(parseInt(stored));
  }, [partId]);

  const handleVote = async (optionIndex: number) => {
    if (!user || voting) return;
    if (myVote === optionIndex) return; // Ignore if clicking same option
    
    setVoting(true);
    try {
      if (myVote !== null) {
        // Find existing vote doc
        const myVoteDoc = votes.find(v => v.userId === user.uid);
        if (myVoteDoc) {
          await updateDoc(doc(db, 'whisper_branch_votes', myVoteDoc.id), { optionIndex });
        }
      } else {
        await addDoc(collection(db, 'whisper_branch_votes'), {
          storyId,
          partId,
          optionIndex,
          userId: user.uid,
          createdAt: serverTimestamp(),
        });
      }
      setMyVote(optionIndex);
      localStorage.setItem(`branch_vote_${partId}`, String(optionIndex));
    } catch (err) {
      console.error(err);
    } finally {
      setVoting(false);
    }
  };

  const totalVotes = votes.length;
  const getCount = (idx: number) => votes.filter(v => v.optionIndex === idx).length;
  const getPct = (idx: number) => totalVotes === 0 ? 0 : Math.round((getCount(idx) / totalVotes) * 100);

  const ICONS = ['🔘', '🔘', '🔘'];
  const optionLetters = ['A', 'B', 'C'];

  return (
    <div className="mt-5 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-950/20 p-5 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-4">
        <GitBranch size={16} className="text-fuchsia-400" />
        <span className="text-sm font-bold text-fuchsia-300 uppercase tracking-wider">Choose What Happens Next</span>
        {myVote !== null && (
          <span className="ml-auto text-xs text-slate-500 font-medium">{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</span>
        )}
      </div>

      <div className="space-y-2.5">
        {options.map((opt, idx) => {
          const isVoted = myVote === idx;
          const hasVoted = myVote !== null;
          const pct = hasVoted ? getPct(idx) : 0;

          return (
            <AnimatePresence key={idx} mode="wait">
              {!hasVoted ? (
                <motion.button
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.08 }}
                  className={`branch-option ${isVoted ? 'voted' : ''}`}
                  onClick={() => handleVote(idx)}
                  disabled={voting}
                >
                  <span className="w-6 h-6 rounded-full border border-white/20 text-xs font-bold text-slate-400 flex items-center justify-center shrink-0">
                    {optionLetters[idx]}
                  </span>
                  <span className="flex-1">{opt.label}</span>
                </motion.button>
              ) : (
                <motion.div
                  key={`voted-${idx}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => handleVote(idx)}
                  className={`flex flex-col gap-1.5 p-3 rounded-xl border transition-all cursor-pointer hover:border-white/20 ${isVoted ? 'border-fuchsia-500/40 bg-fuchsia-500/10' : 'border-white/5 bg-white/3'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center shrink-0 ${isVoted ? 'border-fuchsia-500/50 text-fuchsia-300' : 'border-white/15 text-slate-500'}`}>
                      {isVoted ? <CheckCircle2 size={14} className="text-fuchsia-400" /> : optionLetters[idx]}
                    </span>
                    <span className={`flex-1 text-sm font-medium ${isVoted ? 'text-fuchsia-200' : 'text-slate-400'}`}>{opt.label}</span>
                    <span className={`text-xs font-bold ${isVoted ? 'text-fuchsia-300' : 'text-slate-500'}`}>{pct}%</span>
                  </div>
                  <div className="branch-vote-bar ml-8">
                    <motion.div
                      className="branch-vote-fill"
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut', delay: idx * 0.1 }}
                      style={{
                        background: isVoted
                          ? 'linear-gradient(90deg, #7c3aed, #bf5af2)'
                          : 'rgba(255,255,255,0.15)',
                      }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          );
        })}
      </div>
    </div>
  );
}
