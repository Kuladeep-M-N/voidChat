import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface Poll {
  id: string; question: string; options: string[];
  created_at: string; created_by: string;
  tag: string; closed: boolean;
}
interface Vote { poll_id: string; option_index: number; user_id: string; }

const TAGS = [
  { key: 'all', label: 'All', emoji: '🌐' },
  { key: 'fun', label: 'Fun', emoji: '🎉' },
  { key: 'serious', label: 'Serious', emoji: '🧠' },
  { key: 'college', label: 'College', emoji: '🎓' },
  { key: 'random', label: 'Random', emoji: '🎲' },
];

export default function Polls() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [polls, setPolls] = useState<Poll[]>([]);
  const [allVotes, setAllVotes] = useState<Vote[]>([]);
  const [myVotes, setMyVotes] = useState<Map<string, number>>(new Map());
  const [showCreate, setShowCreate] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [tag, setTag] = useState('random');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [sortBy, setSortBy] = useState<'new' | 'popular'>('new');
  const [filterTag, setFilterTag] = useState('all');

  useEffect(() => { if (!loading && !user) navigate('/join'); }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;

    Promise.all([
      supabase.from('polls').select('*').order('created_at', { ascending: false }),
      supabase.from('poll_votes').select('*'),
    ]).then(([{ data: pData, error: pErr }, { data: vData, error: vErr }]) => {
      if (pErr) console.error('Poll load error:', pErr);
      if (vErr) console.error('Vote load error:', vErr);
      if (pData) setPolls(pData.map(p => ({ ...p, options: p.options as string[], closed: p.closed ?? false, tag: p.tag ?? 'random' })));
      if (vData) {
        setAllVotes(vData);
        const mine = new Map<string, number>();
        vData.filter(v => v.user_id === user.id).forEach(v => mine.set(v.poll_id, v.option_index));
        setMyVotes(mine);
      }
    });

    const ch = supabase.channel('polls-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'polls' }, (p) => {
        const poll = p.new;
        setPolls(prev => [{ ...poll, options: poll.options as string[], closed: poll.closed ?? false, tag: poll.tag ?? 'random' } as Poll, ...prev]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'polls' }, (p) => {
        setPolls(prev => prev.map(poll => poll.id === p.new.id ? { ...poll, closed: p.new.closed } : poll));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'polls' }, (p) => {
        setPolls(prev => prev.filter(poll => poll.id !== p.old.id));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'poll_votes' }, (p) => {
        setAllVotes(prev => prev.find(v => v.poll_id === p.new.poll_id && v.user_id === p.new.user_id) ? prev : [...prev, p.new as Vote]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const createPoll = async () => {
    const q = question.trim();
    const opts = options.map(o => o.trim()).filter(Boolean);
    if (!q || opts.length < 2 || !user) return;
    setCreating(true); setCreateError('');

    const { error } = await supabase.from('polls').insert({
      question: q, options: opts, created_by: user.id, tag, closed: false
    });

    if (error) {
      setCreateError(`Failed: ${error.message}`);
      setCreating(false);
      return;
    }
    setQuestion(''); setOptions(['', '']); setTag('random');
    setShowCreate(false); setCreating(false);
  };

  const vote = async (poll: Poll, oi: number) => {
    if (!user || myVotes.has(poll.id) || poll.closed) return;
    setMyVotes(prev => new Map(prev).set(poll.id, oi));
    setAllVotes(prev => [...prev, { poll_id: poll.id, option_index: oi, user_id: user.id }]);
    await supabase.from('poll_votes').insert({ poll_id: poll.id, user_id: user.id, option_index: oi });
  };

  const closePoll = async (poll: Poll) => {
    setPolls(prev => prev.map(p => p.id === poll.id ? { ...p, closed: true } : p));
    await supabase.from('polls').update({ closed: true }).eq('id', poll.id);
  };

  const deleteOwnPoll = async (id: string) => {
    setPolls(prev => prev.filter(p => p.id !== id));
    await supabase.from('polls').delete().eq('id', id);
  };

  const getVotesFor = (pollId: string, oi: number) =>
    allVotes.filter(v => v.poll_id === pollId && v.option_index === oi).length;
  const getTotal = (pollId: string) =>
    allVotes.filter(v => v.poll_id === pollId).length;

  const sorted = [...polls]
    .filter(p => filterTag === 'all' || p.tag === filterTag)
    .sort((a, b) => sortBy === 'popular'
      ? getTotal(b.id) - getTotal(a.id)
      : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  const timeAgo = (d: string) => {
    const diff = (Date.now() - new Date(d).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen relative">
      <header className="border-b border-white/5 glass sticky top-0 z-50">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <Link to="/dashboard"><button className="btn-ghost rounded-xl p-2 text-slate-400">← Back</button></Link>
            <div>
              <h1 className="font-semibold text-white">📊 Polls</h1>
              <p className="text-xs text-slate-500">{polls.length} polls · vote anonymously</p>
            </div>
          </div>
          <button onClick={() => { setShowCreate(true); setCreateError(''); }}
            className="btn-primary !w-auto px-4 py-2 rounded-xl text-sm">+ New Poll</button>
        </div>
      </header>

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-6">
        {/* Filter + Sort */}
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div className="flex gap-1.5 overflow-x-auto">
            {TAGS.map(t => (
              <button key={t.key} onClick={() => setFilterTag(t.key)}
                className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap transition-all ${
                  filterTag === t.key ? 'border-blue-500/60 bg-blue-500/10 text-blue-300' : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}>
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 shrink-0">
            {(['new', 'popular'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)}
                className={`text-xs px-3 py-1.5 rounded-full border capitalize transition-all ${
                  sortBy === s ? 'border-blue-500/60 bg-blue-500/10 text-blue-300' : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}>
                {s === 'popular' ? '🔥 Popular' : '✨ New'}
              </button>
            ))}
          </div>
        </div>

        {/* Poll list */}
        <div className="space-y-5">
          <AnimatePresence>
            {sorted.map((poll, i) => {
              const total = getTotal(poll.id);
              const voted = myVotes.has(poll.id);
              const myOptIdx = myVotes.get(poll.id);
              const isOwn = poll.created_by === user?.id;
              const tagInfo = TAGS.find(t => t.key === poll.tag);

              return (
                <motion.div key={poll.id}
                  className={`glass border rounded-2xl p-6 ${poll.closed ? 'border-white/5 opacity-80' : 'border-blue-500/15'}`}
                  initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }} transition={{ delay: i < 5 ? i * 0.06 : 0 }}>
                  <div className="flex justify-between items-start mb-4 gap-3">
                    <div className="flex-1">
                      {tagInfo && tagInfo.key !== 'all' && (
                        <span className="text-xs text-blue-400/70 font-medium block mb-1">{tagInfo.emoji} {tagInfo.label}</span>
                      )}
                      <h3 className="font-semibold text-white leading-snug text-lg">{poll.question}</h3>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {poll.closed && <span className="text-xs bg-slate-700/60 text-slate-400 px-2 py-1 rounded-full">Closed</span>}
                      {isOwn && !poll.closed && (
                        <button onClick={() => closePoll(poll)}
                          className="text-xs text-slate-500 hover:text-orange-400 transition-colors px-2 py-1 rounded-lg hover:bg-orange-500/10">
                          Close
                        </button>
                      )}
                      {isOwn && (
                        <button onClick={() => deleteOwnPoll(poll.id)}
                          className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10">
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {poll.options.map((opt, oi) => {
                      const count = getVotesFor(poll.id, oi);
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      const isMyVote = myOptIdx === oi;
                      const showResults = voted || poll.closed;

                      return (
                        <button key={oi} onClick={() => vote(poll, oi)}
                          disabled={voted || poll.closed}
                          className={`w-full text-left rounded-xl p-3.5 transition-all relative overflow-hidden border group ${
                            showResults
                              ? isMyVote ? 'border-blue-500/50' : 'border-white/5'
                              : 'border-white/10 hover:border-blue-500/40 hover:bg-blue-500/5 cursor-pointer'
                          } ${(!voted && !poll.closed) ? 'active:scale-[0.99]' : ''}`}>
                          {/* Animated progress bar */}
                          {showResults && (
                            <motion.div
                              className={`absolute inset-0 rounded-xl ${isMyVote ? 'bg-blue-500/20' : 'bg-white/4'}`}
                              initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.7, ease: 'easeOut', delay: i * 0.03 }} />
                          )}
                          <div className="relative flex justify-between items-center">
                            <span className={`text-sm font-medium flex items-center gap-2 ${isMyVote ? 'text-blue-200' : 'text-slate-200'}`}>
                              {isMyVote && <span className="text-blue-400">✓</span>}
                              {opt}
                            </span>
                            {showResults && (
                              <span className="text-xs text-slate-400 ml-2 shrink-0">{pct}% · {count}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex justify-between items-center mt-4">
                    <p className="text-xs text-slate-600">{total} vote{total !== 1 ? 's' : ''} · {timeAgo(poll.created_at)}</p>
                    {!voted && !poll.closed && <p className="text-xs text-slate-600">Anonymous vote</p>}
                    {poll.closed && <p className="text-xs text-slate-500">This poll is closed</p>}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {sorted.length === 0 && (
            <div className="text-center py-20">
              <div className="text-4xl mb-3">📊</div>
              <p className="font-medium text-slate-400">No polls yet</p>
              <button onClick={() => setShowCreate(true)} className="btn-primary !w-auto px-5 py-2 rounded-xl text-sm mt-4">Create first poll</button>
            </div>
          )}
        </div>
      </main>

      {/* Create poll modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}>
            <motion.div className="glass border border-white/10 rounded-3xl p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto"
              initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }} transition={{ type: 'spring', stiffness: 280, damping: 28 }}>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-white">Create a Poll</h2>
                <button onClick={() => setShowCreate(false)} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 transition-all text-sm">✕</button>
              </div>

              <div className="space-y-4">
                {/* Question */}
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider mb-2 block">Question</label>
                  <textarea className="input-field resize-none" placeholder="Ask something interesting..."
                    value={question} onChange={e => setQuestion(e.target.value)} maxLength={200} rows={2} />
                </div>

                {/* Tag */}
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider mb-2 block">Category</label>
                  <div className="flex gap-2 flex-wrap">
                    {TAGS.slice(1).map(t => (
                      <button key={t.key} onClick={() => setTag(t.key)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                          tag === t.key ? 'border-blue-500/60 bg-blue-500/15 text-blue-300' : 'border-white/10 text-slate-500 hover:border-white/20'
                        }`}>
                        {t.emoji} {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Options */}
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider mb-2 block">Options (min 2, max 8)</label>
                  <div className="space-y-2">
                    {options.map((opt, i) => (
                      <div key={i} className="flex gap-2">
                        <input className="input-field flex-1 py-2.5" placeholder={`Option ${i + 1}`}
                          value={opt} onChange={e => { const o = [...options]; o[i] = e.target.value; setOptions(o); }}
                          maxLength={120} />
                        {options.length > 2 && (
                          <button onClick={() => setOptions(prev => prev.filter((_, j) => j !== i))}
                            className="text-slate-500 hover:text-red-400 px-3 transition-colors rounded-xl hover:bg-red-500/10">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  {options.length < 8 && (
                    <button onClick={() => setOptions(prev => [...prev, ''])}
                      className="mt-2 text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1">
                      + Add option
                    </button>
                  )}
                </div>

                {createError && (
                  <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-2">
                    ⚠️ {createError}
                  </p>
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button onClick={createPoll}
                  disabled={creating || !question.trim() || options.filter(o => o.trim()).length < 2}
                  className="btn-primary rounded-xl flex-1">
                  {creating ? 'Creating...' : '📊 Create Poll'}
                </button>
                <button onClick={() => setShowCreate(false)}
                  className="btn-ghost rounded-xl px-5 py-2.5 border border-white/10">Cancel</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
