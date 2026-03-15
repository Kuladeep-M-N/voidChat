import { useEffect, useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Trash2, 
  UserX, 
  Eye, 
  ArrowLeft,
  Clock,
  Filter,
  Search,
  MoreVertical,
  Flag
} from 'lucide-react';
import { db } from '../lib/firebase';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  updateDoc, 
  doc, 
  deleteDoc,
  getDoc,
  getDocs,
  where
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

interface Report {
  id: string;
  reporter_id: string;
  target_type: 'shoutout' | 'shoutout_comment' | 'message' | 'confession' | 'confession_comment' | 'chat_room' | 'debate' | 'debate_argument' | 'question' | 'answer' | 'poll' | 'user';
  target_id: string;
  reason: string;
  description: string;
  status: 'pending' | 'reviewed' | 'resolved' | 'ignored';
  created_at: any;
  reporter_name?: string;
  target_preview?: string;
}

export default function AdminModeration() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'reviewed' | 'resolved' | 'ignored'>('pending');
  const [search, setSearch] = useState('');
  const [fetching, setFetching] = useState(true);
  const [nameCache] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!loading && (!user || !profile?.is_admin)) {
      toast.error('Unauthorized access.');
      navigate('/dashboard');
    }
  }, [loading, user, profile, navigate]);

  useEffect(() => {
    if (!user || !profile?.is_admin) return;

    setFetching(true);
    const q = query(collection(db, 'reports'), orderBy('created_at', 'desc'));
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const reportsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Report[];

      const userIds = [...new Set(reportsData.map(r => r.reporter_id))];
      
      for (const userId of userIds) {
        if (!nameCache.has(userId)) {
          const userDoc = await getDoc(doc(db, 'users', userId));
          if (userDoc.exists()) {
            nameCache.set(userId, userDoc.data().anonymous_username);
          } else {
            nameCache.set(userId, 'Anonymous');
          }
        }
      }

      const hydratedReports = await Promise.all(reportsData.map(async (r) => {
        let preview = 'Content unavailable';
        try {
          let col = '';
          switch (r.target_type) {
            case 'shoutout': case 'shoutout_comment': col = 'shoutouts'; break;
            case 'confession': col = 'confessions'; break;
            case 'confession_comment': col = 'confession_comments'; break;
            case 'message': col = 'messages'; break;
            case 'chat_room': col = 'chat_rooms'; break;
            case 'debate': col = 'debates'; break;
            case 'debate_argument': col = 'debate_arguments'; break;
            case 'question': col = 'qna_questions'; break;
            case 'answer': col = 'qna_answers'; break;
            case 'poll': col = 'polls'; break;
          }

          if (col) {
            const docSnap = await getDoc(doc(db, col, r.target_id));
            if (docSnap.exists()) {
              const data = docSnap.data();
              preview = data.message || data.content || data.question || data.title || data.text || 'Document exists but no common content field found';
            }
          }
        } catch (e) {
          console.error('Preview error:', e);
        }

        return {
          ...r,
          reporter_name: nameCache.get(r.reporter_id) || 'Anonymous',
          target_preview: preview
        };
      }));

      setReports(hydratedReports);
      setFetching(false);
    }, (error) => {
      console.error('Fetch reports error:', error);
      toast.error('Failed to fetch reports.');
      setFetching(false);
    });

    return () => unsubscribe();
  }, [user, profile]);

  const updateReportStatus = async (reportId: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'reports', reportId), {
        status: newStatus
      });
      toast.success(`Report marked as ${newStatus}.`);
    } catch (error) {
      console.error('Update report error:', error);
      toast.error('Failed to update report status.');
    }
  };

  const deleteTargetContent = async (report: Report) => {
    if (!window.confirm(`Are you sure you want to delete this ${report.target_type}?`)) return;

    let collectionName = '';
    switch (report.target_type) {
      case 'shoutout': 
      case 'shoutout_comment': collectionName = 'shoutouts'; break;
      case 'confession': collectionName = 'confessions'; break;
      case 'confession_comment': collectionName = 'confession_comments'; break;
      case 'message': collectionName = 'messages'; break;
      case 'chat_room': collectionName = 'chat_rooms'; break;
      case 'debate': collectionName = 'debates'; break;
      case 'debate_argument': collectionName = 'debate_arguments'; break;
      case 'question': collectionName = 'qna_questions'; break;
      case 'answer': collectionName = 'qna_answers'; break;
      case 'poll': collectionName = 'polls'; break;
      case 'user': 
        toast.error('Cannot delete users directly through this panel yet. Use Firebase dashboard.');
        return;
    }

    try {
      await deleteDoc(doc(db, collectionName, report.target_id));
      toast.success('Content deleted successfully.');
      updateReportStatus(report.id, 'resolved');
    } catch (error: any) {
      console.error('Delete content error:', error);
      toast.error(`Failed to delete content: ${error.message}`);
    }
  };

  const filteredReports = reports.filter(r => {
    const matchesFilter = filter === 'all' || r.status === filter;
    const matchesSearch = r.target_id.toLowerCase().includes(search.toLowerCase()) || 
                         r.reason.toLowerCase().includes(search.toLowerCase()) ||
                         r.description?.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  if (loading || fetching) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#06070a] text-white p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Link 
              to="/dashboard"
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white transition"
            >
              <ArrowLeft size={20} />
            </Link>
            <div>
              <div className="flex items-center gap-2 text-amber-500">
                <Shield size={16} />
                <span className="text-[10px] font-black uppercase tracking-[0.2em]">Safety & Moderation</span>
              </div>
              <h1 className="text-3xl font-bold">Admin Dashboard</h1>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex h-12 items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-amber-500/50 transition">
              <Search size={18} className="text-slate-500" />
              <input 
                type="text" 
                placeholder="Search reports..."
                className="bg-transparent outline-none text-sm w-full md:w-64"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 text-sm font-bold hover:bg-white/10 transition"
            >
              REFRESH
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: 'Pending', count: reports.filter(r => r.status === 'pending').length, color: 'text-amber-400', bg: 'bg-amber-400/10' },
            { label: 'Resolved', count: reports.filter(r => r.status === 'resolved').length, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
            { label: 'Reviewed', count: reports.filter(r => r.status === 'reviewed').length, color: 'text-sky-400', bg: 'bg-sky-400/10' },
            { label: 'Total', count: reports.length, color: 'text-slate-400', bg: 'bg-white/5' }
          ].map((stat) => (
            <div key={stat.label} className={`rounded-[1.5rem] border border-white/10 ${stat.bg} p-6`}>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/40">{stat.label}</p>
              <p className={`mt-2 text-3xl font-bold ${stat.color}`}>{stat.count}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-2">
          {['all', 'pending', 'reviewed', 'resolved', 'ignored'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f as any)}
              className={`rounded-full border px-5 py-2 text-xs font-bold uppercase tracking-wider transition ${
                filter === f ? 'border-amber-400/50 bg-amber-400/10 text-amber-400' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Reports Grid */}
        <div className="grid gap-4">
          <AnimatePresence mode="popLayout">
            {filteredReports.map((report) => (
              <motion.div
                key={report.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 p-6 hover:bg-white/[0.07] transition"
              >
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex-1 space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-[0.15em] ${
                        report.target_type === 'shoutout' ? 'bg-pink-500/20 text-pink-400' :
                        report.target_type === 'confession' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-violet-500/20 text-violet-400'
                      }`}>
                        {report.target_type}
                      </span>
                      <span className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-[0.15em] ${
                        report.status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
                        report.status === 'resolved' ? 'bg-emerald-500/20 text-emerald-400' :
                        'bg-white/10 text-white/40'
                      }`}>
                        {report.status}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] font-bold text-white/30">
                        <Clock size={12} />
                        {new Date(report.created_at).toLocaleString()}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xl font-bold flex items-center gap-2">
                        <AlertTriangle size={18} className="text-amber-500" />
                        {report.reason}
                      </h3>
                      {report.target_preview && (
                        <div className="mt-4 rounded-2xl bg-white/5 border border-white/5 p-4 text-sm text-slate-400 font-serif italic">
                          "{report.target_preview}"
                        </div>
                      )}
                      <p className="mt-4 text-sm text-slate-300 leading-relaxed border-l-2 border-amber-500/30 pl-4">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">Reporter's Description:</span>
                        {report.description || <span className="italic text-white/20">No additional details provided.</span>}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] font-medium text-white/40">
                      <div className="flex items-center gap-2">
                        <Flag size={14} />
                        REP-ID: <span className="font-mono">{report.id.slice(0, 8)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Eye size={14} />
                        TARGET: <span className="font-mono">{report.target_id.slice(0, 8)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <UserX size={14} />
                        REPORTER: <span className="font-semibold text-white/60">{report.reporter_name || 'Anonymous'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:flex-col lg:items-end">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => updateReportStatus(report.id, 'reviewed')}
                        className="flex h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-xs font-bold hover:bg-white/20 transition"
                      >
                        <CheckCircle size={14} /> MARK REVIEWED
                      </button>
                      <button 
                        onClick={() => updateReportStatus(report.id, 'ignored')}
                        className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white/40 hover:bg-red-500/20 hover:text-red-400 transition"
                      >
                        <XCircle size={16} />
                      </button>
                    </div>

                    <button 
                      onClick={() => deleteTargetContent(report)}
                      className="flex h-11 items-center gap-2 rounded-xl bg-red-500/20 px-4 text-xs font-bold text-red-400 border border-red-500/20 hover:bg-red-500/30 transition shadow-lg shadow-red-500/10"
                    >
                      <Trash2 size={14} /> DELETE CONTENT & RESOLVE
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {filteredReports.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 rounded-[3rem] border border-dashed border-white/10 bg-white/5">
              <Shield className="h-12 w-12 text-white/10 mb-4" />
              <p className="text-xl font-bold text-white/40 uppercase tracking-widest">No reports found</p>
              <p className="mt-2 text-sm text-white/20">The community is currently behaving well.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
