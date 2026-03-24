import React, { useState } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Lightbulb, UserCheck, ArrowLeft, Sparkles } from 'lucide-react';
import { useNotifications } from '../hooks/useNotifications';

import StoriesTab from '../components/whisper/StoriesTab';
import StoryView from '../components/whisper/StoryView';
import WhisperBackground from '../components/whisper/WhisperBackground';

export default function Whisper() {
  const location = useLocation();
  const currentTab = location.pathname.split('/').pop() || 'stories';
  const { onlineCount } = useNotifications();

  const tabs = [
    { id: 'stories',   label: 'Stories',    icon: <BookOpen  className="w-4 h-4" />, color: 'from-fuchsia-500/20 to-purple-500/20' },
  ];

  const isInStoryView = location.pathname.includes('/story/');

  return (
    <div className="min-h-screen relative overflow-x-hidden flex flex-col pt-20 pb-16">
      <WhisperBackground />

      <main className="relative z-10 max-w-6xl mx-auto w-full px-4 sm:px-6 flex-1 flex flex-col">
        {/* ── Header ── */}
        <AnimatePresence>
          {!isInStoryView && (
            <motion.div
              className="mb-6 flex items-start gap-4"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            >
              {/* Back button */}
              <Link
                to="/dashboard"
                className="flex h-10 w-10 shrink-0 mt-1 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-slate-400 transition-all hover:bg-white/10 hover:text-white hover:border-white/20 backdrop-blur-sm"
                aria-label="Back to dashboard"
              >
                <ArrowLeft size={17} />
              </Link>

              <div className="flex-1">
                {/* Title row */}
                <div className="flex items-center gap-3 flex-wrap">
                  <h1
                    className="text-3xl sm:text-4xl font-black tracking-tight"
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    <span className="text-4xl mr-1">🤫</span>
                    <span
                      style={{
                        background: 'linear-gradient(135deg, #db90ff 0%, #0acffe 60%, #ff81f5 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                      }}
                    >
                      Whisper Space
                    </span>
                  </h1>

                  {/* Online indicator */}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/8 backdrop-blur-sm">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                    </span>
                    <span className="text-xs font-semibold text-slate-300">{onlineCount} live</span>
                  </div>
                </div>

                <p className="text-slate-500 text-sm mt-1.5 max-w-lg leading-relaxed" style={{ fontFamily: "'Manrope', sans-serif" }}>
                  The quiet corner of the void. Interactive stories.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Tab Navigation ── */}
        <AnimatePresence>
          {!isInStoryView && (
            <motion.div
              className="flex gap-2 mb-6 overflow-x-auto scrollbar-hide"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' }}
            >
              {tabs.map((tab) => {
                const isActive =
                  currentTab === tab.id ||
                  (currentTab === 'whisper' && tab.id === 'stories');
                return (
                  <Link
                    key={tab.id}
                    to={`/whisper/${tab.id}`}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all whitespace-nowrap backdrop-blur-sm
                      ${isActive ? 'whisper-tab-active' : 'whisper-tab-inactive'}`}
                    style={{ fontFamily: "'Manrope', sans-serif" }}
                  >
                    {tab.icon}
                    {tab.label}
                    {isActive && (
                      <motion.span
                        layoutId="tab-indicator"
                        className="w-1 h-1 rounded-full bg-fuchsia-400"
                      />
                    )}
                  </Link>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Content Area ── */}
        <motion.div
          className="flex-1 relative"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
        >
          <AnimatePresence mode="wait">
            <Routes>
              <Route path="/"            element={<Navigate to="stories" replace />} />
              <Route path="stories"      element={<StoriesTab />} />
              <Route path="story/:id"    element={<StoryView />} />
            </Routes>
          </AnimatePresence>
        </motion.div>
      </main>
    </div>
  );
}
