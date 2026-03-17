import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, AlertTriangle } from 'lucide-react';
import { useSystemConfig } from '../hooks/useSystemConfig';
import { useLocation } from 'react-router-dom';

const SafeModeBanner: React.FC = () => {
  const { config } = useSystemConfig();
  const location = useLocation();
  const isSafeMode = config.safeMode;
  const isAdminPage = location.pathname.startsWith('/admin');

  if (!isSafeMode || isAdminPage) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="relative z-[100] bg-red-500/10 border-b border-red-500/20 backdrop-blur-md"
      >
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500 text-white shadow-lg shadow-red-500/20">
              <ShieldAlert size={18} />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-none">Emergency Moderation Mode Active</p>
              <p className="text-[10px] text-red-400 font-medium mt-1 uppercase tracking-wider">New content creation is temporarily restricted by administrators.</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/20 border border-red-500/30">
            <AlertTriangle size={12} className="text-red-400" />
            <span className="text-[10px] font-black text-red-400 uppercase tracking-tighter">RESTRICTED ACCESS</span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default SafeModeBanner;
