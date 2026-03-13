import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Megaphone,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Send,
  Sparkles,
  Flame,
  Hand,
  Heart,
  Laugh,
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface Shoutout {
  id: string;
  message: string;
  to_alias: string;
  from_alias: string;
  created_at: string;
  reactions?: Record<string, string[]>;
}

const REACTIONS = [
  { emoji: '❤️', accent: 'text-rose-300', border: 'hover:border-rose-400/40 hover:bg-rose-500/10' },
  { emoji: '😂', accent: 'text-amber-300', border: 'hover:border-amber-400/40 hover:bg-amber-500/10' },
  { emoji: '🔥', accent: 'text-orange-300', border: 'hover:border-orange-400/40 hover:bg-orange-500/10' },
  { emoji: '👏', accent: 'text-cyan-300', border: 'hover:border-cyan-400/40 hover:bg-cyan-500/10' },
  { emoji: '🙏', accent: 'text-violet-300', border: 'hover:border-violet-400/40 hover:bg-violet-500/10' },
] as const;

const TABS = ['all', 'for_me'] as const;

const TRENDING_CARDS = [
  {
    target: '@everyone',
    copy: '"The party in Room 404 is actually insane right now. Someone get in here!"',
    meta: '1.2k engagement',
    age: '2m ago',
    accent: 'from-cyan-400/60 to-emerald-400/0',
    border: 'border-cyan-400/70',
    targetClass: 'text-cyan-300',
  },
  {
    target: '@System',
    copy: '"I finally found the hidden voice note in the whisper channel."',
    meta: '842 hearts',
    age: '5m ago',
    accent: 'from-violet-400/60 to-fuchsia-400/0',
    border: 'border-violet-400/70',
    targetClass: 'text-violet-300',
  },
  {
    target: '@Devs',
    copy: '"The new audio filters are crisp. Love the robotic modulator."',
    meta: '650 claps',
    age: '12m ago',
    accent: 'from-pink-500/60 to-rose-400/0',
    border: 'border-pink-500/70',
    targetClass: 'text-pink-300',
  },
] as const;

const STARFIELD = Array.from({ length: 40 }, (_, index) => ({
  id: index,
  left: `${(index * 19) % 100}%`,
  top: `${(index * 23) % 100}%`,
  size: index % 5 === 0 ? 3 : 2,
  delay: (index % 7) * 0.6,
  duration: 2.8 + (index % 5) * 0.5,
}));

