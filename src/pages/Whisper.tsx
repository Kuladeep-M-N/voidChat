import React, { useState } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Lightbulb, UserCheck, ArrowLeft } from 'lucide-react';
import { useNotifications } from '../hooks/useNotifications';

import StoriesTab from '../components/whisper/StoriesTab';
import TheoriesTab from '../components/whisper/TheoriesTab';
import SituationsTab from '../components/whisper/SituationsTab';
import StoryView from '../components/whisper/StoryView';

export default function Whisper() {
  const location = useLocation();
  const currentTab = location.pathname.split('/').pop() || 'stories';
  const { onlineCount } = useNotifications();

  const tabs = [
    { id: 'stories', label: 'Stories', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'theories', label: 'Theories', icon: <Lightbulb className="w-4 h-4" /> },
    { id: 'situations', label: 'Situations', icon: <UserCheck className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col pt-24 pb-10">
      <div className="ambient-blob w-[600px] h-[600px] bg-fuchsia-600/10 top-[-200px] right-[-200px]" />
      <div className="ambient-blob w-[400px] h-[400px] bg-purple-500/10 bottom-0 left-[-100px]" />

      <main className="relative z-10 max-w-5xl mx-auto w-full px-6 flex-1 flex flex-col">
        {/* Header */}
        <motion.div className="mb-4 flex items-center gap-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Link
            to="/dashboard"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-1 flex items-center gap-3">
              <span className="text-4xl">🤫</span>
              <span className="text-gradient from-fuchsia-400 to-purple-400">Whisper Space</span>
            </h1>
            <p className="text-slate-400 max-w-xl leading-relaxed text-sm">
              The quiet corner of the void. Share serialized stories, drop mind-bending theories, or react to intense scenarios.
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-white/5 rounded-full border border-white/10">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span className="text-xs font-medium text-slate-300">{onlineCount} Online</span>
          </div>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-white/10 pb-4 overflow-x-auto scrollbar-hide mt-4">
          {tabs.map((tab) => {
            const isActive = currentTab === tab.id || (currentTab === 'whisper' && tab.id === 'stories');
            return (
              <Link
                key={tab.id}
                to={`/whisper/${tab.id}`}
                className={`
                  flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all whitespace-nowrap
                  ${isActive ? 'bg-white/10 text-white shadow-[0_0_15px_rgba(255,255,255,0.05)]' : 'text-slate-400 hover:text-white hover:bg-white/5'}
                `}
              >
                {tab.icon}
                {tab.label}
              </Link>
            );
          })}
        </div>

        {/* Content Area */}
        <div className="flex-1 glass glass-hover border border-white/5 rounded-2xl overflow-hidden relative">
          <AnimatePresence mode="wait">
            <Routes>
              <Route path="/" element={<Navigate to="stories" replace />} />
              <Route path="stories" element={<StoriesTab />} />
              <Route path="story/:id" element={<StoryView />} />
              <Route path="theories" element={<TheoriesTab />} />
              <Route path="situations" element={<SituationsTab />} />
            </Routes>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
