import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Flame, MessageCircle, ArrowUp, Send, Network } from 'lucide-react';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, increment } from 'firebase/firestore';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'sonner';
import { containsInappropriateContent } from '../../lib/filter';

interface Theory {
  id: string;
  content: string;
  authorName: string;
  authorId: string;
  upvotes: number;
  comments: number;
  createdAt: any;
}

export default function TheoriesTab() {
  const [theories, setTheories] = useState<Theory[]>([]);
  const [newTheory, setNewTheory] = useState('');
  const { user, profile } = useAuth();
  const [upvotedIds, setUpvotedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const q = query(collection(db, 'whisper_theories'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Theory[];
      
      // Sort by a mix of recent and hot
      data.sort((a, b) => {
         const scoreA = a.upvotes + (a.comments * 2);
         const scoreB = b.upvotes + (b.comments * 2);
         return scoreB - scoreA;
      });
      
      setTheories(data);
    });
    return () => unsubscribe();
  }, []);

  const handlePost = async () => {
    if (!newTheory.trim() || !user) return;
    
    if (containsInappropriateContent(newTheory).matches) {
       toast.error("Keep it clean in the void.");
       return;
    }

    try {
      await addDoc(collection(db, 'whisper_theories'), {
        content: newTheory.trim(),
        authorName: profile?.anonymous_username || 'Anonymous',
        authorId: user.uid,
        upvotes: 0,
        comments: 0,
        createdAt: serverTimestamp()
      });
      setNewTheory('');
      toast.success('Theory dropped.');
    } catch(err) {
      toast.error('Failed to post theory.');
      console.error(err);
    }
  };

  const handleUpvote = async (theoryId: string) => {
    if (!user || upvotedIds.has(theoryId)) return;
    try {
      setUpvotedIds(prev => new Set(prev).add(theoryId));
      await updateDoc(doc(db, 'whisper_theories', theoryId), {
        upvotes: increment(1)
      });
    } catch (err) {
      console.error(err);
    }
  };

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

  return (
    <div className="p-6 md:p-8 flex flex-col h-full bg-[#070d1f]">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30">
          <Network className="text-cyan-400" size={20} />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white font-['Manrope']">Theories</h2>
          <p className="text-sm text-cyan-400/80">Connect the dots. Uncover the truth.</p>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-8 backdrop-blur-xl relative z-10 focus-within:border-cyan-500/50 focus-within:shadow-[0_0_30px_rgba(6,182,212,0.1)] transition-all">
        <textarea
          value={newTheory}
          onChange={(e) => setNewTheory(e.target.value)}
          placeholder="Drop a theory... What's really going on?"
          className="w-full bg-transparent border-none outline-none text-white placeholder-slate-500 resize-none h-20 text-lg font-medium"
        />
        <div className="flex justify-between items-center mt-2 border-t border-white/5 pt-3">
          <span className="text-xs text-slate-500 font-medium tracking-wide uppercase">Anonymous Submission • @{profile?.anonymous_username}</span>
          <button 
            onClick={handlePost}
            disabled={!newTheory.trim()}
            className="bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-all"
          >
            <Send size={16} />
            Post
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {theories.length === 0 && (
           <div className="text-center py-10 text-slate-500 font-bold">No theories yet. Start the conspiracy.</div>
        )}
        {theories.map((theory, i) => (
          <motion.div
            key={theory.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 }}
            className="p-5 rounded-2xl bg-[#0c1326] border border-[#1c253e] hover:border-cyan-500/20 transition-colors"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
              <span className="text-sm font-bold text-slate-300">@{theory.authorName}</span>
              <span className="text-xs text-slate-500 ml-auto">{timeAgo(theory.createdAt)}</span>
            </div>
            
            <p className="text-slate-200 text-lg leading-relaxed mb-5 font-['Inter'] whitespace-pre-wrap">
               "{theory.content}"
            </p>
            
            <div className="flex items-center gap-4 border-t border-white/5 pt-4">
              <button 
                onClick={() => handleUpvote(theory.id)}
                className={`flex items-center gap-1.5 text-sm font-bold transition-colors bg-white/5 px-3 py-1.5 rounded-lg border hover:border-cyan-500/20 ${upvotedIds.has(theory.id) ? 'text-cyan-400 border-cyan-500/30' : 'text-slate-400 border-transparent hover:text-cyan-400'}`}
              >
                <ArrowUp size={16} />
                {theory.upvotes}
              </button>
              <button disabled className="flex items-center opacity-50 cursor-not-allowed gap-1.5 text-sm font-bold text-slate-400 transition-colors bg-white/5 px-3 py-1.5 rounded-lg border border-transparent">
                <MessageCircle size={16} />
                {theory.comments || 0} Discuss (Soon)
              </button>
              {(theory.upvotes > 5) && (
                <div className="ml-auto text-amber-500/70 hover:text-amber-400 cursor-pointer flex items-center gap-1 text-xs font-bold uppercase tracking-widest">
                  <Flame size={14} /> Hot
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
