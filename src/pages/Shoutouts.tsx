import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface Shoutout {
  id: string; message: string; to_alias: string; from_alias: string;
  created_at: string; reactions?: Record<string, string[]>;
}

const REACTIONS = ['❤️', '😂', '😮', '👏', '🙏'];
const TABS = ['all', 'for_me'] as const;

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

  useEffect(() => { if (!loading && !user) navigate('/join'); }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase.from('shoutouts').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setShoutouts(data as Shoutout[]); });
    supabase.from('users').select('anonymous_username')
      .then(({ data }) => { if (data) setUsernameList(data.map(u => u.anonymous_username)); });

    const ch = supabase.channel('shoutouts-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shoutouts' }, (p) => {
        setShoutouts(prev => [p.new as Shoutout, ...prev]);
      })
      .on('broadcast', { event: 'shoutout_reaction' }, ({ payload }) => {
        setReactions(prev => {
          const r = { ...(prev[payload.shoutoutId] ?? {}) };
          const who = r[payload.emoji] ?? [];
          if (who.includes(payload.userId)) return prev;
          r[payload.emoji] = [...who, payload.userId];
          return { ...prev, [payload.shoutoutId]: r };
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const addReaction = (shoutoutId: string, emoji: string, channel: ReturnType<typeof supabase.channel> | null) => {
    if (!user) return;
    setReactions(prev => {
      const r = { ...(prev[shoutoutId] ?? {}) };
      const who = r[emoji] ?? [];
      if (who.includes(user.id)) return prev;
      r[emoji] = [...who, user.id];
      return { ...prev, [shoutoutId]: r };
    });
  };

  const post = async () => {
    const to = toAlias.trim(), msg = message.trim();
    if (!to || !msg || !user || posting) return;
    setPosting(true); setToAlias(''); setMessage('');
    await supabase.from('shoutouts').insert({
      to_alias: to, message: msg,
      from_alias: profile?.anonymous_username ?? 'Someone',
      user_id: user.id,
    });
    setPosting(false);
  };

  const timeAgo = (date: string) => {
    const diff = (Date.now() - new Date(date).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const myName = profile?.anonymous_username;
  const displayed = tab === 'for_me' ? shoutouts.filter(s => s.to_alias === myName) : shoutouts;

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="ambient-blob w-[500px] h-[500px] bg-pink-600/10 top-[-100px] left-[20%]" />

      <header className="relative z-10 border-b border-white/5 glass sticky top-0">
        <div className="max-w-2xl mx-auto flex items-center gap-4 px-4 py-3.5">
          <Link to="/dashboard"><button className="btn-ghost rounded-xl p-2 text-slate-400">← Back</button></Link>
          <div><h1 className="font-semibold text-white">📣 Shoutouts</h1>
            <p className="text-xs text-slate-500">Anonymous love & chaos</p></div>
        </div>
      </header>

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-6">
        {/* Post Box */}
        <motion.div className="glass border border-pink-500/20 rounded-2xl p-6 mb-6"
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h2 className="text-sm font-semibold text-pink-300 mb-4">📣 Send a Shoutout</h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 mb-1.5 block">To (username)</label>
              <input list="usernames" className="input-field" placeholder="Who's this for?" value={toAlias}
                onChange={e => setToAlias(e.target.value)} maxLength={30} />
              <datalist id="usernames">
                {usernameList.filter(u => u !== myName).map(u => <option key={u} value={u} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1.5 block">Message</label>
              <textarea className="input-field resize-none" placeholder="Say what you can't say out loud..."
                rows={3} value={message} onChange={e => setMessage(e.target.value)} maxLength={300} />
              <p className="text-xs text-slate-600 text-right mt-1">{message.length}/300</p>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-slate-600">From: <span className="text-pink-400">anonymous</span></span>
            <button onClick={post} className="btn-primary !w-auto px-5 py-2 rounded-xl text-sm"
              disabled={!toAlias.trim() || !message.trim() || posting}>
              {posting ? 'Sending...' : 'Send 📣'}
            </button>
          </div>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          <button onClick={() => setTab('all')}
            className={`text-sm px-4 py-2 rounded-xl border transition-all ${tab === 'all' ? 'border-pink-500/40 bg-pink-500/10 text-pink-300' : 'border-white/10 text-slate-500 hover:border-white/20'}`}>
            🌎 All ({shoutouts.length})
          </button>
          <button onClick={() => setTab('for_me')}
            className={`text-sm px-4 py-2 rounded-xl border transition-all flex items-center gap-2 ${tab === 'for_me' ? 'border-pink-500/40 bg-pink-500/10 text-pink-300' : 'border-white/10 text-slate-500 hover:border-white/20'}`}>
            💌 For Me
            {shoutouts.filter(s => s.to_alias === myName).length > 0 && (
              <span className="w-5 h-5 rounded-full bg-pink-500 text-white text-xs flex items-center justify-center">
                {shoutouts.filter(s => s.to_alias === myName).length}
              </span>
            )}
          </button>
        </div>

        {/* List */}
        <div className="space-y-4">
          <AnimatePresence>
            {displayed.map((s, i) => {
              const isForMe = s.to_alias === myName;
              const msgReactions = reactions[s.id] ?? {};
              return (
                <motion.div key={s.id}
                  className={`glass rounded-2xl p-5 border ${isForMe ? 'border-pink-500/40 bg-pink-500/5' : 'border-white/8'}`}
                  initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  {isForMe && <div className="text-xs font-bold text-pink-400 mb-2 flex items-center gap-1">💌 This is for you!</div>}
                  <div className="flex items-start gap-3">
                    <div className="text-2xl shrink-0">📣</div>
                    <div className="flex-1">
                      <div className="text-xs text-slate-500 mb-1.5">
                        To <span className={`font-semibold ${isForMe ? 'text-pink-300' : 'text-slate-300'}`}>@{s.to_alias}</span>
                      </div>
                      <p className="text-slate-200 text-sm leading-relaxed">{s.message}</p>
                      <div className="text-xs text-slate-600 mt-2">{timeAgo(s.created_at)}</div>
                      {/* Reactions */}
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        {REACTIONS.map(emoji => {
                          const who = msgReactions[emoji] ?? [];
                          const hasReacted = who.includes(user!.id);
                          return (
                            <button key={emoji} onClick={() => addReaction(s.id, emoji, null)}
                              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all ${
                                hasReacted ? 'border-pink-500/50 bg-pink-500/15 text-pink-300' : 'border-white/10 text-slate-600 hover:border-pink-500/30 hover:text-pink-300'
                              }`}>
                              {emoji}{who.length > 0 && <span>{who.length}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {displayed.length === 0 && (
            <div className="text-center py-16">
              <div className="text-4xl mb-3">{tab === 'for_me' ? '💌' : '📣'}</div>
              <p className="font-medium text-slate-400">{tab === 'for_me' ? 'No shoutouts for you yet' : 'No shoutouts yet'}</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
