import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface Confession {
  id: string; content: string; likes: number;
  created_at: string; user_id: string; category: string;
}
interface Comment {
  id: string; confession_id: string; content: string;
  created_at: string; user_id: string; anonymous_username: string;
}

const CATEGORIES = [
  { key: 'all', label: 'All', emoji: '🌐' },
  { key: 'crush', label: 'Crush', emoji: '💘' },
  { key: 'academic', label: 'Academic', emoji: '📚' },
  { key: 'funny', label: 'Funny', emoji: '😂' },
  { key: 'random', label: 'Random', emoji: '🎲' },
];

const COLORS = ['#7c3aed','#0891b2','#059669','#d97706','#be185d','#4338ca'];
const getColor = (s: string) => COLORS[s.charCodeAt(0) % COLORS.length];
const getInitials = (s: string) => s.slice(0, 2).toUpperCase();

const timeAgo = (d: string) => {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
};

import { User } from '@supabase/supabase-js';

function CommentPanel({ confession, user, profile, onClose }: {
  confession: Confession;
  user: User | null; 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [nameCache] = useState<Map<string, string>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('confession_comments')
        .select('*')
        .eq('confession_id', confession.id)
        .order('created_at', { ascending: true });
      if (error || !data) return;

      const ids = [...new Set(data.map(c => c.user_id))];
      if (ids.length) {
        const { data: users } = await supabase.from('users').select('id, anonymous_username').in('id', ids);
        users?.forEach(u => nameCache.set(u.id, u.anonymous_username));
      }
      setComments(data.map(c => ({ ...c, anonymous_username: nameCache.get(c.user_id) ?? '???' })));
    };
    load();

    const ch = supabase.channel(`comments:${confession.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'confession_comments', filter: `confession_id=eq.${confession.id}` },
        async (p) => {
          const c = p.new as Omit<Comment, 'anonymous_username'>;
          let name = nameCache.get(c.user_id);
          if (!name) {
            const { data } = await supabase.from('users').select('anonymous_username').eq('id', c.user_id).single();
            name = data?.anonymous_username ?? '???';
            nameCache.set(c.user_id, name);
          }
          setComments(prev => {
            if (prev.find(x => x.id === c.id)) return prev;
            return [...prev, { ...c, anonymous_username: name! }];
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confession.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [comments]);

  const post = async () => {
    const content = text.trim();
    if (!content || !user || posting) return;
    setPosting(true);
    // Optimistic
    const temp: Comment = {
      id: `OPT_${Date.now()}`, confession_id: confession.id, content,
      created_at: new Date().toISOString(), user_id: user.id,
      anonymous_username: profile?.anonymous_username ?? '???'
    };
    setComments(prev => [...prev, temp]);
    setText('');
    const { error } = await supabase.from('confession_comments').insert({
      confession_id: confession.id, user_id: user.id, content
    });
    if (error) setComments(prev => prev.filter(c => c.id !== temp.id));
    setPosting(false);
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div className="relative w-full max-w-lg mx-4 mb-0 md:mb-0 flex flex-col glass border border-white/10 rounded-t-3xl md:rounded-3xl overflow-hidden"
        style={{ maxHeight: '80vh' }}
        initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-semibold text-white text-sm">Comments</h3>
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{confession.content}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 transition-all">✕</button>
        </div>

        {/* Comments list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {comments.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              <div className="text-3xl mb-2">💬</div>
              <p className="text-sm">No comments yet. Be the first!</p>
            </div>
          ) : (
            <>
              {comments.map(c => {
                const isMe = c.user_id === user?.id;
                const color = getColor(c.anonymous_username);
                return (
                  <div key={c.id} className="flex gap-3 items-start">
                    <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold text-white mt-0.5"
                      style={{ background: color }}>
                      {getInitials(c.anonymous_username)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold" style={{ color }}>
                          {isMe ? `You (${c.anonymous_username})` : c.anonymous_username}
                        </span>
                        <span className="text-[10px] text-slate-600">{timeAgo(c.created_at)}</span>
                      </div>
                      <p className="text-sm text-slate-200 leading-relaxed">{c.content}</p>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-white/8 flex gap-3 items-center shrink-0">
          <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
            style={{ background: getColor(profile?.anonymous_username ?? 'me') }}>
            {getInitials(profile?.anonymous_username ?? 'Me')}
          </div>
          <input className="input-field flex-1 py-2 text-sm" placeholder="Write a comment..."
            value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && post()} maxLength={300} autoFocus />
          <motion.button onClick={post} disabled={!text.trim() || posting}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all"
            style={{ background: text.trim() ? 'linear-gradient(135deg, #7c3aed, #5b21b6)' : 'rgba(255,255,255,0.05)' }}
            whileTap={{ scale: 0.88 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={text.trim() ? 'white' : '#64748b'} strokeWidth="2.5">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Confessions() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [confessions, setConfessions] = useState<Confession[]>([]);
  const [text, setText] = useState('');
  const [category, setCategory] = useState('random');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'new' | 'hot'>('new');
  const [filterCat, setFilterCat] = useState('all');
  const [commentTarget, setCommentTarget] = useState<Confession | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});

  useEffect(() => { if (!loading && !user) navigate('/join'); }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;

    supabase.from('confessions').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { console.error('Confession load error:', error); return; }
        if (data) setConfessions(data as Confession[]);
      });

    // Load comment counts
    supabase.from('confession_comments').select('confession_id')
      .then(({ data }) => {
        if (!data) return;
        const counts: Record<string, number> = {};
        data.forEach(r => { counts[r.confession_id] = (counts[r.confession_id] || 0) + 1; });
        setCommentCounts(counts);
      });

    // ── Realtime subscription (simplified) ──
    const channelName = 'confessions-all';
    const ch = supabase.channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'confessions' }, (p) => {
        const newConf = p.new as Confession;
        setConfessions(prev => {
          if (prev.some(c => c.id === newConf.id)) return prev;
          return [newConf, ...prev];
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'confessions' }, (p) => {
        setConfessions(prev => prev.map(c => c.id === p.new.id ? p.new as Confession : c));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'confessions' }, (p) => {
        setConfessions(prev => prev.filter(c => c.id !== p.old.id));
      })
      .subscribe();

    // ── Fallback Polling (Every 10 seconds) ──
    const pollInterval = setInterval(async () => {
      const { data } = await supabase.from('confessions').select('*').order('created_at', { ascending: false }).limit(30);
      if (data) {
        setConfessions(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const newEntries = (data as Confession[]).filter(c => !existingIds.has(c.id));
          if (newEntries.length === 0) return prev;
          return [...newEntries, ...prev].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        });
      }
    }, 10000);

    return () => { 
      supabase.removeChannel(ch); 
      clearInterval(pollInterval);
    };
  }, [user]);

  const post = async () => {
    const content = text.trim();
    if (!content || !user || posting) return;
    setPosting(true); setPostError('');

    const tempId = `OPT_${Date.now()}`;
    const tempConfession: Confession = {
      id: tempId,
      content,
      user_id: user.id,
      category,
      likes: 0,
      created_at: new Date().toISOString()
    };

    // Optimistic update
    setConfessions(prev => [tempConfession, ...prev]);
    setText('');

    const { data: savedData, error } = await supabase.from('confessions').insert({
      content, user_id: user.id, category, likes: 0
    }).select().single();

    if (error) {
      console.error('Post error:', error);
      setPostError(`Failed: ${error.message}`);
      // Revert optimistic
      setConfessions(prev => prev.filter(c => c.id !== tempId));
    } else if (savedData) {
      // Replace optimistic with real data
      setConfessions(prev => prev.map(c => c.id === tempId ? savedData as Confession : c));
    }
    
    setPosting(false);
  };

  const like = async (c: Confession) => {
    if (likedIds.has(c.id)) return;
    setLikedIds(prev => new Set(prev).add(c.id));
    setConfessions(prev => prev.map(x => x.id === c.id ? { ...x, likes: x.likes + 1 } : x));
    await supabase.from('confessions').update({ likes: c.likes + 1 }).eq('id', c.id);
  };

  const deleteOwn = async (id: string) => {
    setConfessions(prev => prev.filter(c => c.id !== id));
    await supabase.from('confessions').delete().eq('id', id);
  };

  const displayed = confessions
    .filter(c => filterCat === 'all' || c.category === filterCat)
    .sort((a, b) => sortBy === 'hot' ? b.likes - a.likes : new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="ambient-blob w-[500px] h-[500px] bg-orange-600/10 top-[-100px] left-[20%]" />

      <header className="relative z-10 border-b border-white/5 glass sticky top-0">
        <div className="max-w-2xl mx-auto flex items-center gap-4 px-4 py-3.5">
          <Link to="/dashboard"><button className="btn-ghost rounded-xl p-2 text-slate-400">← Back</button></Link>
          <div>
            <h1 className="font-semibold text-white">🔥 Confessions</h1>
            <p className="text-xs text-slate-500">{confessions.length} total</p>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-6">
        {/* Post Box */}
        <motion.div className="glass border border-orange-500/20 rounded-2xl p-6 mb-6"
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h2 className="text-sm font-semibold text-orange-300 mb-3">✍️ Post a Confession</h2>
          <div className="flex gap-2 mb-3 flex-wrap">
            {CATEGORIES.slice(1).map(cat => (
              <button key={cat.key} onClick={() => setCategory(cat.key)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  category === cat.key ? 'border-orange-500/60 bg-orange-500/15 text-orange-300' : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}>
                {cat.emoji} {cat.label}
              </button>
            ))}
          </div>
          <textarea className="input-field resize-none" placeholder="Confess something... no one knows who you are."
            value={text} onChange={e => { setText(e.target.value); setPostError(''); }}
            rows={3} maxLength={500} />
          {postError && (
            <p className="text-xs text-red-400 mt-2 flex items-center gap-1">⚠️ {postError}</p>
          )}
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-slate-500">{text.length}/500</span>
            <button onClick={post} className="btn-primary !w-auto px-5 py-2 rounded-xl text-sm"
              disabled={!text.trim() || posting}>
              {posting ? 'Posting...' : 'Confess 🔥'}
            </button>
          </div>
        </motion.div>

        {/* Filter + Sort */}
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div className="flex gap-1.5 overflow-x-auto">
            {CATEGORIES.map(cat => (
              <button key={cat.key} onClick={() => setFilterCat(cat.key)}
                className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap transition-all ${
                  filterCat === cat.key ? 'border-orange-500/60 bg-orange-500/10 text-orange-300' : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}>
                {cat.emoji} {cat.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 shrink-0">
            {(['new', 'hot'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  sortBy === s ? 'border-orange-500/60 bg-orange-500/10 text-orange-300' : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}>
                {s === 'hot' ? '🔥 Hot' : '✨ New'}
              </button>
            ))}
          </div>
        </div>

        {/* Confession cards */}
        <div className="space-y-4">
          <AnimatePresence>
            {displayed.map((c, i) => (
              <motion.div key={c.id} className="glass border border-white/8 rounded-2xl p-5"
                initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: i < 5 ? i * 0.04 : 0 }}>
                {c.category && c.category !== 'random' && (
                  <span className="text-xs text-orange-400/70 font-medium mb-2 block">
                    {CATEGORIES.find(k => k.key === c.category)?.emoji} {CATEGORIES.find(k => k.key === c.category)?.label}
                  </span>
                )}
                <p className="text-slate-200 leading-relaxed mb-4 whitespace-pre-wrap">{c.content}</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-600">{timeAgo(c.created_at)}</span>
                    {/* Comment button */}
                    <button onClick={() => setCommentTarget(c)}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-400 transition-colors px-2 py-1 rounded-lg hover:bg-violet-500/10">
                      💬 {commentCounts[c.id] || 0}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.user_id === user?.id && (
                      <button onClick={() => deleteOwn(c.id)}
                        className="text-xs text-slate-600 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10">
                        Delete
                      </button>
                    )}
                    <button onClick={() => like(c)}
                      className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl transition-all ${
                        likedIds.has(c.id) ? 'bg-red-500/20 text-red-400' : 'text-slate-500 hover:bg-white/5 hover:text-red-400'
                      }`}>
                      🔥 {c.likes}
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {displayed.length === 0 && (
            <div className="text-center py-16">
              <div className="text-4xl mb-3">🔥</div>
              <p className="font-medium text-slate-400">No confessions here yet</p>
              <p className="text-sm text-slate-500 mt-1">Be the first to confess something</p>
            </div>
          )}
        </div>
      </main>

      {/* Comment panel */}
      <AnimatePresence>
        {commentTarget && (
          <CommentPanel
            key={commentTarget.id}
            confession={commentTarget}
            user={user}
            profile={profile}
            onClose={() => setCommentTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
