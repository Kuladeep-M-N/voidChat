import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { motion, AnimatePresence } from 'framer-motion';
import { Megaphone, X, Bell } from 'lucide-react';

interface Announcement {
  id: string;
  message: string;
  created_at: any;
}

const GlobalAnnouncement = () => {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'global_announcements'),
      orderBy('created_at', 'desc'),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        const data = { id: doc.id, ...doc.data() } as Announcement;
        setAnnouncement(data);
      } else {
        setAnnouncement(null);
        setIsVisible(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!announcement) return;

    // Calculate age
    const createdAt = announcement.created_at?.toDate ? announcement.created_at.toDate() : new Date(announcement.created_at);
    const now = new Date();
    const ageInMs = now.getTime() - createdAt.getTime();
    const fifteenMinutesInMs = 15 * 60 * 1000;

    if (ageInMs < fifteenMinutesInMs) {
      // Only show if not dismissed in this session
      const savedDismissed = sessionStorage.getItem('dismissed_announcement');
      if (savedDismissed !== announcement.id) {
        setIsVisible(true);

        // Set a timer to hide it when it expires
        const remainingTime = fifteenMinutesInMs - ageInMs;
        const timer = setTimeout(() => {
          setIsVisible(false);
        }, remainingTime);

        return () => clearTimeout(timer);
      } else {
        setIsVisible(false);
      }
    } else {
      setIsVisible(false);
    }
  }, [announcement]);

  const dismiss = () => {
    if (announcement) {
      sessionStorage.setItem('dismissed_announcement', announcement.id);
      setIsVisible(false);
    }
  };

  return (
    <AnimatePresence>
      {isVisible && announcement && (
        <motion.div
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 20, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          className="fixed top-0 left-0 right-0 z-[100] flex justify-center px-4 pointer-events-none"
        >
          <div className="relative pointer-events-auto max-w-2xl w-full">
            {/* Glow Effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-pink-500/20 via-violet-500/20 to-pink-500/20 animate-gradient-x blur-2xl opacity-50" />
            
            <div className="relative bg-black/60 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-1 shadow-[0_0_50px_rgba(236,72,153,0.15)] overflow-hidden group">
              {/* Inner animated border */}
              <div className="absolute inset-0 bg-gradient-to-r from-pink-500/10 via-white/5 to-violet-500/10 animate-gradient-x opacity-0 group-hover:opacity-100 transition-opacity" />
              
              <div className="relative flex items-center gap-6 p-5">
                <div className="flex-shrink-0 relative">
                  <div className="absolute inset-0 bg-pink-500 blur-lg opacity-20 animate-pulse" />
                  <div className="relative h-14 w-14 rounded-2xl bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center text-white shadow-xl shadow-pink-500/20">
                    <Megaphone size={24} className="animate-bounce" />
                  </div>
                </div>

                <div className="flex-grow min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-pink-400">
                      <Bell size={10} />
                      Global Broadcast
                    </span>
                    <span className="h-1 w-1 rounded-full bg-white/20" />
                    <span className="text-[10px] font-bold text-white/30">Admin Message</span>
                  </div>
                  <p className="text-sm md:text-base font-bold text-white/90 leading-snug truncate md:whitespace-normal">
                    {announcement.message}
                  </p>
                </div>

                <button 
                  onClick={dismiss}
                  className="flex-shrink-0 h-10 w-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition group/close"
                >
                  <X size={18} className="group-hover/close:rotate-90 transition-transform" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default GlobalAnnouncement;
