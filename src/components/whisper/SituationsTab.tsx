import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Crosshair, Users, CheckCircle2, Zap } from 'lucide-react';
import { db } from '../../lib/firebase';
import {
  collection, query, orderBy, limit, onSnapshot, addDoc,
  updateDoc, doc, serverTimestamp, increment, where
} from 'firebase/firestore';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'sonner';
import { containsInappropriateContent } from '../../lib/filter';

interface Situation {
  id: string;
  title: string;
  scenario: string;
  question: string;
  choices?: { label: string; icon?: string }[];
}

interface Response {
  id: string;
  situationId: string;
  authorName: string;
  authorId: string;
  content: string;
  agrees: number;
  choiceIndex?: number;
  createdAt: any;
}

const FALLBACK_SITUATION: Situation = {
  id: 'fallback_1',
  title: 'The Betrayal Scenario',
  scenario:
    'You just discovered that your closest friend of 10 years has been secretly sabotaging your career opportunities to keep you from moving away. They confess while crying.',
  question: 'What is your immediate reaction, and do you ever speak to them again?',
  choices: [
    { label: 'Walk away immediately — trust is gone', icon: '🚶' },
    { label: 'Hear them out but end the friendship', icon: '👂' },
    { label: 'Forgive — people are complex', icon: '🤝' },
  ],
};

