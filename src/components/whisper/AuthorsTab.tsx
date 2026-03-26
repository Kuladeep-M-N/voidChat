import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, Heart, BookOpen, ChevronRight, User } from 'lucide-react';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

interface Author {
  id: string;
  name: string;
  followers: number;
  totalLikes: number;
  storyCount: number;
  avatar?: string;
}

export default function AuthorsTab() {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Collect unique authors from the 'whisper_stories' collection
    const q = query(collection(db, 'whisper_stories'), limit(100));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const authorMap: Record<string, Author> = {};
      
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const aId = data.authorId;
        if (!aId) return;

        if (!authorMap[aId]) {
          authorMap[aId] = {
            id: aId,
            name: data.authorName || 'Anonymous',
            followers: 0, // We'd need a separate fetch or field for this
            totalLikes: 0,
            storyCount: 0,
            avatar: undefined
          };
        }
        authorMap[aId].storyCount += 1;
        authorMap[aId].totalLikes += (data.likes || 0);
      });

      // Optionally fetch real follower counts from 'users' for these specific authors
      const authorList = Object.values(authorMap).sort((a, b) => b.totalLikes - a.totalLikes);
      setAuthors(authorList);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Top Authors
          </h2>
          <p className="text-sm text-slate-500">The most influential voices in the Whisper Space.</p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="whisper-card h-32 animate-pulse bg-white/5 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {authors.map((author, index) => (
            <motion.div
              key={author.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => navigate(`/whisper/stories?author=${author.id}`)}
              className="whisper-card p-5 cursor-pointer group hover:border-fuchsia-500/30 transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-fuchsia-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center text-xl font-bold text-white overflow-hidden group-hover:scale-105 transition-transform">
                  {author.avatar ? (
                    <img src={author.avatar} alt={author.name} className="w-full h-full object-cover" />
                  ) : (
                    author.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-white group-hover:text-fuchsia-400 transition-colors" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    @{author.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Users size={12} className="text-cyan-400/70" /> {author.followers.toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Heart size={12} className="text-pink-400/70" /> {author.totalLikes.toLocaleString()}
                    </span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-600 group-hover:text-fuchsia-400 transition-colors" />
              </div>
              
              <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-500 uppercase tracking-wider font-bold">
                <span>Total Stories</span>
                <span className="text-white">{author.storyCount}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
