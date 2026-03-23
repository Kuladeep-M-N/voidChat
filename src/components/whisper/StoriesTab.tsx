import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, User, Users, ChevronRight, PenTool, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
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
  tags: string[];
  color: string;
}

const COLORS = [
  "from-blue-500/20 to-purple-500/20",
  "from-fuchsia-500/20 to-pink-500/20",
  "from-emerald-500/20 to-teal-500/20",
  "from-orange-500/20 to-rose-500/20"
];

export default function StoriesTab() {
  const [stories, setStories] = useState<Story[]>([]);
  const [isComposing, setIsComposing] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newExcerpt, setNewExcerpt] = useState('');
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  useEffect(() => {
    const q = query(
      collection(db, 'whisper_stories'),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      setStories(data);
    });
    return () => unsubscribe();
  }, []);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newExcerpt.trim() || !user) return;
    
    // Safety check
    if (containsInappropriateContent(newTitle).matches || containsInappropriateContent(newExcerpt).matches) {
      toast.error('Keep it clean in the void.');
      return;
    }

    try {
      const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];
      await addDoc(collection(db, 'whisper_stories'), {
        title: newTitle.trim(),
        excerpt: newExcerpt.trim(),
        authorName: profile?.anonymous_username || 'Anonymous',
        authorId: user.uid,
        episodes: 0,
        followers: 0,
        tags: ["New", "Void"],
        color: randomColor,
        createdAt: serverTimestamp()
      });
      setIsComposing(false);
      setNewTitle('');
      setNewExcerpt('');
      toast.success('Story thread started!');
    } catch (err) {
      toast.error('Failed to start story.');
      console.error(err);
    }
  };

  return (
    <div className="p-6 md:p-8 flex flex-col h-full bg-[#070d1f]">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2 font-['Manrope']">Stories</h2>
          <p className="text-sm text-slate-400">Serialized whispers from the digital void.</p>
        </div>
        <button 
          onClick={() => setIsComposing(true)}
          className="bg-gradient-to-r from-fuchsia-500 to-purple-600 hover:from-fuchsia-400 hover:to-purple-500 text-white px-5 py-2.5 rounded-full font-semibold flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(192,132,252,0.3)] hover:shadow-[0_0_25px_rgba(192,132,252,0.5)] transform hover:-translate-y-0.5"
        >
          <PenTool size={18} />
          Start a Story
        </button>
      </div>

      {isComposing && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="bg-white/5 border border-fuchsia-500/30 rounded-2xl p-6 mb-8 relative"
        >
          <button onClick={() => setIsComposing(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white"><X size={20}/></button>
          <h3 className="text-xl font-bold text-white mb-4">Start a new Story Thread</h3>
          <input 
            value={newTitle} onChange={e => setNewTitle(e.target.value)}
            placeholder="Story Title" 
            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white mb-4 outline-none focus:border-fuchsia-500/50"
            maxLength={60}
          />
          <textarea 
            value={newExcerpt} onChange={e => setNewExcerpt(e.target.value)}
            placeholder="Write a short excerpt to hook readers..." 
            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white mb-4 outline-none focus:border-fuchsia-500/50 h-24 resize-none"
            maxLength={200}
          />
          <div className="flex justify-end">
            <button 
              onClick={handleCreate} disabled={!newTitle || !newExcerpt}
              className="bg-fuchsia-500 hover:bg-fuchsia-400 disabled:opacity-50 text-white px-6 py-2 rounded-xl font-bold transition-all"
            >
              Initialize Thread
            </button>
          </div>
        </motion.div>
      )}

      {stories.length === 0 ? (
         <div className="text-center py-20 bg-white/5 rounded-3xl border border-white/5">
           <BookOpen className="mx-auto text-slate-500 mb-4" size={32} />
           <p className="text-slate-300 font-bold mb-2">No active stories in the void.</p>
           <p className="text-slate-500 text-sm">Be the first to start a thread.</p>
         </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {stories.map((story, i) => (
            <motion.div
              key={story.id}
              onClick={() => navigate(`/whisper/story/${story.id}`)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className={`group relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br ${story.color} backdrop-blur-3xl p-6 cursor-pointer hover:border-white/10 transition-all hover:-translate-y-1`}
            >
              <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex flex-wrap gap-2">
                    {story.tags?.map(tag => (
                      <span key={tag} className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-black/40 text-slate-300 border border-white/5">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-fuchsia-300 bg-fuchsia-500/10 px-2 py-1 rounded-full border border-fuchsia-500/20">
                    <BookOpen size={12} />
                    {story.episodes} Parts
                  </div>
                </div>

                <h3 className="text-xl font-bold text-white mb-2 font-['Manrope'] leading-tight group-hover:text-fuchsia-400 transition-colors">
                  {story.title}
                </h3>
                
                <div className="flex items-center gap-2 text-sm text-slate-400 mb-4 border-b border-white/5 pb-4">
                  <User size={14} />
                  <span className="text-slate-300">{story.authorName}</span>
                </div>

                <p className="text-sm text-slate-400 leading-relaxed mb-6 line-clamp-2">
                  {story.excerpt}
                </p>

                <div className="flex justify-between items-center mt-auto">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-black/30 px-2.5 py-1.5 rounded-lg border border-white/5">
                    <Users size={14} className="text-blue-400" />
                    <span className="font-medium">{story.followers.toLocaleString()} Following</span>
                  </div>
                  
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-fuchsia-500/20 group-hover:text-fuchsia-400 transition-colors">
                    <ChevronRight size={16} />
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
