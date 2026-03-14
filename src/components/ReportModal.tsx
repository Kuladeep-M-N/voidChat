import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, Shield, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: 'shoutout' | 'message' | 'confession' | 'user';
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
    const { error } = await supabase.from('reports').insert({
      reporter_id: user.id,
      target_type: targetType,
      target_id: targetId,
      reason,
      description
    });

    if (error) {
      console.error('Report error:', error);
      toast.error('Failed to send report. Please try again.');
    } else {
      setSubmitted(true);
      setTimeout(() => {
        onClose();
        setSubmitted(false);
        setReason('');
        setDescription('');
      }, 2000);
    }
    setSubmitting(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed left-1/2 top-1/2 z-[101] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-white/10 bg-[#0d0e12] p-8 shadow-2xl"
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
                <div className="flex items-center justify-between mb-8">
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

                  <div className="flex gap-4 pt-4">
                    <button
                      onClick={onClose}
                      className="flex-1 rounded-xl border border-white/10 px-6 py-4 text-sm font-bold text-white/60 transition hover:bg-white/5 hover:text-white"
                    >
                      CANCEL
                    </button>
                    <button
                      disabled={!reason || submitting}
                      onClick={handleSubmit}
                      className="flex-1 rounded-xl bg-amber-500 px-6 py-4 text-sm font-black uppercase tracking-widest text-[#06070a] transition hover:bg-amber-400 disabled:opacity-30 disabled:hover:bg-amber-500 flex items-center justify-center gap-2 shadow-[0_10px_30px_rgba(245,158,11,0.2)]"
                    >
                      {submitting ? 'SENDING...' : (
                        <>
                          <Shield className="h-4 w-4" />
                          SUBMIT REPORT
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
