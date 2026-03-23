import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Crosshair, Users, ChevronDown, CheckCircle2 } from 'lucide-react';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, limit, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, increment, where } from 'firebase/firestore';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'sonner';
import { containsInappropriateContent } from '../../lib/filter';

interface Situation {
  id: string;
  title: string;
  scenario: string;
  question: string;
}

interface Response {
  id: string;
  situationId: string;
  authorName: string;
  authorId: string;
  content: string;
  agrees: number;
  createdAt: any;
}

const FALLBACK_SITUATION: Situation = {
  id: "fallback_1",
  title: "The Betrayal Scenario",
  scenario: "You just discovered that your closest friend of 10 years has been secretly sabatoging your career opportunities to keep you from moving away. They confess while crying.",
  question: "What is your immediate reaction, and do you ever speak to them again?"
};

export default function SituationsTab() {
  const [response, setResponse] = useState('');
  const [hasResponded, setHasResponded] = useState(false);
  const [situation, setSituation] = useState<Situation | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const { user, profile } = useAuth();
  const [agreedIds, setAgreedIds] = useState<Set<string>>(new Set());

  // Listen for the active daily situation
  useEffect(() => {
    const q = query(collection(db, 'whisper_situations'), orderBy('createdAt', 'desc'), limit(1));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setSituation({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Situation);
      } else {
        setSituation(FALLBACK_SITUATION);
      }
    });
    return () => unsubscribe();
  }, []);

  // Listen for responses to the current situation
  useEffect(() => {
    if (!situation?.id) return;
    
    // Check if I have responded this session
    const localResponded = localStorage.getItem(`voidchat_situation_${situation.id}`);
    if (localResponded === 'true') {
      setHasResponded(true);
    }

    const q = query(
      collection(db, 'whisper_situation_responses'), 
      where('situationId', '==', situation.id),
      orderBy('agrees', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Response[];
      setResponses(data);

      if (user) {
        const myResp = data.find(r => r.authorId === user.uid);
        if (myResp) {
           setHasResponded(true);
           localStorage.setItem(`voidchat_situation_${situation.id}`, 'true');
        }
      }
    });
    return () => unsubscribe();
  }, [situation?.id, user]);

  const handleSubmit = async () => {
    if (!response.trim() || !user || !situation) return;
    
    if (containsInappropriateContent(response).matches) {
       toast.error("Keep it clean in the void.");
       return;
    }

    try {
      await addDoc(collection(db, 'whisper_situation_responses'), {
        situationId: situation.id,
        authorName: profile?.anonymous_username || 'Anonymous',
        authorId: user.uid,
        content: response.trim(),
        agrees: 0,
        createdAt: serverTimestamp()
      });
      setHasResponded(true);
      localStorage.setItem(`voidchat_situation_${situation.id}`, 'true');
      toast.success('Response locked in.');
    } catch(err) {
      toast.error('Failed to submit response.');
      console.error(err);
    }
  };

  const handleAgree = async (respId: string) => {
     if (!user || agreedIds.has(respId)) return;
     try {
       setAgreedIds(prev => new Set(prev).add(respId));
       await updateDoc(doc(db, 'whisper_situation_responses', respId), {
         agrees: increment(1)
       });
     } catch(err) {
       console.error(err);
     }
  };

  if (!situation) return null;

  return (
    <div className="p-6 md:p-8 flex flex-col h-full bg-[#070d1f]">
      <div className="flex items-center gap-3 mb-8">
         <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
          <Crosshair className="text-emerald-400" size={20} />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white font-['Manrope']">Situation Mode</h2>
          <p className="text-sm text-emerald-400/80">You are placed in the scenario. What do you do?</p>
        </div>
      </div>

      {/* Main Situation Card */}
      <div className="relative rounded-3xl p-[1px] bg-gradient-to-br from-emerald-500 to-teal-800 mb-10 shadow-[0_0_40px_rgba(16,185,129,0.15)]">
        <div className="bg-[#0a1128] rounded-[23px] p-8 h-full relative overflow-hidden flex flex-col">
          <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-emerald-500/10 to-transparent pointer-events-none" />
          
          <div className="flex items-center gap-2 text-emerald-400 mb-4 uppercase tracking-[0.2em] text-xs font-black">
            <ShieldAlert size={16} /> DAILY SCENARIO
          </div>
          
          <h3 className="text-3xl font-bold text-white mb-4 font-['Manrope']">{situation.title}</h3>
          
          <p className="text-slate-300 text-lg leading-relaxed mb-6 font-medium">
             "{situation.scenario}"
          </p>

          <div className="bg-emerald-950/40 border border-emerald-500/20 rounded-xl p-5 mb-8">
             <p className="text-emerald-300 font-bold text-lg text-center font-['Manrope']">{situation.question}</p>
          </div>

          {!hasResponded ? (
             <div className="mt-auto flex flex-col gap-3">
               <textarea
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  placeholder="Drop your move..."
                  className="w-full bg-[#070d1f] border border-white/10 rounded-xl p-4 text-white resize-none h-24 focus:border-emerald-500/50 outline-none transition-colors"
               />
               <button 
                  onClick={handleSubmit}
                  disabled={!response.trim()}
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-4 rounded-xl transition-colors shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] disabled:bg-slate-800 disabled:text-slate-500"
               >
                 LOCK IN MY RESPONSE
               </button>
             </div>
          ) : (
            <div className="mt-auto flex flex-col items-center justify-center p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-center">
               <CheckCircle2 size={32} className="mb-2 text-emerald-400" />
               <p className="font-bold text-lg">Response Locked.</p>
               <p className="text-sm opacity-80 mt-1">Comparing with the void below...</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h4 className="text-lg font-bold text-white flex items-center gap-2">
          <Users size={18} className="text-white/40" />
          How Others Navigated This
        </h4>
        <button className="flex items-center gap-1 text-sm text-slate-400 transition-colors bg-white/5 px-3 py-1.5 rounded-lg border border-white/5 cursor-default">
          Top Voted <ChevronDown size={14} />
        </button>
      </div>

      <div className="space-y-4">
        {responses.length === 0 && (
           <div className="text-center py-10 text-slate-500 font-bold">No responses yet. Be the first to maneuver.</div>
        )}
        {responses.map((resp, i) => (
          <motion.div
            key={resp.id}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.05 }}
            className={`p-6 rounded-2xl bg-white/5 border border-white/5 flex gap-4 ${hasResponded ? 'opacity-100' : 'opacity-40 blur-[4px] pointer-events-none select-none relative overflow-hidden'}`}
          >
            {!hasResponded && (
               <div className="absolute inset-0 flex items-center justify-center z-10 w-full bg-black/20">
                 <span className="bg-[#070d1f] text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-full font-bold text-sm shadow-xl">
                    Respond to Reveal
                 </span>
               </div>
            )}
            <div className="flex flex-col items-center gap-2 min-w-[60px]">
               <button 
                  onClick={() => handleAgree(resp.id)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${agreedIds.has(resp.id) ? 'bg-emerald-500/30 text-emerald-300 border-emerald-500/50' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20'}`}
               >
                  <ArrowUpIcon />
               </button>
               <span className="font-bold text-slate-300 text-sm">{resp.agrees || 0}</span>
            </div>
            <div>
              <div className="text-sm font-bold text-slate-400 mb-2">@{resp.authorName}</div>
              <p className="text-slate-200 leading-relaxed max-w-2xl whitespace-pre-wrap">{resp.content}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function ArrowUpIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 7-7 7 7"/>
      <path d="M12 19V5"/>
    </svg>
  );
}
