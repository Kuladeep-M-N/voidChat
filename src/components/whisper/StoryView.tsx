import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Send, Users, ShieldAlert } from 'lucide-react';
import { db } from '../../lib/firebase';
import { doc, getDoc, collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, serverTimestamp, increment } from 'firebase/firestore';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'sonner';

interface Story {
  id: string;
  title: string;
  authorName: string;
  authorId: string;
  followers: number;
}

interface StoryPart {
  id: string;
  storyId: string;
  number: number;
  title: string;
  content: string;
  createdAt: any;
  reactions: { shocked: number; relate: number; plotTwist: number; angry: number };
}

export default function StoryView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [story, setStory] = useState<Story | null>(null);
  const [parts, setParts] = useState<StoryPart[]>([]);
  const [newPartTitle, setNewPartTitle] = useState('');
  const [newPartContent, setNewPartContent] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    // Fetch Story Details once (or via snapshot if followers change frequently)
    const fetchStory = async () => {
      const docRef = doc(db, 'whisper_stories', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setStory({ id: docSnap.id, ...docSnap.data() } as Story);
      } else {
        toast.error('Story not found');
        navigate('/whisper/stories');
      }
      setLoading(false);
    };
    fetchStory();

    // Listen to Parts
    const qParts = query(
      collection(db, 'whisper_story_parts'),
      where('storyId', '==', id),
      orderBy('number', 'asc')
    );
    const unsubscribeParts = onSnapshot(qParts, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as StoryPart[];
      setParts(data);
    });

    return () => unsubscribeParts();
  }, [id, navigate]);

  const handlePublishPart = async () => {
    if (!newPartContent.trim() || !user || !story) return;

    try {
      const nextNumber = parts.length + 1;
      await addDoc(collection(db, 'whisper_story_parts'), {
        storyId: story.id,
        number: nextNumber,
        title: newPartTitle.trim(),
        content: newPartContent.trim(),
        createdAt: serverTimestamp(),
        reactions: { shocked: 0, relate: 0, plotTwist: 0, angry: 0 }
      });
      
      // Update story episodes count
      await updateDoc(doc(db, 'whisper_stories', story.id), {
        episodes: increment(1)
      });
      
      setNewPartTitle('');
      setNewPartContent('');
      toast.success('Part published!');
    } catch (err) {
       toast.error('Failed to publish part.');
       console.error(err);
    }
  };

  const handleReaction = async (partId: string, reactionType: 'shocked'|'relate'|'plotTwist'|'angry') => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'whisper_story_parts', partId), {
        [`reactions.${reactionType}`]: increment(1)
      });
    } catch(err) {
      console.error(err);
    }
  };

  if (loading) {
    return <div className="p-8 flex justify-center items-center h-full"><div className="w-8 h-8 border-2 border-fuchsia-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!story) return null;

  const isAuthor = user?.uid === story.authorId;

  const ReactionButton = ({ emoji, count, label, onReact }: { emoji: string, count: number, label: string, onReact: () => void }) => (
    <button onClick={onReact} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all text-sm group">
      <span className="group-hover:scale-125 transition-transform" title={label}>{emoji}</span>
      <span className="text-slate-300 font-bold">{count || 0}</span>
    </button>
  );

  return (
    <div className="p-6 md:p-8 flex flex-col h-full bg-[#070d1f] relative min-h-screen">
      <button 
        onClick={() => navigate('/whisper/stories')}
        className="absolute top-6 border border-white/10 left-6 w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-slate-300 hover:bg-white/10 transition-colors z-20"
      >
        <ArrowLeft size={20} />
      </button>

      <div className="mt-12 mb-10 text-center max-w-2xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-black text-white mb-4 font-['Manrope']">{story.title}</h2>
        <div className="flex items-center justify-center gap-4 text-sm font-medium text-slate-400">
          <span>By <span className="text-fuchsia-400">@{story.authorName}</span></span>
          <span className="w-1 h-1 rounded-full bg-slate-600" />
          <span className="flex items-center gap-1"><Users size={14} className="text-blue-400"/> {story.followers} Following</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto w-full space-y-12">
        {parts.map((part, index) => (
          <motion.div 
            key={part.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="relative"
          >
            {/* Timeline Line */}
            {index !== parts.length - 1 && (
              <div className="absolute left-6 top-16 bottom-[-3rem] w-0.5 bg-gradient-to-b from-fuchsia-500/30 to-transparent z-0" />
            )}
            
            <div className="flex gap-4 relative z-10">
              <div className="w-12 h-12 rounded-full bg-fuchsia-500/20 border border-fuchsia-500/30 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(217,70,239,0.2)]">
                <span className="text-fuchsia-300 font-black text-lg">{part.number}</span>
              </div>
              
              <div className="flex-1 bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-xl hover:border-white/20 transition-colors">
                <h4 className="text-lg font-bold text-white mb-3 font-['Manrope']">
                  Part {part.number}{part.title ? `: ${part.title}` : ''}
                </h4>
                <p className="text-slate-200 text-lg leading-relaxed mb-6 font-['Inter'] whitespace-pre-wrap">
                  {part.content}
                </p>
                
                <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-white/5">
                   <ReactionButton onReact={() => handleReaction(part.id, 'shocked')} emoji="😳" count={part.reactions?.shocked} label="Shocked" />
                   <ReactionButton onReact={() => handleReaction(part.id, 'relate')} emoji="💔" count={part.reactions?.relate} label="Relate" />
                   <ReactionButton onReact={() => handleReaction(part.id, 'plotTwist')} emoji="🤯" count={part.reactions?.plotTwist} label="Plot Twist" />
                   <ReactionButton onReact={() => handleReaction(part.id, 'angry')} emoji="😡" count={part.reactions?.angry} label="Angry" />
                </div>
              </div>
            </div>
          </motion.div>
        ))}

        {parts.length === 0 && (
           <div className="text-center text-slate-500 py-10">
              No parts published yet.
           </div>
        )}

        {isAuthor && (
          <motion.div 
             initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
             className="bg-fuchsia-950/30 border border-fuchsia-500/30 rounded-3xl p-6 relative overflow-hidden mt-8"
          >
             <h4 className="text-white font-bold mb-4 flex items-center gap-2">
                <ShieldAlert size={18} className="text-fuchsia-400" />
                Author Controls
             </h4>
             <div className="bg-[#070d1f]/50 rounded-2xl p-4 focus-within:border-fuchsia-500/50 border border-transparent transition-all">
               <input 
                 value={newPartTitle} onChange={e => setNewPartTitle(e.target.value)}
                 type="text" 
                 placeholder="Part Title (Optional)" 
                 className="w-full bg-transparent text-white border-b border-white/10 mb-3 pb-2 focus:outline-none focus:border-fuchsia-400 text-sm font-bold"
               />
               <textarea 
                 value={newPartContent} onChange={e => setNewPartContent(e.target.value)}
                 placeholder="Write the next episode..." 
                 className="w-full bg-transparent text-slate-200 resize-none h-32 focus:outline-none"
               />
               <div className="flex justify-end mt-2">
                  <button 
                    onClick={handlePublishPart}
                    disabled={!newPartContent.trim()}
                    className="bg-fuchsia-500 hover:bg-fuchsia-400 disabled:opacity-50 text-white px-5 py-2 rounded-xl font-bold flex items-center gap-2 transition-all"
                  >
                    Publish Part {parts.length + 1}
                    <Send size={16} />
                  </button>
               </div>
             </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
