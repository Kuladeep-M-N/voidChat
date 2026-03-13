import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ChevronRight,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Radio,
  Send,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';

interface Shoutout {
  id: string;
  message: string;
  to_alias: string;
  from_alias: string;
  created_at: string;
  reactions?: Record<string, string[]>;
}

type TabKey = 'all' | 'for_me';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: 'Global' },
  { key: 'for_me', label: 'My Room' },
];

const REACTIONS = [
  { key: 'love', emoji: '\u2764\uFE0F', tint: 'hover:border-pink-400/30 hover:bg-pink-500/10 hover:text-pink-200' },
  { key: 'laugh', emoji: '\u{1F602}', tint: 'hover:border-amber-400/30 hover:bg-amber-500/10 hover:text-amber-200' },
  { key: 'fire', emoji: '\u{1F525}', tint: 'hover:border-orange-400/30 hover:bg-orange-500/10 hover:text-orange-200' },
  { key: 'clap', emoji: '\u{1F44F}', tint: 'hover:border-cyan-400/30 hover:bg-cyan-500/10 hover:text-cyan-200' },
  { key: 'pray', emoji: '\u{1F64F}', tint: 'hover:border-indigo-400/30 hover:bg-indigo-500/10 hover:text-indigo-200' },
] as const;

const FALLBACK_TRENDING = [
  {
    to: 'everyone',
    body: 'The party in Room 404 is actually insane right now. Someone get in here!',
    accent: 'from-cyan-400/80 to-teal-400/60',
    meta: '1.2k engagement',
    time: '2m ago',
  },
  {
    to: 'System',
    body: 'I finally found the hidden voice note in the whisper channel.',
    accent: 'from-violet-400/80 to-fuchsia-400/60',
    meta: '842 hearts',
    time: '5m ago',
  },
  {
    to: 'Devs',
    body: 'The new audio filters are crisp. Love the robotic modulator.',
    accent: 'from-rose-500/80 to-red-400/60',
    meta: '650 claps',
    time: '12m ago',
  },
];

const STAR_FIELD = Array.from({ length: 28 }, (_, index) => ({
  id: index,
  left: `${(index * 13) % 100}%`,
  top: `${(index * 23 + 11) % 100}%`,
  size: index % 3 === 0 ? 3 : 2,
  delay: `${(index % 8) * 0.4}s`,
}));

const countLabel = (count: number) => {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return `${count}`;
};

