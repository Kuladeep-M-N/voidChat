import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { MessageCircle, Shield, Users, Flame, Eye, Ghost } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  { icon: Ghost, title: "Stay Anonymous", desc: "Chat freely without revealing your identity" },
  { icon: Shield, title: "Invite Only", desc: "Exclusive access with special invite codes" },
  { icon: MessageCircle, title: "Real-time Chat", desc: "Instant messaging with your classmates" },
  { icon: Flame, title: "Confessions", desc: "Share secrets anonymously in the confession room" },
  { icon: Eye, title: "Polls & Votes", desc: "Create anonymous polls and discover opinions" },
  { icon: Users, title: "Chat Rooms", desc: "Join or create topic-based rooms" },
];

const Landing = () => {
  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Hero */}
      <div className="relative">
        {/* Ambient glows */}
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
        <div className="absolute top-[100px] right-[-100px] w-[400px] h-[400px] rounded-full bg-secondary/10 blur-[100px] pointer-events-none" />
        <div className="absolute bottom-[-100px] left-[-100px] w-[300px] h-[300px] rounded-full bg-accent/10 blur-[100px] pointer-events-none" />

        <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
          <span className="text-xl font-bold text-primary text-glow-primary tracking-tight">
            WHISPR
          </span>
          <Link to="/login">
            <Button className="bg-primary text-primary-foreground glow-primary hover:brightness-110">
              Join Now
            </Button>
          </Link>
        </nav>

        <section className="relative z-10 flex flex-col items-center text-center px-6 pt-20 pb-32 max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            <span className="inline-block px-4 py-1.5 rounded-full text-xs font-mono font-medium text-primary border border-primary/30 bg-primary/5 mb-6">
              INVITE ONLY · ANONYMOUS · ENCRYPTED
            </span>
          </motion.div>

          <motion.h1
            className="text-5xl md:text-7xl font-bold leading-tight tracking-tight mb-6"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
          >
            Say anything.
            <br />
            <span className="text-primary text-glow-primary">Stay unknown.</span>
          </motion.h1>

          <motion.p
            className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-10"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
          >
            The private anonymous chat platform for your college crew. Confess, discuss, vote — all without anyone knowing who you are.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
          >
            <Link to="/login">
              <Button size="lg" className="bg-primary text-primary-foreground glow-primary hover:brightness-110 text-base px-8">
                Get Started
              </Button>
            </Link>
          </motion.div>
        </section>
      </div>

      {/* Features */}
      <section className="relative px-6 pb-32 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              className="glass rounded-xl p-6 hover:neon-border transition-all duration-300"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 + i * 0.1 }}
            >
              <f.icon className="w-8 h-8 text-primary mb-4" />
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        WHISPR · Anonymous College Chat · {new Date().getFullYear()}
      </footer>
    </div>
  );
};

export default Landing;
