import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

const features = [
  {
    icon: '👻',
    title: 'Stay Anonymous',
    desc: 'No real names, no profiles, no traces. Just a username you choose.',
  },
  {
    icon: '⚡',
    title: 'Real-time Chat',
    desc: 'Messages appear instantly. Everyone sees what you type the moment you send it.',
  },
  {
    icon: '🔒',
    title: 'Invite Only',
    desc: 'Exclusive access via a secret invite code. No unwanted guests.',
  },
  {
    icon: '🌐',
    title: 'Shared Rooms',
    desc: 'Create or join rooms visible to everyone. No one is excluded.',
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Ambient blobs */}
      <div className="ambient-blob w-[600px] h-[600px] bg-violet-600/20 top-[-200px] left-[-100px]" />
      <div className="ambient-blob w-[500px] h-[500px] bg-cyan-500/15 bottom-[-100px] right-[-100px]" />
      <div className="ambient-blob w-[300px] h-[300px] bg-violet-800/20 top-[40%] left-[60%]" />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
        <motion.span
          className="text-xl font-bold text-gradient"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          VoidChat
        </motion.span>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Link to="/join">
            <button className="btn-primary !w-auto px-6 py-2.5 text-sm">
              Enter the Void →
            </button>
          </Link>
        </motion.div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-20 pb-32 max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold text-violet-300 border border-violet-500/30 bg-violet-500/10 mb-8 tracking-widest uppercase">
            👻 Anonymous · Invite Only · Real-time
          </span>
        </motion.div>

        <motion.h1
          className="text-6xl md:text-8xl font-bold leading-[0.95] tracking-tight mb-8"
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2, type: 'spring', stiffness: 100 }}
        >
          Say anything.
          <br />
          <span className="text-gradient">Be no one.</span>
        </motion.h1>

        <motion.p
          className="text-lg md:text-xl text-slate-400 max-w-2xl mb-12 leading-relaxed"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.35 }}
        >
          The anonymous invite-only college chat platform. Create rooms, share thoughts, 
          have conversations — all without revealing who you are.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5 }}
          className="flex flex-col sm:flex-row items-center gap-4"
        >
          <Link to="/join">
            <button className="btn-primary !w-auto px-10 py-4 text-base rounded-2xl">
              Join VoidChat
            </button>
          </Link>
          <p className="text-slate-500 text-sm">You'll need an invite code</p>
        </motion.div>
      </section>

      {/* Features */}
      <section className="relative z-10 px-6 pb-32 max-w-6xl mx-auto">
        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ staggerChildren: 0.1 }}
        >
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              className="glass-hover rounded-2xl p-6 cursor-default"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="font-semibold text-white text-lg mb-2">{f.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8 text-center text-slate-500 text-sm">
        VoidChat · Anonymous College Chat · {new Date().getFullYear()}
      </footer>
    </div>
  );
}
