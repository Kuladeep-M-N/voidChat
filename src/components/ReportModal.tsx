import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, Shield, CheckCircle } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: 'shoutout' | 'message' | 'confession' | 'user' | 'confession_comment' | 'shoutout_comment' | 'chat_room' | 'debate' | 'debate_argument' | 'question' | 'answer' | 'poll';
  targetId: string;
}

const REPORT_REASONS = [
  'Harassment or Hate Speech',
  'Explicit or Sensitive Content',
  'Spam or Scams',
  'Bullying or Doxing',
  'Inappropriate language',
  'Other'
];

export default function ReportModal({ isOpen, onClose, targetType, targetId }: ReportModalProps) {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!user || !reason) return;

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'reports'), {
        reporter_id: user.uid,
        target_type: targetType,
        target_id: targetId,
        reason,
        description,
        created_at: serverTimestamp()
      });
      setSubmitted(true);
      setTimeout(() => {
        onClose();
        setSubmitted(false);
        setReason('');
        setDescription('');
      }, 2000);
    } catch (error) {
      console.error('Report error:', error);
      toast.error('Failed to send report. Please try again.');
    }
    setSubmitting(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative z-[101] w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[2rem] border border-white/10 bg-[#0d0e12] p-6 md:p-8 shadow-2xl custom-scrollbar"
            >
              {submitted ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                    <CheckCircle className="h-10 w-10" />
                  </div>
                  <h3 className="text-2xl font-bold text-white">Report Received</h3>
                  <p className="mt-2 text-white/50">Our moderation team will review this content shortly. Thank you for keeping this space safe.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-8 sticky top-0 bg-[#0d0e12] z-10 pb-2">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-amber-500/20 p-2.5 text-amber-400">
                        <AlertTriangle className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white">Report Content</h3>
                        <p className="text-xs text-white/40 font-mono">Flagging for review</p>
                      </div>
                    </div>
                    <button onClick={onClose} className="rounded-full bg-white/5 p-2 text-white/40 hover:bg-white/10 hover:text-white transition">
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="space-y-6">
                    <div className="space-y-3">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 ml-1">Reason for Report</label>
                      <div className="grid gap-2">
                        {REPORT_REASONS.map((r) => (
                          <button
                            key={r}
                            onClick={() => setReason(r)}
                            className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${reason === r ? 'border-amber-400/50 bg-amber-400/10 text-amber-300' : 'border-white/5 bg-white/[0.03] text-white/60 hover:border-white/10 hover:bg-white/[0.05]'}`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 ml-1">Additional Details (Optional)</label>
                      <textarea
                        className="min-h-[100px] w-full resize-none rounded-xl border border-white/5 bg-white/[0.03] p-4 text-sm text-white outline-none focus:border-amber-400/30 focus:bg-amber-400/5"
                        placeholder="Help us understand the context..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>

                    <div className="flex flex-col md:flex-row gap-3 pt-4 sticky bottom-0 bg-[#0d0e12] pb-2">
                      <button
                        onClick={onClose}
                        className="flex-1 rounded-xl border border-white/10 px-6 py-4 text-sm font-bold text-white/60 transition hover:bg-white/5 hover:text-white order-2 md:order-1"
                      >
                        CANCEL
                      </button>
                      <button
                        disabled={!reason || submitting}
                        onClick={handleSubmit}
                        className="flex-1 rounded-xl bg-amber-500 px-6 py-4 text-sm font-black uppercase tracking-widest text-[#06070a] transition hover:bg-amber-400 disabled:opacity-30 disabled:hover:bg-amber-500 flex items-center justify-center gap-2 shadow-[0_10px_30px_rgba(245,158,11,0.2)] order-1 md:order-2"
                      >
                        {submitting ? 'SENDING...' : (
                          <>
                            <Shield className="h-4 w-4" />
                            SUBMIT
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
