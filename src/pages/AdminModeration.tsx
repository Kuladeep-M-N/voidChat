import { useEffect, useState } from 'react';
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
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

interface Report {
  id: string;
  reporter_id: string;
  target_type: 'shoutout' | 'message' | 'confession' | 'user';
  target_id: string;
  reason: string;
  description: string;
  status: 'pending' | 'reviewed' | 'resolved' | 'ignored';
  created_at: string;
  reporter?: {
    anonymous_username: string;
  };
}

export default function AdminModeration() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'reviewed' | 'resolved' | 'ignored'>('pending');
  const [search, setSearch] = useState('');
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && (!user || !profile?.is_admin)) {
      toast.error('Unauthorized access.');
      navigate('/dashboard');
    }
  }, [loading, user, profile, navigate]);

  const fetchReports = async () => {
    setFetching(true);
    const { data, error } = await supabase
      .from('reports')
      .select(`
        *,
        reporter:reporter_id (
          anonymous_username
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch reports error:', error);
      toast.error('Failed to fetch reports.');
    } else {
      setReports(data || []);
    }
    setFetching(false);
  };

  useEffect(() => {
    if (user && profile?.is_admin) {
      fetchReports();
    }
  }, [user, profile]);

  const updateReportStatus = async (reportId: string, newStatus: string) => {
    const { error } = await supabase
      .from('reports')
      .update({ status: newStatus })
      .eq('id', reportId);

    if (error) {
      toast.error('Failed to update report status.');
    } else {
      toast.success(`Report marked as ${newStatus}.`);
      setReports(current => current.map(r => r.id === reportId ? { ...r, status: newStatus as any } : r));
    }
  };

  const deleteTargetContent = async (report: Report) => {
    if (!window.confirm(`Are you sure you want to delete this ${report.target_type}?`)) return;

    let tableName = '';
    switch (report.target_type) {
      case 'shoutout': tableName = 'shoutouts'; break;
      case 'confession': tableName = 'confessions'; break;
      case 'message': tableName = 'messages'; break;
      case 'user': 
        toast.error('Cannot delete users directly through this panel yet. Use Supabase dashboard.');
        return;
    }

    const { error } = await supabase
      .from(tableName)
      .delete()
      .eq('id', report.target_id);

    if (error) {
      toast.error(`Failed to delete content: ${error.message}`);
    } else {
      toast.success('Content deleted successfully.');
      updateReportStatus(report.id, 'resolved');
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
              onClick={fetchReports}
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
                      <p className="mt-2 text-sm text-slate-300 leading-relaxed">
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
                        REPORTER: <span className="font-semibold text-white/60">{report.reporter?.anonymous_username || 'Anonymous'}</span>
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
