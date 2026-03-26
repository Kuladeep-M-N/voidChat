import React, { useState } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  BookOpen, ArrowLeft, Home, TrendingUp, Users, 
  Heart, Hash, PenTool, Sparkles, Search
} from 'lucide-react';
import { useNotifications } from '../hooks/useNotifications';

import StoriesTab from '../components/whisper/StoriesTab';
import AuthorsTab from '../components/whisper/AuthorsTab';
import StoryView from '../components/whisper/StoryView';
import WhisperBackground from '../components/whisper/WhisperBackground';

export default function Whisper() {
  const location = useLocation();
  const navigate = useNavigate();
  const { onlineCount } = useNotifications();
  
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [showCreateStory, setShowCreateStory] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const isInStoryView = location.pathname.includes('/story/');
  const isInAuthors = location.pathname.includes('/authors');

  const sidebarLinks = [
    { id: 'home', label: 'Home', icon: <Home size={18} />, path: '/whisper/stories' },
    { id: 'popular', label: 'Popular', icon: <TrendingUp size={18} />, path: '/whisper/stories?sort=popular' },
    { id: 'authors', label: 'Authors', icon: <Users size={18} />, path: '/whisper/authors' },
  ];

  const categories = [
    { label: '#horror', color: 'text-red-400' },
    { label: '#dark', color: 'text-purple-400' },
    { label: '#sci-fi', color: 'text-cyan-400' },
    { label: '#theory', color: 'text-amber-400' },
  ];

  return (
    <div className="min-h-screen relative overflow-x-hidden flex flex-col pt-0 pb-16">
      <WhisperBackground />

      <div className="relative z-10 w-full px-4 sm:px-8 max-w-[1400px] mx-auto flex-1">
        {/* ── NEW REDDIT-STYLE LAYOUT ── */}
        <div className="whisper-layout">
          
          {/* ── SIDEBAR ── */}
          {!isInStoryView && (
            <aside className="whisper-sidebar hidden lg:flex flex-col h-full pr-6 border-r border-white/5 pt-10">

              <div className="sidebar-section">
                <div className="sidebar-section-title px-4">Navigation</div>
                {sidebarLinks.map(link => (
                  <button
                    key={link.id}
                    onClick={() => navigate(link.path)}
                    className={`sidebar-link w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${location.pathname + location.search === link.path ? 'active bg-white/5 text-fuchsia-400' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                  >
                    {link.icon}
                    <span className="font-medium">{link.label}</span>
                  </button>
                ))}
              </div>

              <div className="sidebar-section mt-6">
                <div className="sidebar-section-title px-4">Discovery</div>
                <button
                  onClick={() => setActiveFilter(activeFilter === 'Following' ? null : 'Following')}
                  className={`sidebar-link w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${activeFilter === 'Following' ? 'active bg-white/5 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                >
                  <Heart size={18} />
                  <span className="font-medium">Following</span>
                </button>
                <button
                  onClick={() => setActiveFilter(activeFilter === 'Liked' ? null : 'Liked')}
                  className={`sidebar-link w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${activeFilter === 'Liked' ? 'active bg-white/5 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                >
                  <Sparkles size={18} />
                  <span className="font-medium">Most Liked</span>
                </button>
              </div>

              <div className="sidebar-section mt-6">
                <div className="sidebar-section-title px-4">Categories</div>
                {categories.map(cat => (
                  <button
                    key={cat.label}
                    onClick={() => setActiveFilter(activeFilter === cat.label ? null : cat.label)}
                    className={`sidebar-link w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm transition-all ${activeFilter === cat.label ? 'active text-fuchsia-400' : 'text-slate-500 hover:text-slate-300 hover:bg-white/2'}`}
                  >
                    <Hash size={16} className={`${cat.color} opacity-70`} />
                    <span className="font-medium">{cat.label.replace('#', '')}</span>
                  </button>
                ))}
              </div>

              {/* Online indicator at bottom of sidebar */}
              <div className="mt-auto pt-6 px-4 pb-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-white/5 border border-white/5 backdrop-blur-sm w-fit">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{onlineCount} online</span>
                </div>
              </div>
            </aside>
          )}

          {/* ── MAIN CONTENT AREA ── */}
          <main className="whisper-main-content flex flex-col min-w-0">
            {/* Dedicated Fixed Header (Reddit-Style) */}
            {!isInStoryView && (
              <header className="fixed top-0 left-0 right-0 h-16 bg-[#0d0d1e]/95 backdrop-blur-2xl z-[1000] border-b border-white/10 shadow-2xl flex items-center px-8">
                <div className="flex items-center justify-between gap-6 max-w-[1400px] mx-auto w-full">
                  <div className="flex items-center gap-4">
                    <Link
                      to="/dashboard"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-slate-400 transition-all hover:bg-white/10 hover:text-white hover:border-white/20"
                    >
                      <ArrowLeft size={18} />
                    </Link>
                    <div className="h-8 w-[1px] bg-white/10 mx-1" />
                    <Link to="/whisper" className="group flex items-center gap-3">
                      <div className="p-2 bg-fuchsia-500/10 rounded-xl border border-fuchsia-500/20 group-hover:scale-110 transition-transform">
                        <Sparkles className="text-fuchsia-400" size={20} />
                      </div>
                      <div className="hidden md:block">
                        <h1 className="text-2xl font-black whisper-header-premium tracking-tighter group-hover:text-fuchsia-400 transition-colors whitespace-nowrap">
                          Whisper Space
                        </h1>
                      </div>
                    </Link>
                  </div>

                  {/* Reddit-Style Search Bar */}
                  <div className="flex-1 max-w-2xl mx-auto hidden sm:block">
                    <div className="relative group">
                      <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-fuchsia-400 transition-colors" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search within the feed..."
                        className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-fuchsia-500/40 focus:bg-white/10 transition-all backdrop-blur-md"
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                     <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] opacity-80 bg-white/5 px-4 py-2 rounded-xl border border-white/5 whitespace-nowrap">
                       {isInAuthors ? 'Exploring Authors' : (activeFilter ? activeFilter : 'Community Feed')}
                     </h2>
                  </div>
                </div>
              </header>
            )}

            {/* Spacer for Fixed Header */}
            {!isInStoryView && <div className="h-20" />}

            <motion.div
              className="flex-1"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <Routes>
                <Route path="/"            element={<Navigate to="stories" replace />} />
                <Route path="stories"      element={
                  <StoriesTab 
                    externalFilter={activeFilter} 
                    isComposingExternal={showCreateStory} 
                    onCloseCompose={() => setShowCreateStory(false)} 
                    searchQuery={searchQuery}
                  />
                } />
                <Route path="story/:id"    element={<StoryView />} />
                <Route path="authors"      element={<AuthorsTab />} />
              </Routes>
            </motion.div>
          </main>
        </div>
      </div>
      {/* ── FIXED "START A STORY" FAB ── */}
      {!isInStoryView && (
        <button
          onClick={() => setShowCreateStory(true)}
          className="fixed bottom-10 right-10 z-[100] group flex items-center gap-3 px-6 py-4 rounded-2xl bg-gradient-to-br from-fuchsia-600 to-purple-700 text-white font-bold shadow-[0_10px_40px_rgba(192,38,211,0.4)] hover:shadow-[0_20px_50px_rgba(192,38,211,0.6)] hover:-translate-y-1 transition-all duration-300"
        >
          <PenTool size={20} className="group-hover:rotate-12 transition-transform" />
          <span>Start a Story</span>
          <div className="absolute inset-0 rounded-2xl bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      )}
    </div>
  );
}
