import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, AlertCircle } from 'lucide-react';

interface FeatureDisabledBannerProps {
  featureName: string;
  className?: string;
}

const FeatureDisabledBanner: React.FC<FeatureDisabledBannerProps> = ({ featureName, className = "" }) => {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className={`w-full bg-amber-500/10 border border-amber-500/20 backdrop-blur-md rounded-2xl p-6 mb-8 ${className}`}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500 text-black shadow-lg shadow-amber-500/20 shrink-0">
            <ShieldAlert size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-black text-white uppercase tracking-tight">
              {featureName} Temporarily Disabled
            </h3>
            <p className="text-sm text-amber-500/80 font-medium">
              Administrators have temporarily restricted access to this community feature. Please check back later.
            </p>
          </div>
          <div className="hidden md:block ml-auto opacity-20">
            <AlertCircle size={40} className="text-amber-500" />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default FeatureDisabledBanner;
