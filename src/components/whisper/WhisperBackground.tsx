import React from 'react';
import { motion } from 'framer-motion';

export default function WhisperBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {/* Base gradient */}
      <div className="absolute inset-0 whisper-bg" />

      {/* Animated orb 1 — fuchsia */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 600,
          height: 600,
          top: '-150px',
          right: '-100px',
          background: 'radial-gradient(circle, rgba(191,90,242,0.22) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
        animate={{
          x: [0, -40, 20, 0],
          y: [0, 30, -20, 0],
          scale: [1, 1.1, 0.95, 1],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Animated orb 2 — cyan */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 500,
          height: 500,
          bottom: '-100px',
          left: '-50px',
          background: 'radial-gradient(circle, rgba(10,207,254,0.18) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
        animate={{
          x: [0, 50, -20, 0],
          y: [0, -40, 30, 0],
          scale: [1, 0.9, 1.12, 1],
        }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
      />

      {/* Animated orb 3 — fuchsia/pink center */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 400,
          height: 400,
          top: '50%',
          left: '45%',
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, rgba(255,0,255,0.1) 0%, transparent 70%)',
          filter: 'blur(100px)',
        }}
        animate={{
          x: [0, 30, -30, 0],
          y: [0, -30, 20, 0],
          scale: [1, 1.15, 0.88, 1],
          opacity: [0.5, 0.8, 0.4, 0.5],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 5 }}
      />

      {/* Noise / grain overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '128px',
        }}
      />
    </div>
  );
}
