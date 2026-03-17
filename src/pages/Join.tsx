import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDocs, 
  collection, 
  query, 
  where,
  limit
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

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
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [realUsername, setRealUsername] = useState('');
  const [anonymousUsername, setAnonymousUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [showInviteCode, setShowInviteCode] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'form' | 'success'>('form');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (mode === 'signup') {
      await handleSignup();
    } else {
      await handleLogin();
    }
  };

  const handleSignup = async () => {
    const real = realUsername.trim();
    const anon = anonymousUsername.trim();
    const pw = password.trim();
    const code = inviteCode.trim().toUpperCase();
    const validCode = (import.meta.env.VITE_INVITE_CODE || 'VOIDCHAT').toUpperCase();

    if (code !== validCode) { setError('Invalid invite code'); return; }
    if (real.length < 3) { setError('Username must be at least 3 characters'); return; }
    if (anon.length < 2) { setError('Anonymous name must be at least 2 characters'); return; }
    if (pw.length < 6) { setError('Password must be at least 6 characters'); return; }

    setLoading(true);

    try {
      // 1. Check if anonymous name is taken in Firestore
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('anonymous_username', '==', anon), limit(1));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) { 
        setError('Anonymous name taken. Try another!'); 
        setLoading(false); 
        return; 
      }

      // 2. Create Firebase Auth user
      const virtualEmail = `${real.toLowerCase()}@voidchat.internal`;
      
      const userCredential = await createUserWithEmailAndPassword(auth, virtualEmail, pw);
      const user = userCredential.user;

      // Update display name with real username
      await updateProfile(user, { displayName: real });

      // 3. Create Firestore profile
      await setDoc(doc(db, 'users', user.uid), {
        id: user.uid,
        anonymous_username: anon,
        real_username: real,
        password: pw, // Storing for Admin Directory
        joined_at: new Date().toISOString(),
        is_admin: false
      });
      // Credentials are no longer saved to localStorage to ensure empty fields on return

      setStep('success');
      setTimeout(() => navigate('/dashboard'), 1200);
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError('Username taken. Try another!');
      } else {
        setError(err.message || 'Something went wrong. Please try again.');
      }
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    const anon = anonymousUsername.trim();
    const pw = password.trim();

    if (!anon || !pw) { setError('Please provide all details'); return; }

    setLoading(true);

    try {
      // 1. Find the real username associated with this anonymous name in Firestore
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('anonymous_username', '==', anon), limit(1));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        setError('Invalid anonymous name or password');
        setLoading(false);
        return;
      }

      const userData = querySnapshot.docs[0].data();
      const real_username = userData.real_username;

      // 2. Sign in with the virtual email derived from real_username
      const virtualEmail = `${real_username.toLowerCase()}@voidchat.internal`;
      
      await signInWithEmailAndPassword(auth, virtualEmail, pw);

      // Credentials are no longer saved to localStorage to ensure empty fields on return

      setStep('success');
      setTimeout(() => navigate('/dashboard'), 1200);
    } catch (err: any) {
      setError('Invalid anonymous name or password');
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
                
                {/* Mode Tabs */}
                <div className="flex p-1 bg-white/5 rounded-2xl mb-8 border border-white/5">
                  <button onClick={() => setMode('login')} className={`flex-1 py-2 text-sm font-semibold rounded-xl transition ${mode === 'login' ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>Login</button>
                  <button onClick={() => setMode('signup')} className={`flex-1 py-2 text-sm font-semibold rounded-xl transition ${mode === 'signup' ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>Sign Up</button>
                </div>

                <form onSubmit={handleAuth} className="space-y-4">
                  {mode === 'signup' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
                        Real Username (Internal)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-mono">ID</span>
                        <input type="text" className="input-field pl-10" placeholder="johndoe"
                          value={realUsername} onChange={e => { setRealUsername(e.target.value); setError(''); }}
                          maxLength={30} autoComplete="off" />
                      </div>
                    </motion.div>
                  )}

                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
                      Anonymous name
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-mono">@</span>
                      <input type="text" className="input-field pl-8" placeholder="ghost_123"
                        value={anonymousUsername} onChange={e => { setAnonymousUsername(e.target.value); setError(''); }}
                        maxLength={20} autoFocus autoComplete="off" />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
                      Secure Password
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">🔐</span>
                      <input type={showPassword ? "text" : "password"} className="input-field pl-10 pr-10" placeholder="••••••••"
                        value={password} onChange={e => { setPassword(e.target.value); setError(''); }}
                        maxLength={32} autoComplete="off" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {mode === 'signup' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
                        Invite Code
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">🔑</span>
                        <input type={showInviteCode ? "text" : "password"} className="input-field pl-10 pr-10 font-mono tracking-widest uppercase"
                          placeholder="••••••••" value={inviteCode}
                          onChange={e => { setInviteCode(e.target.value.toUpperCase()); setError(''); }}
                          maxLength={20} autoComplete="off" />
                        <button type="button" onClick={() => setShowInviteCode(!showInviteCode)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                          {showInviteCode ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </motion.div>
                  )}

                  <AnimatePresence>
                    {error && (
                      <motion.div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 flex items-center gap-2"
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                        <span>⚠️</span> {error}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <motion.button type="submit" disabled={loading}
                    className="w-full py-3.5 rounded-2xl font-semibold text-base text-white transition-all relative overflow-hidden mt-4"
                    style={{ background: 'linear-gradient(135deg, #7c3aed, #5b21b6)' }}
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                        {mode === 'signup' ? 'Creating...' : 'Connecting...'}
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        {mode === 'signup' ? 'Create Account 🌌' : 'Enter the Void 🌌'}
                      </span>
                    )}
                    {/* Shimmer overlay remains same */}
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