export default function Shoutouts() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [shoutouts, setShoutouts] = useState<Shoutout[]>([]);
  const [toAlias, setToAlias] = useState('');
  const [message, setMessage] = useState('');
  const [posting, setPosting] = useState(false);
  const [usernameList, setUsernameList] = useState<string[]>([]);
  const [tab, setTab] = useState<typeof TABS[number]>('all');
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>({});

  useEffect(() => {
    if (!loading && !user) {
      navigate('/join');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;

    supabase
      .from('shoutouts')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setShoutouts(data as Shoutout[]);
      });

    supabase
      .from('users')
      .select('anonymous_username')
      .then(({ data }) => {
        if (data) setUsernameList(data.map((entry) => entry.anonymous_username));
      });

    const channel = supabase
      .channel('shoutouts-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shoutouts' }, (payload) => {
        setShoutouts((prev) => [payload.new as Shoutout, ...prev]);
      })
      .on('broadcast', { event: 'shoutout_reaction' }, ({ payload }) => {
        setReactions((prev) => {
          const current = { ...(prev[payload.shoutoutId] ?? {}) };
          const who = current[payload.emoji] ?? [];
          if (who.includes(payload.userId)) return prev;
          current[payload.emoji] = [...who, payload.userId];
          return { ...prev, [payload.shoutoutId]: current };
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const addReaction = (shoutoutId: string, emoji: string) => {
    if (!user) return;

    setReactions((prev) => {
      const current = { ...(prev[shoutoutId] ?? {}) };
      const who = current[emoji] ?? [];
      if (who.includes(user.id)) return prev;
      current[emoji] = [...who, user.id];
      return { ...prev, [shoutoutId]: current };
    });
  };

  const post = async () => {
    const to = toAlias.trim();
    const msg = message.trim();

    if (!to || !msg || !user || posting) return;

    setPosting(true);
    setToAlias('');
    setMessage('');

    await supabase.from('shoutouts').insert({
      to_alias: to,
      message: msg,
      from_alias: profile?.anonymous_username ?? 'Someone',
      user_id: user.id,
    });

    setPosting(false);
  };

  const deleteShoutout = async (shoutoutId: string) => {
    if (!window.confirm('Delete this shoutout?')) return;

    const { error } = await supabase.from('shoutouts').delete().eq('id', shoutoutId);

    if (!error) {
      setShoutouts((prev) => prev.filter((item) => item.id !== shoutoutId));
    } else {
      console.error('Delete shoutout error:', error);
    }
  };

  const timeAgo = (date: string) => {
    const diff = (Date.now() - new Date(date).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const myName = profile?.anonymous_username;
  const displayed = tab === 'for_me' ? shoutouts.filter((item) => item.to_alias === myName) : shoutouts;
  const receivedCount = shoutouts.filter((item) => item.to_alias === myName).length;
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#06070d]">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#04050a] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(111,55,255,0.16),transparent_24%),radial-gradient(circle_at_78%_62%,rgba(0,245,212,0.12),transparent_26%),linear-gradient(180deg,#06060b_0%,#03040a_48%,#010308_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(circle_at_center,black_35%,transparent_90%)]" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {STARFIELD.map((star) => (
          <motion.span
            key={star.id}
            className="absolute rounded-full bg-violet-300/80"
            style={{ left: star.left, top: star.top, width: star.size, height: star.size }}
            animate={{ opacity: [0.2, 0.9, 0.25], scale: [1, 1.4, 1] }}
            transition={{ duration: star.duration, repeat: Infinity, delay: star.delay, ease: 'easeInOut' }}
          />
        ))}
      </div>

      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/30 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard" className="rounded-full border border-white/10 p-2.5 text-white/60 transition hover:border-white/20 hover:bg-white/5 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="bg-gradient-to-r from-violet-400 via-fuchsia-300 to-cyan-300 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
                SHOUTOUTS
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-[0.42em] text-white/45">
                Anonymous Love &amp; Chaos
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-5xl flex-col gap-10 px-5 py-8 sm:px-8 lg:py-10">
        <motion.section
          id="composer"
          className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(124,58,237,0.12),rgba(255,255,255,0.02)_34%,rgba(255,255,255,0.02)_68%,rgba(0,245,212,0.07))] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl sm:p-8"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-violet-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 right-20 h-32 w-32 rounded-full bg-cyan-500/10 blur-3xl" />

          <div className="relative">
            <div className="mb-8 flex items-center gap-3">
              <div className="rounded-xl bg-violet-500/20 p-3 text-violet-300">
                <Megaphone className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-3xl font-extrabold tracking-tight text-white">Cast a Shoutout</h2>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="ml-1 block font-mono text-[10px] uppercase tracking-[0.32em] text-white/40">
                  Target Dimension (Username)
                </label>
                <input
                  list="usernames"
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-base text-cyan-200 outline-none transition focus:border-violet-400/50 focus:bg-violet-500/[0.07] focus:ring-2 focus:ring-violet-500/20"
                  placeholder="@who_is_this_for?"
                  value={toAlias}
                  onChange={(event) => setToAlias(event.target.value)}
                  maxLength={30}
                />
                <datalist id="usernames">
                  {usernameList.filter((name) => name !== myName).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-2">
                <label className="ml-1 block font-mono text-[10px] uppercase tracking-[0.32em] text-white/40">
                  The Message
                </label>
                <textarea
                  className="min-h-[140px] w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-base text-white outline-none transition focus:border-violet-400/50 focus:bg-violet-500/[0.07] focus:ring-2 focus:ring-violet-500/20"
                  placeholder="Whisper into the void..."
                  rows={5}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={300}
                />
                <div className="flex items-center justify-between px-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">Max: 300 chars</span>
                  <span className="font-mono text-[11px] text-violet-300">{message.length} / 300</span>
                </div>
              </div>

              <div className="flex flex-col gap-4 border-t border-white/8 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-white/45">
                  Manifesting as:
                  <span className="ml-2 rounded-md bg-cyan-400/15 px-2 py-1 font-mono text-xs text-cyan-300">
                    {profile?.anonymous_username ?? 'Ghost_System'}
                  </span>
                </div>

                <button
                  onClick={post}
                  disabled={!toAlias.trim() || !message.trim() || posting}
                  className="group inline-flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-8 py-4 text-sm font-extrabold tracking-wide text-white shadow-[0_0_25px_rgba(168,85,247,0.45)] transition hover:scale-[1.01] hover:shadow-[0_0_35px_rgba(34,211,238,0.25)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 sm:min-w-[196px]"
                >
                  <span>{posting ? 'BROADCASTING...' : 'BROADCAST'}</span>
                  <Send className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          </div>
        </motion.section>

        <section>
          <div className="mb-4 flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-pink-500 shadow-[0_0_18px_rgba(236,72,153,0.75)]" />
            <h3 className="text-sm font-extrabold uppercase tracking-[0.28em] text-pink-400">Trending Now</h3>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TRENDING_CARDS.map((card) => (
              <motion.article
                key={card.target}
                className={`group relative min-w-[280px] overflow-hidden rounded-[1.6rem] border ${card.border} bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.22)]`}
                whileHover={{ y: -4 }}
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${card.accent} opacity-20 transition group-hover:opacity-30`} />
                <div className="relative space-y-3">
                  <p className="text-sm text-white/55">
                    to <span className={`font-bold ${card.targetClass}`}>{card.target}</span>
                  </p>
                  <p className="text-xl font-medium italic leading-8 text-white/90">{card.copy}</p>
                  <div className="flex items-center gap-2 text-xs text-white/40">
                    <span>{card.meta}</span>
                    <span>•</span>
                    <span>{card.age}</span>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-3">
          {[
            { id: 'all', label: `Global`, extra: shoutouts.length },
            { id: 'for_me', label: 'My Room', extra: receivedCount },
            { id: 'ghost', label: 'Whispers', extra: null },
          ].map((item) => {
            const active = item.id === tab;
            const isDisabled = item.id === 'ghost';

            return (
              <button
                key={item.id}
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  if (item.id === 'all' || item.id === 'for_me') {
                    setTab(item.id);
                  }
                }}
                className={[
                  'inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold transition',
                  active
                    ? 'border-violet-400/70 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-[0_0_24px_rgba(168,85,247,0.4)]'
                    : 'border-white/10 bg-white/[0.03] text-white/65 hover:border-white/20 hover:bg-white/[0.05] hover:text-white',
                  isDisabled ? 'cursor-default opacity-90' : '',
                ].join(' ')}
              >
                <span>{item.label}</span>
                {typeof item.extra === 'number' && (
                  <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-white/15 text-white' : 'bg-white/8 text-white/60'}`}>
                    {item.extra}
                  </span>
                )}
              </button>
            );
          })}

          <div className="ml-auto flex items-center gap-2 text-white/35">
            <Sparkles className="h-4 w-4" />
            <span className="font-mono text-xs uppercase tracking-[0.28em]">Sort: Recent</span>
          </div>
        </section>

        <section className="space-y-6">
          <AnimatePresence>
            {displayed.map((shoutout, index) => {
              const isForMe = shoutout.to_alias === myName;
              const localReactions = reactions[shoutout.id] ?? {};
              const storedReactions = shoutout.reactions ?? {};
              const channelLabel = index % 2 === 0 ? 'Voice Node 04' : 'Text Relay';
              const replyLabel = 'Reply';
              const AccentIcon = index % 2 === 0 ? Mic : MessageCircle;

              return (
                <motion.article
                  key={shoutout.id}
                  className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015)_42%,rgba(4,120,87,0.14))] p-6 shadow-[0_20px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl"
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ delay: index * 0.04 }}
                >
                  <div className={`pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100 ${isForMe ? 'bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_28%)]' : 'bg-[radial-gradient(circle_at_top_right,rgba(168,85,247,0.12),transparent_28%)]'}`} />

                  <div className="relative">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex gap-4">
                        <div
                          className={[
                            'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border',
                            index % 2 === 0
                              ? 'border-cyan-400/35 bg-gradient-to-br from-cyan-500/15 to-blue-500/10 text-cyan-300'
                              : 'border-violet-400/35 bg-gradient-to-br from-violet-500/15 to-pink-500/10 text-violet-300',
                          ].join(' ')}
                        >
                          <AccentIcon className="h-6 w-6" />
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-white/35">To</span>
                            <span className="text-2xl font-extrabold tracking-tight text-white">@{shoutout.to_alias}</span>
                            {isForMe && (
                              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200">
                                For You
                              </span>
                            )}
                          </div>

                          <p className="mt-3 max-w-3xl text-[1.15rem] leading-9 text-white/90 sm:text-[1.35rem]">
                            {shoutout.message}
                          </p>

                          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.24em] text-white/28">
                            Received {timeAgo(shoutout.created_at)} via {channelLabel}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {profile?.is_admin && (
                          <button
                            onClick={() => deleteShoutout(shoutout.id)}
                            className="rounded-full border border-white/10 p-2 text-white/35 transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                        <button className="rounded-full p-2 text-white/20 transition hover:bg-white/5 hover:text-white/60">
                          <MoreHorizontal className="h-5 w-5" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-col gap-4 border-t border-white/8 pt-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        {REACTIONS.map((reaction) => {
                          const localCount = localReactions[reaction.emoji]?.length ?? 0;
                          const storedCount = storedReactions[reaction.emoji]?.length ?? 0;
                          const totalCount = Math.max(localCount, storedCount);
                          const hasReacted = Boolean(user && (localReactions[reaction.emoji] ?? []).includes(user.id));

                          return (
                            <button
                              key={reaction.emoji}
                              onClick={() => addReaction(shoutout.id, reaction.emoji)}
                              className={[
                                'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition',
                                hasReacted
                                  ? 'border-violet-400/40 bg-violet-500/12 text-white'
                                  : `border-transparent bg-transparent text-white/65 ${reaction.border}`,
                              ].join(' ')}
                            >
                              <span className="text-base">{reaction.emoji}</span>
                              <span className={`inline-flex items-center gap-1 font-mono text-xs ${hasReacted ? 'text-white' : reaction.accent}`}>
                                {totalCount}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <button className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5 text-sm font-bold text-white/70 transition hover:border-cyan-400/35 hover:bg-cyan-400/10 hover:text-cyan-200">
                        <AccentIcon className="h-4 w-4" />
                        {replyLabel.toUpperCase()}
                      </button>
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>

          {displayed.length === 0 && (
            <div className="rounded-[2rem] border border-dashed border-white/10 bg-white/[0.02] px-6 py-20 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-violet-400/30 bg-violet-500/10 text-violet-300">
                <Megaphone className="h-7 w-7" />
              </div>
              <p className="text-xl font-semibold text-white">
                {tab === 'for_me' ? 'No shoutouts for you yet' : 'No shoutouts drifting through the grid yet'}
              </p>
              <p className="mt-2 text-sm text-white/45">Once messages start dropping, this feed will light up automatically.</p>
            </div>
          )}
        </section>

        <div className="flex justify-center pb-10 pt-2">
          <button className="rounded-full border border-white/10 px-10 py-3 font-mono text-sm uppercase tracking-[0.28em] text-white/45 transition hover:border-cyan-400/35 hover:bg-cyan-400/5 hover:text-cyan-200">
            Decrypt More Memories
          </button>
        </div>
      </main>

      <button
        type="button"
        onClick={() => document.getElementById('composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-[0_0_28px_rgba(168,85,247,0.45)] transition hover:scale-105 md:hidden"
      >
        <Megaphone className="h-6 w-6" />
      </button>
    </div>
  );
}
