import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useAnimationFrame } from 'framer-motion';
import { supabase } from '../lib/supabase';

// Floating particle
interface Particle { x: number; y: number; vx: number; vy: number; size: number; opacity: number; color: string; }

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);

    const colors = ['#7c3aed', '#06b6d4', '#8b5cf6', '#0ea5e9', '#a78bfa'];
    particles.current = Array.from({ length: 60 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      size: Math.random() * 2.5 + 0.5,
      opacity: Math.random() * 0.5 + 0.1,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.current.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color + Math.round(p.opacity * 255).toString(16).padStart(2, '0');
        ctx.fill();
      });

      // Draw connections
      for (let i = 0; i < particles.current.length; i++) {
        for (let j = i + 1; j < particles.current.length; j++) {
          const dx = particles.current[i].x - particles.current[j].x;
          const dy = particles.current[i].y - particles.current[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(particles.current[i].x, particles.current[i].y);
            ctx.lineTo(particles.current[j].x, particles.current[j].y);
            ctx.strokeStyle = `rgba(124,58,237,${0.08 * (1 - dist / 100)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animRef.current); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}

// Animated letters for the title
function AnimatedTitle({ text }: { text: string }) {
  return (
    <div className="flex justify-center">
      {text.split('').map((char, i) => (
        <motion.span key={i} className="text-5xl md:text-6xl font-black"
          style={{ background: 'linear-gradient(135deg, #a78bfa, #06b6d4, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          initial={{ opacity: 0, y: 30, rotate: -15 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ delay: i * 0.07, type: 'spring', stiffness: 200, damping: 15 }}>
          {char}
        </motion.span>
      ))}
    </div>
  );
}

export default function Join() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'form' | 'success'>('form');

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = username.trim();
    const code = inviteCode.trim().toUpperCase();
    const validCode = (import.meta.env.VITE_INVITE_CODE || 'VOIDCHAT').toUpperCase();

    if (code !== validCode) { setError('Invalid invite code. Try VOIDCHAT'); return; }
    if (name.length < 2) { setError('Username must be at least 2 characters'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(name)) { setError('Username: letters, numbers, underscores only'); return; }

    setLoading(true); setError('');
    const email = `${name.toLowerCase()}@voidchat.void`;
    const password = `vc_${name.toLowerCase()}_secure`;

    try {
      let userId: string | null = null;

      // Try sign in first
      const { data: signInData } = await supabase.auth.signInWithPassword({ email, password });
      if (signInData?.user) {
        userId = signInData.user.id;
      } else {
        // Sign up
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) { setError(signUpError.message); setLoading(false); return; }
        if (!signUpData?.user) { setError('Could not create account'); setLoading(false); return; }
        userId = signUpData.user.id;

        // Check uniqueness
        const { data: existing } = await supabase.from('users').select('id').eq('anonymous_username', name).maybeSingle();
        if (existing) { setError('Username taken. Try another!'); await supabase.auth.signOut(); setLoading(false); return; }

        // Create profile
        const { error: profileError } = await supabase.from('users').insert({ id: userId, anonymous_username: name });
        if (profileError) {
          if (profileError.code === '23505') { setError('Username taken. Try another!'); }
          else { setError(profileError.message); }
          await supabase.auth.signOut(); setLoading(false); return;
        }
      }

      setStep('success');
      setTimeout(() => navigate('/dashboard'), 1200);
    } catch (err) {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-[#07070f]">
      <ParticleCanvas />

      {/* Radial glow */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 80% 60% at 50% 50%, rgba(124,58,237,0.12) 0%, transparent 70%)'
      }} />

      {/* Floating orbs */}
      <motion.div className="absolute w-64 h-64 rounded-full blur-3xl pointer-events-none"
        style={{ background: 'rgba(124,58,237,0.15)', top: '15%', left: '10%' }}
        animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="absolute w-48 h-48 rounded-full blur-3xl pointer-events-none"
        style={{ background: 'rgba(6,182,212,0.12)', bottom: '15%', right: '10%' }}
        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }} />

      <div className="relative z-10 w-full max-w-md px-4 flex flex-col items-center">
        {/* Title */}
        <motion.div className="mb-2 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <AnimatedTitle text="VoidChat" />
        </motion.div>
        <motion.p className="text-slate-400 text-center mb-10 text-base"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
          Enter the void. Speak freely. No identity.
        </motion.p>

        <AnimatePresence mode="wait">
          {step === 'success' ? (
            <motion.div key="success" className="flex flex-col items-center gap-4"
              initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 250, damping: 20 }}>
              <motion.div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center text-4xl"
                animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 0.5 }}>
                ✅
              </motion.div>
              <p className="text-white font-semibold text-xl">Entering the void...</p>
              <div className="flex gap-1">
                {[0,1,2].map(i => (
                  <motion.div key={i} className="w-2 h-2 rounded-full bg-violet-400"
                    animate={{ scale: [1, 1.8, 1] }} transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }} />
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div key="form" className="w-full"
              initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, type: 'spring', stiffness: 200, damping: 25 }}>
              <div className="glass border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
                <form onSubmit={handleJoin} className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
                      Anonymous Username
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-mono">@</span>
                      <input type="text" className="input-field pl-8" placeholder="ghost_123"
                        value={username} onChange={e => { setUsername(e.target.value); setError(''); }}
                        maxLength={20} autoFocus autoComplete="off" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
                      Invite Code
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">🔑</span>
                      <input type="text" className="input-field pl-10 font-mono tracking-widest uppercase"
                        placeholder="VOIDCHAT" value={inviteCode}
                        onChange={e => { setInviteCode(e.target.value.toUpperCase()); setError(''); }}
                        maxLength={20} autoComplete="off" />
                    </div>
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 flex items-center gap-2"
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                        <span>⚠️</span> {error}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <motion.button type="submit" disabled={loading || !username.trim() || !inviteCode.trim()}
                    className="w-full py-3.5 rounded-2xl font-semibold text-base text-white transition-all relative overflow-hidden mt-2"
                    style={{ background: 'linear-gradient(135deg, #7c3aed, #5b21b6)' }}
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                        Joining...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        Enter the Void 🌌
                      </span>
                    )}
                    {/* Shimmer */}
                    <motion.div className="absolute inset-0 pointer-events-none"
                      style={{ background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%)' }}
                      animate={{ x: ['-100%', '200%'] }} transition={{ duration: 2, repeat: Infinity, ease: 'linear', repeatDelay: 1 }} />
                  </motion.button>
                </form>

                <div className="mt-5 pt-5 border-t border-white/5 text-center">
                  <p className="text-xs text-slate-600">No email required. No tracking. Pure anonymity.</p>
                  <div className="flex justify-center gap-4 mt-3 text-xs text-slate-600">
                    <span>🔒 Anonymous</span>
                    <span>⚡ Real-time</span>
                    <span>🌌 Open</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