function timeAgo(date: any) {
  if (!date) return '';
  const d = date?.toDate ? date.toDate() : new Date(date);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (isNaN(diff) || diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function SituationsTab() {
  const [response, setResponse] = useState('');
  const [hasResponded, setHasResponded] = useState(false);
  const [situation, setSituation] = useState<Situation | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [agreedIds, setAgreedIds] = useState<Set<string>>(new Set());
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const { user, profile } = useAuth();

  useEffect(() => {
    const q = query(collection(db, 'whisper_situations'), orderBy('createdAt', 'desc'), limit(1));
    const unsub = onSnapshot(q, snap => {
      if (!snap.empty) {
        const data = snap.docs[0].data();
        setSituation({ id: snap.docs[0].id, ...data } as Situation);
      } else {
        setSituation(FALLBACK_SITUATION);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!situation?.id) return;
    const stored = localStorage.getItem(`voidchat_situation_${situation.id}`);
    if (stored === 'true') setHasResponded(true);

    const q = query(
      collection(db, 'whisper_situation_responses'),
      where('situationId', '==', situation.id),
      orderBy('agrees', 'desc')
    );
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Response[];
      setResponses(data);
      if (user && data.find(r => r.authorId === user.uid)) {
        setHasResponded(true);
        localStorage.setItem(`voidchat_situation_${situation.id}`, 'true');
      }
    });
    return () => unsub();
  }, [situation?.id, user]);

  const handleSubmit = async () => {
    if (!response.trim() || !user || !situation) return;
    if (containsInappropriateContent(response).matches) { toast.error('Keep it clean.'); return; }
    try {
      await addDoc(collection(db, 'whisper_situation_responses'), {
        situationId: situation.id,
        authorName: profile?.anonymous_username || 'Anonymous',
        authorId: user.uid,
        content: response.trim(),
        choiceIndex: selectedChoice,
        agrees: 0,
        createdAt: serverTimestamp(),
      });
      setHasResponded(true);
      localStorage.setItem(`voidchat_situation_${situation.id}`, 'true');
      toast.success('Response locked in.');
    } catch (err) { toast.error('Failed to submit.'); }
  };

  const handleAgree = async (respId: string) => {
    if (!user || agreedIds.has(respId)) return;
    setAgreedIds(prev => new Set(prev).add(respId));
    await updateDoc(doc(db, 'whisper_situation_responses', respId), { agrees: increment(1) });
  };

  if (!situation) return null;

  const choiceCounts = situation.choices?.map((_, idx) =>
    responses.filter(r => r.choiceIndex === idx).length
  ) ?? [];
  const totalChoiceVotes = choiceCounts.reduce((a, b) => a + b, 0);
  const getChoicePct = (idx: number) =>
    totalChoiceVotes === 0 ? 0 : Math.round((choiceCounts[idx] / totalChoiceVotes) * 100);

  return (
    <div className="pb-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
          <Crosshair className="text-emerald-400" size={20} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Situation Mode</h2>
          <p className="text-xs text-emerald-400/70" style={{ fontFamily: "'Manrope', sans-serif" }}>You are placed in the scenario. What do you do?</p>
        </div>
      </div>

      {/* Situation Card */}
      <div className="relative rounded-2xl overflow-hidden mb-8">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-500/5" />
        <div className="absolute inset-[1px] rounded-2xl" style={{ border: '1px solid rgba(16,185,129,0.25)' }} />
        <div className="relative p-6 sm:p-8">
          {/* Scenario label */}
          <div className="flex items-center gap-2 text-emerald-400 mb-4 uppercase tracking-[0.2em] text-xs font-black">
            <ShieldAlert size={15} />
            Daily Scenario
          </div>

          <h3
            className="text-2xl sm:text-3xl font-black text-white mb-4 leading-tight"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {situation.title}
          </h3>

          <p
            className="text-slate-300 text-base leading-relaxed mb-6"
            style={{ fontFamily: "'Manrope', sans-serif" }}
          >
            "{situation.scenario}"
          </p>

          <div className="rounded-xl p-4 mb-6 border border-emerald-500/20" style={{ background: 'rgba(16,185,129,0.08)' }}>
            <p className="text-emerald-300 font-bold text-base text-center" style={{ fontFamily: "'Manrope', sans-serif" }}>
              {situation.question}
            </p>
          </div>

          {/* Branch Choices */}
          {situation.choices && situation.choices.length > 0 && (
            <div className="space-y-2 mb-5">
              {situation.choices.map((choice, idx) => {
                const pct = getChoicePct(idx);
                const isSelected = selectedChoice === idx;

                return !hasResponded ? (
                  <button
                    key={idx}
                    onClick={() => setSelectedChoice(idx)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                      isSelected
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                        : 'bg-white/3 border-white/8 text-slate-300 hover:bg-white/6 hover:border-white/12'
                    }`}
                  >
                    <span className="text-lg">{choice.icon || '🔘'}</span>
                    <span className="text-sm font-medium flex-1">{choice.label}</span>
                    {isSelected && <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />}
                  </button>
                ) : (
                  <div key={idx} className="flex flex-col gap-1.5 p-3 rounded-xl border border-white/6">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{choice.icon || '🔘'}</span>
                      <span className="text-sm text-slate-300 flex-1">{choice.label}</span>
                      <span className="text-xs font-bold text-emerald-400">{pct}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-white/8 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: 'linear-gradient(90deg, #059669, #10b981)' }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut', delay: idx * 0.1 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Text response */}
          {!hasResponded ? (
            <div className="space-y-3">
              <textarea
                value={response}
                onChange={e => setResponse(e.target.value)}
                placeholder="Drop your move... (optional detailed response)"
                className="w-full bg-black/30 border border-white/8 rounded-xl p-4 text-white resize-none h-24 outline-none focus:border-emerald-500/40 transition-colors placeholder-slate-600"
                style={{ fontFamily: "'Manrope', sans-serif" }}
              />
              {(response.trim() || selectedChoice !== null) && (
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={handleSubmit}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-black text-slate-950 transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #059669, #10b981)',
                    boxShadow: '0 0 20px rgba(16,185,129,0.4)',
                    fontFamily: "'Space Grotesk', sans-serif",
                  }}
                >
                  <Zap size={18} />
                  LOCK IN MY RESPONSE
                </motion.button>
              )}
            </div>
          ) : (
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center justify-center py-5 rounded-xl border border-emerald-500/20 bg-emerald-500/8"
            >
              <CheckCircle2 size={28} className="text-emerald-400 mb-2" />
              <p className="font-bold text-emerald-300" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Response Locked
              </p>
              <p className="text-xs text-slate-600 mt-1">Comparing with the void below...</p>
            </motion.div>
          )}
        </div>
      </div>

      {/* Other Responses */}
      <div className="flex items-center justify-between mb-5">
        <h4 className="text-sm font-bold text-white flex items-center gap-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          <Users size={16} className="text-slate-400" />
          How Others Navigated This
          <span className="text-slate-600 font-medium">({responses.length})</span>
        </h4>
      </div>

      <div className="space-y-3">
        {responses.length === 0 && (
          <div className="text-center py-10 text-slate-600 font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            No responses yet. Be the first to maneuver.
          </div>
        )}
        {responses.map((resp, i) => (
          <motion.div
            key={resp.id}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.04 }}
            className={`whisper-card p-5 flex gap-4 relative ${
              !hasResponded ? 'opacity-30 blur-[3px] pointer-events-none select-none' : ''
            }`}
          >
            {!hasResponded && (
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl z-10">
                <span
                  className="px-4 py-2 rounded-full text-emerald-400 border border-emerald-500/30 text-sm font-bold"
                  style={{ background: 'rgba(9,9,20,0.9)', backdropFilter: 'blur(8px)' }}
                >
                  Respond to Reveal
                </span>
              </div>
            )}

            {/* Vote column */}
            <div className="flex flex-col items-center gap-1 min-w-[40px]">
              <button
                onClick={() => handleAgree(resp.id)}
                className={`w-9 h-9 rounded-full border flex items-center justify-center transition-all ${
                  agreedIds.has(resp.id)
                    ? 'bg-emerald-500/25 border-emerald-500/50 text-emerald-300'
                    : 'bg-emerald-500/8 border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/18'
                }`}
              >
                ▲
              </button>
              <span className="text-xs font-bold text-slate-400">{resp.agrees}</span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-slate-400">@{resp.authorName}</span>
                <span className="text-[10px] text-slate-700">{timeAgo(resp.createdAt)}</span>
                {resp.choiceIndex !== undefined && resp.choiceIndex !== null && situation.choices && (
                  <span className="neon-tag neon-tag-purple text-[10px]">
                    {situation.choices[resp.choiceIndex]?.icon} {String.fromCharCode(65 + resp.choiceIndex)}
                  </span>
                )}
              </div>
              <p
                className="text-slate-200 text-sm leading-relaxed break-words"
                style={{ fontFamily: "'Manrope', sans-serif" }}
              >
                {resp.content}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