const timeAgo = (date: string) => {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const channelFlavor = (seed: string) => {
  const flavors = ['Voice Node 04', 'Text Relay', 'Signal Burst', 'Ghost Channel'];
  const value = seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return flavors[value % flavors.length];
};

const laneAccent = (index: number) =>
  [
    'from-cyan-500/18 via-transparent to-transparent',
    'from-violet-500/18 via-transparent to-transparent',
    'from-rose-500/18 via-transparent to-transparent',
  ][index % 3];

export default function Shoutouts() {
  const { user, profile, loading } = useAuth();
  const { onlineCount } = useNotifications();
  const navigate = useNavigate();

  const [shoutouts, setShoutouts] = useState<Shoutout[]>([]);
  const [toAlias, setToAlias] = useState('');
  const [message, setMessage] = useState('');
  const [posting, setPosting] = useState(false);
  const [usernameList, setUsernameList] = useState<string[]>([]);
  const [tab, setTab] = useState<TabKey>('all');
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>({});

  useEffect(() => {
    if (!loading && !user) navigate('/join');
  }, [loading, navigate, user]);

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
        setShoutouts((current) => [payload.new as Shoutout, ...current]);
      })
      .on('broadcast', { event: 'shoutout_reaction' }, ({ payload }) => {
        setReactions((current) => {
          const nextShoutout = { ...(current[payload.shoutoutId] ?? {}) };
          const reacted = nextShoutout[payload.emoji] ?? [];
          if (reacted.includes(payload.userId)) return current;
          nextShoutout[payload.emoji] = [...reacted, payload.userId];
          return { ...current, [payload.shoutoutId]: nextShoutout };
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const addReaction = (shoutoutId: string, emoji: string) => {
    if (!user) return;

    setReactions((current) => {
      const nextShoutout = { ...(current[shoutoutId] ?? {}) };
      const reacted = nextShoutout[emoji] ?? [];
      if (reacted.includes(user.id)) return current;
      nextShoutout[emoji] = [...reacted, user.id];
      return { ...current, [shoutoutId]: nextShoutout };
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
    if (!profile?.is_admin) return;
    if (!window.confirm('Delete this shoutout?')) return;

    const { error } = await supabase.from('shoutouts').delete().eq('id', shoutoutId);
    if (!error) {
      setShoutouts((current) => current.filter((item) => item.id !== shoutoutId));
    } else {
      console.error('Delete shoutout error:', error);
    }
  };

  const myName = profile?.anonymous_username;
  const forMeCount = shoutouts.filter((item) => item.to_alias === myName).length;

  const displayed = useMemo(
    () => (tab === 'for_me' ? shoutouts.filter((item) => item.to_alias === myName) : shoutouts),
    [myName, shoutouts, tab],
  );

  const trendingCards = useMemo(() => {
    if (shoutouts.length === 0) return FALLBACK_TRENDING;

    return shoutouts.slice(0, 3).map((item, index) => {
      const syntheticCount = Math.max(180, item.message.length * 12 + (index + 1) * 74);
      return {
        to: item.to_alias,
        body: item.message,
        accent: ['from-cyan-400/80 to-teal-400/60', 'from-violet-400/80 to-fuchsia-400/60', 'from-rose-500/80 to-red-400/60'][index % 3],
        meta: `${countLabel(syntheticCount)} engagement`,
        time: timeAgo(item.created_at),
      };
    });
  }, [shoutouts]);

  const shoutoutPulse = useMemo(
    () => `${countLabel(Math.max(shoutouts.length * 14, 42))} live echoes`,
    [shoutouts.length],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05060b] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.18),transparent_28%),radial-gradient(circle_at_80%_65%,rgba(6,182,212,0.12),transparent_24%),linear-gradient(180deg,#06060d_0%,#04040a_48%,#020308_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(circle_at_center,black_35%,transparent_90%)]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>
      <div className="ambient-blob left-[-10%] top-[8%] h-[420px] w-[420px] bg-violet-700/18" />
      <div className="ambient-blob bottom-[-10%] right-[-6%] h-[420px] w-[420px] bg-cyan-500/12" />

      {STAR_FIELD.map((star) => (
        <span
          key={star.id}
          className="pointer-events-none absolute animate-pulse rounded-full bg-violet-400/80"
          style={{
            left: star.left,
            top: star.top,
            width: `${star.size}px`,
            height: `${star.size}px`,
            animationDelay: star.delay,
            boxShadow: '0 0 12px rgba(167, 139, 250, 0.45)',
          }}
        />
      ))}

      <header className="glass sticky top-0 z-20 border-b border-white/8 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
              aria-label="Back to dashboard"
            >
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="bg-gradient-to-r from-violet-300 via-fuchsia-400 to-cyan-300 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
                SHOUTOUTS
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-slate-500">
                Anonymous Love &amp; Chaos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {profile?.is_admin ? (
              <span className="hidden rounded-full border border-red-500/25 bg-red-500/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-red-300 md:inline-flex">
                Admin
              </span>
            ) : null}
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-black/30 px-4 py-2 md:flex">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
              <span className="font-mono text-xs text-slate-300">{countLabel(onlineCount * 42)} Active Souls</span>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 p-[1px] shadow-[0_0_28px_rgba(168,85,247,0.25)]">
              <div className="flex h-full w-full items-center justify-center rounded-full bg-[#090911] text-xs font-extrabold text-white">
                ANON
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
        <motion.section
          id="composer"
          className="glass relative overflow-hidden rounded-[2rem] border border-white/10 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)] sm:p-8"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(168,85,247,0.18),transparent_55%)]" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-32 w-32 rounded-full bg-cyan-500/10 blur-3xl" />

          <div className="relative">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300 shadow-[0_0_24px_rgba(139,92,246,0.18)]">
                  <Radio size={22} />
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-violet-300/70">Broadcast</p>
                  <h2 className="text-2xl font-bold text-white">Cast a Shoutout</h2>
                </div>
              </div>

              <div className="rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                <span className="block font-mono text-[10px] uppercase tracking-[0.28em] text-slate-500">Signal</span>
                <span className="mt-1 inline-flex items-center gap-2">
                  <Sparkles size={14} className="text-cyan-300" />
                  {shoutoutPulse}
                </span>
              </div>
            </div>

            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                post();
              }}
            >
              <div>
                <label className="mb-2 ml-1 block font-mono text-[10px] uppercase tracking-[0.28em] text-slate-500">
                  Target Dimension (username)
                </label>
                <input
                  list="usernames"
                  className="input-field rounded-2xl border-white/10 bg-white/[0.04] px-4 py-4 text-cyan-200 placeholder:text-slate-500"
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

              <div>
                <label className="mb-2 ml-1 block font-mono text-[10px] uppercase tracking-[0.28em] text-slate-500">
                  The Message
                </label>
                <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-1">
                  <textarea
                    className="input-field min-h-[170px] resize-none border-0 bg-transparent px-3 py-3 text-base leading-7 text-slate-100 shadow-none placeholder:text-slate-500 focus:bg-transparent focus:shadow-none"
                    placeholder="Whisper into the void..."
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={5}
                    maxLength={300}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between px-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Max: 300 chars</span>
                  <span className="font-mono text-[11px] text-violet-300">{message.length} / 300</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/6 pt-5">
                <div className="text-sm text-slate-400">
                  <span>Manifesting as: </span>
                  <span className="ml-2 inline-flex rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 font-mono text-xs font-semibold text-cyan-300">
                    {profile?.anonymous_username ?? 'Ghost_System'}
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={!toAlias.trim() || !message.trim() || posting}
                  className="inline-flex min-w-[210px] items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-violet-400 px-6 py-4 text-base font-extrabold tracking-tight text-white shadow-[0_16px_44px_rgba(168,85,247,0.38)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_52px_rgba(168,85,247,0.5)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>{posting ? 'BROADCASTING...' : 'BROADCAST'}</span>
                  <Send size={18} />
                </button>
              </div>
            </form>
          </div>
        </motion.section>

        <section className="mt-10">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-rose-500 shadow-[0_0_16px_rgba(244,63,94,0.85)]" />
            <h3 className="text-sm font-extrabold uppercase tracking-[0.24em] text-rose-400">Trending Now</h3>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-3">
            {trendingCards.map((card, index) => (
              <motion.article
                key={`${card.to}-${index}`}
                className="glass min-w-[280px] overflow-hidden rounded-[1.6rem] border border-white/10"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <div className={`h-1 w-full bg-gradient-to-r ${card.accent}`} />
                <div className="p-5">
                  <p className="text-xs text-slate-400">
                    to <span className="font-bold text-white">@{card.to}</span>
                  </p>
                  <p className="mt-3 text-lg italic leading-8 text-slate-100">&quot;{card.body}&quot;</p>
                  <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500">
                    <span>{card.meta}</span>
                    <span>&bull;</span>
                    <span>{card.time}</span>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </section>

        <section className="mt-10 flex flex-wrap items-center gap-3">
          {TABS.map((item) => {
            const active = tab === item.key;
            const badge = item.key === 'for_me' ? forMeCount : shoutouts.length;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`rounded-full border px-6 py-2.5 text-sm font-semibold transition ${
                  active
                    ? 'border-violet-400/40 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-[0_10px_28px_rgba(168,85,247,0.35)]'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/8 hover:text-white'
                }`}
              >
                {item.label}
                <span className={`ml-2 text-xs ${active ? 'text-white/85' : 'text-slate-500'}`}>{badge}</span>
              </button>
            );
          })}

          <div className="ml-auto flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">
            <ChevronRight size={14} />
            <span>Sort: Recent</span>
          </div>
        </section>

        <section className="mt-8 space-y-5">
          <AnimatePresence mode="popLayout">
            {displayed.map((item, index) => {
              const isForMe = item.to_alias === myName;
              const shoutoutReactions = reactions[item.id] ?? {};
              const iconTone =
                index % 2 === 0
                  ? 'text-cyan-300 border-cyan-400/25 bg-cyan-500/10'
                  : 'text-violet-300 border-violet-400/25 bg-violet-500/10';
              const CardIcon = index % 2 === 0 ? Mic : MessageCircle;

              return (
                <motion.article
                  key={item.id}
                  layout
                  className="glass group relative overflow-hidden rounded-[2rem] border border-white/10"
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10, scale: 0.98 }}
                  transition={{ delay: index < 6 ? index * 0.04 : 0 }}
                >
                  <div className={`pointer-events-none absolute inset-0 bg-gradient-to-r ${laneAccent(index)} opacity-80`} />
                  <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.12),transparent_60%)] opacity-80" />

                  <div className="relative p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex gap-4">
                        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border ${iconTone}`}>
                          <CardIcon size={24} />
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="text-slate-400">To</span>
                            <span className="font-extrabold text-white">@{item.to_alias}</span>
                            {isForMe ? (
                              <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-200">
                                For you
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-3 max-w-3xl text-xl leading-9 text-slate-100">{item.message}</p>
                          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.24em] text-slate-500">
                            Received {timeAgo(item.created_at)} via {channelFlavor(item.id)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {profile?.is_admin ? (
                          <button
                            type="button"
                            onClick={() => deleteShoutout(item.id)}
                            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
                            aria-label="Delete shoutout"
                          >
                            <Trash2 size={16} />
                          </button>
                        ) : null}

                        <button
                          type="button"
                          className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/8 hover:text-white"
                          aria-label="More actions"
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/8 pt-5">
                      <div className="flex flex-wrap items-center gap-2">
                        {REACTIONS.map((reaction) => {
                          const users = shoutoutReactions[reaction.key] ?? [];
                          const reacted = !!user && users.includes(user.id);

                          return (
                            <button
                              key={reaction.key}
                              type="button"
                              onClick={() => addReaction(item.id, reaction.key)}
                              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                                reacted
                                  ? 'border-violet-400/35 bg-violet-500/12 text-violet-100'
                                  : `border-transparent bg-transparent text-slate-400 ${reaction.tint}`
                              }`}
                            >
                              <span>{reaction.emoji}</span>
                              <span className="font-mono text-xs">{users.length}</span>
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-cyan-400/25 hover:bg-cyan-500/10 hover:text-cyan-100"
                      >
                        {index % 2 === 0 ? <Volume2 size={15} /> : <MessageCircle size={15} />}
                        {index % 2 === 0 ? 'Reply With Voice' : 'Reply'}
                      </button>
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>

          {displayed.length === 0 ? (
            <div className="glass rounded-[2rem] border border-dashed border-white/10 px-6 py-16 text-center">
              <Sparkles className="mx-auto mb-3 text-slate-500" size={28} />
              <p className="text-lg font-medium text-slate-200">
                {tab === 'for_me' ? 'No shoutouts in your room yet.' : 'No shoutouts yet.'}
              </p>
              <p className="mt-2 text-sm text-slate-500">The next anonymous message can set the tone for the whole feed.</p>
            </div>
          ) : null}
        </section>

        <div className="flex justify-center pb-10 pt-10">
          <button
            type="button"
            className="rounded-full border border-white/10 px-10 py-3 font-mono text-sm uppercase tracking-[0.26em] text-slate-500 transition hover:border-cyan-400/30 hover:bg-cyan-500/5 hover:text-cyan-200"
          >
            Decrypt More Memories
          </button>
        </div>
      </main>

      <button
        type="button"
        onClick={() => document.getElementById('composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        className="fixed bottom-6 right-6 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-[0_0_30px_rgba(168,85,247,0.45)] transition hover:scale-105 md:hidden"
        aria-label="Open composer"
      >
        <Send size={20} />
      </button>
    </div>
  );
}
