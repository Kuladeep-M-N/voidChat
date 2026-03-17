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
  User as UserIcon,
  Eye, 
  ArrowLeft,
  Clock,
  Filter,
  Search,
  MoreVertical,
  Ghost,
  MicOff,
  ChevronLeft,
  Layers,
  AlertOctagon,
  Loader2,
  Activity,
  TrendingUp,
  Users,
  Mic,
  Archive,
  Smile,
  ShieldAlert,
  Settings,
  RefreshCw,
  Lock,
  MessageSquare,
  VolumeX,
  UserCheck,
  Zap,
  ChevronRight,
  Flag,
  Bomb,
  Table,
  UserPlus,
  UserMinus,
  MessageCircle,
  BarChart3,
  Megaphone,
  Radio,
  EyeOff,
  Star,
  Pin,
  ShieldCheck,
  Ban,
  Sword,
  Globe,
  ArrowUpRight,
  Pause,
  Play
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
  where,
  writeBatch,
  limit
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { useSystemConfig } from '../hooks/useSystemConfig';
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
  
  // Nuclear Option State
  const [showNuclearModal, setShowNuclearModal] = useState(false);
  const [nuclearConfirmText, setNuclearConfirmText] = useState('');
  const [isErasing, setIsErasing] = useState(false);
  const [erasureProgress, setErasureProgress] = useState(0);
  const [erasureTotal, setErasureTotal] = useState(0);
  
  // Admin Tools View State
  const [activeTab, setActiveTab] = useState<'moderation' | 'tools'>('moderation');
  const { config, loading: configLoading, updateConfig } = useSystemConfig();
  const safeMode = config.safeMode;
  
  // Stats State
  const [stats, setStats] = useState({
    confessionsToday: 0,
    activeVoiceRooms: 0,
    debatesToday: 0,
    pollVotesToday: 0,
    onlineUsers: 0
  });

  // Trending Content State
  const [trending, setTrending] = useState({
    confession: null as any,
    debate: null as any,
    poll: null as any,
    voiceRoom: null as any
  });

  // User Moderation State
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<any[]>([]);
  const [userListPage, setUserListPage] = useState(1);
  const usersPerPage = 10;

  // Content Moderation State
  const [recentContent, setRecentContent] = useState({
    confessions: [] as any[],
    debates: [] as any[],
    polls: [] as any[],
    voiceRooms: [] as any[]
  });

  // System Config & Controls
  const systemConfig = config;

  // Spam Watch State
  const [flaggedUsers, setFlaggedUsers] = useState<any[]>([]);

  // Announcement State
  const [announcementText, setAnnouncementText] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  // Sub-tabs for Admin Tools
  const [adminToolsTab, setAdminToolsTab] = useState<'overview' | 'users' | 'content' | 'analytics' | 'system'>('overview');
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});

  const CONFIRMATION_PHRASE = "ERASE ALL PLATFORM DATA";

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
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reportsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Report[];
      
      setReports(reportsData);
      setFetching(false);
    }, (error) => {
      console.error('Fetch reports error:', error);
      toast.error('Failed to fetch reports.');
      setFetching(false);
    });

    return () => unsubscribe();
  }, [user, profile]);

  // Admin Tools Stats Effect
  useEffect(() => {
    if (activeTab !== 'tools') return;

    // Confessions Today
    const confQ = query(collection(db, 'confessions'));
    const unSubConf = onSnapshot(confQ, (snap) => {
      setStats(prev => ({ ...prev, confessionsToday: snap.size }));
    });

    // Active Voice Rooms
    const vrQ = query(collection(db, 'voice_rooms'));
    const unSubVR = onSnapshot(vrQ, (snap) => {
      const active = snap.docs.filter(d => d.data().status === 'active').length;
      setStats(prev => ({ ...prev, activeVoiceRooms: active }));
    });

    // Debates Today
    const debQ = query(collection(db, 'debates'));
    const unSubDeb = onSnapshot(debQ, (snap) => {
      setStats(prev => ({ ...prev, debatesToday: snap.size }));
    });

    // Online Users (Mocking as presence isn't fully implemented in RTDB/Firestore yet)
    // In a full implementation, we'd query query(collection(db, 'profiles'), where('is_online', '==', true))
    setStats(prev => ({ ...prev, onlineUsers: 12 }));

    return () => {
      unSubConf();
      unSubVR();
      unSubDeb();
    };
  }, [activeTab]);

  // User Moderation Search
  useEffect(() => {
    if (!userSearchQuery || userSearchQuery.length < 3) {
      setSelectedUser(null);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      try {
        const q = query(
          collection(db, 'profiles'),
          where('username', '>=', userSearchQuery),
          where('username', '<=', userSearchQuery + '\uf8ff'),
          limit(5)
        );
        
        const snapshot = await getDocs(q);
        const found = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (found.length > 0) {
          setSelectedUser(found[0]); // Select first match for the panel
        }
      } catch (err) {
        console.error('User search error:', err);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [userSearchQuery]);

  // Admin Tools: Sub-tab Data Fetching
  useEffect(() => {
    if (activeTab !== 'tools') return;

    let unsubUsers: any;
    let unsubConfessions: any;
    let unsubDebates: any;
    let unsubPolls: any;
    let unsubConfig: any;

    if (adminToolsTab === 'users') {
      const usersQ = query(collection(db, 'users'), orderBy('joined_at', 'desc'), limit(50));
      unsubUsers = onSnapshot(usersQ, (snap) => {
        const usersData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
        setAllUsers(usersData);
        setBlockedUsers(usersData.filter((u: any) => u.status === 'blocked'));
      });
    }

    if (adminToolsTab === 'content') {
      const confQ = query(collection(db, 'confessions'), orderBy('created_at', 'desc'), limit(10));
      unsubConfessions = onSnapshot(confQ, (snap) => {
        setRecentContent(prev => ({ ...prev, confessions: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
      });

      const debQ = query(collection(db, 'debates'), orderBy('created_at', 'desc'), limit(10));
      unsubDebates = onSnapshot(debQ, (snap) => {
        setRecentContent(prev => ({ ...prev, debates: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
      });

      const pollQ = query(collection(db, 'polls'), orderBy('created_at', 'desc'), limit(10));
      unsubPolls = onSnapshot(pollQ, (snap) => {
        setRecentContent(prev => ({ ...prev, polls: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
      });
    }

    if (adminToolsTab === 'system') {
    // unsubConfig = onSnapshot(doc(db, 'system_config', 'global'), (snap) => {
    //   if (snap.exists()) {
    //     setSystemConfig(snap.data() as any);
    //   }
    // });
    }

    return () => {
      unsubUsers?.();
      unsubConfessions?.();
      unsubDebates?.();
      unsubPolls?.();
      unsubConfig?.();
    };
  }, [activeTab, adminToolsTab]);

  const toggleSystemFeature = async (feature: keyof typeof systemConfig) => {
    try {
      await updateConfig({
        [feature]: !systemConfig[feature]
      });
      toast.success('System configuration updated.');
    } catch (err) {
      console.error('Update config error:', err);
      toast.error('Failed to update configuration.');
    }
  };

  const broadcastAnnouncement = async () => {
    if (!announcementText.trim()) return;
    setIsBroadcasting(true);
    try {
      await writeBatch(db).set(doc(collection(db, 'global_announcements')), {
        message: announcementText,
        created_at: new Date(),
        author_id: user?.uid
      }).commit();
      setAnnouncementText('');
      toast.success('Announcement broadcasted successfully!');
    } catch (err) {
      console.error('Broadcast error:', err);
      toast.error('Failed to broadcast announcement.');
    } finally {
      setIsBroadcasting(false);
    }
  };

  const updateUserStatus = async (userId: string, newStatus: string) => {
    const targetUser = allUsers.find(u => u.id === userId) || flaggedUsers.find(u => u.id === userId);
    if (targetUser?.is_admin) {
      toast.error('Security Protocol: Cannot restrict administrative accounts.');
      return;
    }

    try {
      await updateDoc(doc(db, 'users', userId), { status: newStatus });
      toast.success(`User status updated to ${newStatus}`);
    } catch (err) {
      console.error('Update user status error:', err);
      toast.error('Failed to update user status.');
    }
  };

  const deleteUser = async (userId: string) => {
    const targetUser = allUsers.find(u => u.id === userId) || flaggedUsers.find(u => u.id === userId);
    if (targetUser?.is_admin) {
      toast.error('Security Protocol: Administrative accounts cannot be deleted.');
      return;
    }

    if (!window.confirm("Are you sure you want to permanently delete this user? This action cannot be undone.")) return;
    try {
      await deleteDoc(doc(db, 'users', userId));
      toast.success("User permanently deleted from database.");
      // If the deleted user was in the flagged list, remove them
      setFlaggedUsers(prev => prev.filter(u => u.id !== userId));
    } catch (err) {
      console.error('Delete user error:', err);
      toast.error('Failed to delete user.');
    }
  };

  const runSpamDetection = () => {
    // Basic spam pattern detection
    const flagged: any[] = [];
    allUsers.forEach((u: any) => {
      if (u.activity_count > 50) { // Example threshold
        flagged.push({
          ...u,
          spam_reason: 'High activity frequency',
          risk_score: 85
        });
      }
    });
    setFlaggedUsers(flagged);
  };

  useEffect(() => {
    if (activeTab === 'tools' && adminToolsTab === 'users' && allUsers.length > 0) {
      runSpamDetection();
    }
  }, [allUsers, adminToolsTab]);

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

  const executeNuclearOption = async () => {
    if (nuclearConfirmText !== CONFIRMATION_PHRASE) return;
    
    setIsErasing(true);
    setErasureProgress(0);
    
    const collectionsToErase = [
      'reports',
      'shoutouts',
      'confessions',
      'confession_comments',
      'messages',
      'chat_rooms',
      'debates',
      'debate_arguments',
      'qna_questions',
      'qna_answers',
      'polls',
      'poll_votes',
      'voice_rooms',
      'notifications',
      'online_users'
    ];

    setErasureTotal(collectionsToErase.length);
    let successCount = 0;

    try {
      for (const colName of collectionsToErase) {
        setErasureProgress(prev => prev + 1);
        const colRef = collection(db, colName);
        const snapshot = await getDocs(colRef);
        
        if (snapshot.empty) {
          successCount++;
          continue;
        }

        // Firestore batch limit is 500. For nuclear option, we'll process in chunks if needed.
        const docs = snapshot.docs;
        for (let i = 0; i < docs.length; i += 500) {
          const batch = writeBatch(db);
          const chunk = docs.slice(i, i + 500);
          chunk.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
        successCount++;
      }

      toast.success(`Platform wiped clean. ${successCount} collections erased.`);
      setShowNuclearModal(false);
      setNuclearConfirmText('');
      window.location.reload();
    } catch (error: any) {
      console.error('Erasure error:', error);
      toast.error(`Erasure failed: ${error.message}`);
    } finally {
      setIsErasing(false);
    }
  };

  const filteredReports = reports.filter(r => {
    const matchesFilter = filter === 'all' || r.status === filter || (filter === 'pending' && !r.status);
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
            <div className="flex bg-white/5 rounded-2xl p-1 border border-white/5">
              <button 
                onClick={() => setActiveTab('moderation')}
                className={`px-6 h-10 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'moderation' 
                    ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                MODERATION
              </button>
              <button 
                onClick={() => setActiveTab('tools')}
                className={`px-6 h-10 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'tools' 
                    ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                ADMIN TOOLS
              </button>
            </div>
            {activeTab === 'moderation' && (
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
            )}
            <button 
              onClick={() => window.location.reload()}
              className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 text-sm font-bold hover:bg-white/10 transition"
            >
              <RefreshCw size={16} />
              REFRESH
            </button>
          </div>
        </div>
        
        {activeTab === 'moderation' ? (
          <>
            {/* Stats Row */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: 'Pending', count: reports.filter(r => r.status === 'pending' || !r.status).length, color: 'text-amber-400', bg: 'bg-amber-400/10' },
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
                        (report.status === 'pending' || !report.status) ? 'bg-amber-500/20 text-amber-400' :
                        report.status === 'resolved' ? 'bg-emerald-500/20 text-emerald-400' :
                        'bg-white/10 text-white/40'
                      }`}>
                        {report.status || 'pending'}
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

        {/* Danger Zone */}
        <div className="mt-20 rounded-[2.5rem] border border-red-500/20 bg-red-500/5 p-8 md:p-12 overflow-hidden relative">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <Bomb size={120} className="text-red-500" />
          </div>
          <div className="relative z-10 max-w-2xl">
            <div className="flex items-center gap-3 text-red-500 mb-4">
              <AlertOctagon size={24} />
              <h2 className="text-2xl font-black uppercase tracking-tight">Danger Zone</h2>
            </div>
            <p className="text-slate-300 mb-8 leading-relaxed">
              The <span className="text-red-400 font-bold">Nuclear Option</span> will permanently erase every single piece of content on this platform—including messages, polls, shouts, and reports. User profiles will be preserved, but all their history will vanish forever.
            </p>
            <button 
              onClick={() => setShowNuclearModal(true)}
              className="group relative flex h-14 items-center gap-4 rounded-2xl bg-red-500 px-8 text-sm font-black uppercase tracking-widest text-white transition hover:bg-red-600 shadow-xl shadow-red-500/20 active:scale-[0.98]"
            >
              <Bomb size={18} className="animate-pulse" />
              INITIATE GLOBAL ERASURE
            </button>
          </div>
        </div>
      </>        ) : (
          <div className="space-y-8 pb-20">
            {/* Admin Tools Sub-Navigation */}
            <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-white/5 border border-white/5 w-fit">
              {[
                { id: 'overview', label: 'Overview', icon: Activity },
                { id: 'users', label: 'Users', icon: Users },
                { id: 'content', label: 'Content', icon: Table },
                { id: 'analytics', label: 'Analytics', icon: BarChart3 },
                { id: 'system', label: 'System', icon: Settings },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setAdminToolsTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    adminToolsTab === tab.id 
                    ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20' 
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <tab.icon size={14} />
                  {tab.label}
                </button>
              ))}
            </div>

            {adminToolsTab === 'overview' && (
              <div className="space-y-8">
                {/* Safe Mode Toggle Banner */}
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`rounded-[2rem] border p-6 flex items-center justify-between transition-colors ${
                    safeMode ? 'border-red-500/50 bg-red-500/10' : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`h-12 w-12 rounded-2xl flex items-center justify-center ${
                      safeMode ? 'bg-red-500 text-white' : 'bg-amber-500/20 text-amber-500'
                    }`}>
                      <ShieldAlert size={24} />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-white">Emergency Moderation Mode (Safe Mode)</h2>
                      <p className="text-sm text-slate-400">
                        {safeMode ? 'Platform restricted: New content creation disabled.' : 'Safe Mode is currently inactive.'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => updateConfig({ safeMode: !safeMode })}
                    className={`relative h-8 w-14 rounded-full transition-colors ${
                      safeMode ? 'bg-red-500' : 'bg-slate-700'
                    }`}
                  >
                    <motion.div 
                      className="absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-sm"
                      animate={{ x: safeMode ? 24 : 0 }}
                    />
                  </button>
                </motion.div>

                <div className="grid gap-8 grid-cols-1 lg:grid-cols-3">
                  {/* Activity & Stats */}
                  <div className="lg:col-span-2 space-y-8">
                    <section>
                      <div className="flex items-center gap-2 mb-4 text-slate-400">
                        <Activity size={16} />
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Platform Activity</h3>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {[
                          { label: 'Confessions', icon: MessageSquare, value: stats.confessionsToday, color: 'text-violet-400' },
                          { label: 'Voice Rooms', icon: Mic, value: stats.activeVoiceRooms, color: 'text-sky-400' },
                          { label: 'Debates', icon: Zap, value: stats.debatesToday, color: 'text-amber-400' },
                          { label: 'Poll Votes', icon: RefreshCw, value: stats.pollVotesToday, color: 'text-emerald-400' },
                          { label: 'Online Now', icon: Users, value: stats.onlineUsers, color: 'text-pink-400' }
                        ].map((s) => (
                          <div key={s.label} className="bg-white/5 border border-white/5 rounded-3xl p-5 hover:bg-white/[0.08] transition">
                            <s.icon size={20} className={`${s.color} mb-3`} />
                            <p className="text-[10px] uppercase font-bold text-slate-500">{s.label}</p>
                            <p className="text-2xl font-bold mt-1 text-white">{s.value}</p>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                       <div className="flex items-center gap-2 mb-4 text-slate-400">
                        <TrendingUp size={16} />
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Trending Content monitor</h3>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                          { type: 'Confession', title: 'Why is VoidChat so dark?', engagement: '42 replies • 128 reactions' },
                          { type: 'Debate', title: 'Arcane vs Cyberpunk Aesthetic', engagement: '18 participants • 94 arguments' },
                          { type: 'Poll', title: 'Next feature release?', engagement: '312 votes total' },
                          { type: 'Voice', title: 'Midnight Chill Vibes', engagement: '14 listeners • Host: Shadow' }
                        ].map((item, i) => (
                          <div key={i} className="group p-5 rounded-[2rem] bg-white/5 border border-white/5 hover:border-amber-500/30 transition cursor-pointer">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[9px] font-black uppercase tracking-widest text-amber-500/70">{item.type}</span>
                              <ChevronRight size={14} className="text-slate-600 group-hover:text-amber-500 transition" />
                            </div>
                            <h4 className="font-bold text-white mb-1 group-hover:text-amber-200 transition">{item.title}</h4>
                            <p className="text-[10px] text-slate-500">{item.engagement}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>

                  <div className="space-y-8">
                    <section className="p-6 rounded-[2.5rem] bg-white/5 border border-white/5">
                      <div className="flex items-center gap-2 mb-6">
                        <Smile size={18} className="text-sky-400" />
                        <h3 className="text-sm font-black uppercase tracking-tight text-white">Community Mood</h3>
                      </div>
                      <div className="space-y-4">
                        {[
                          { label: 'Chaos', color: 'bg-red-500', value: 75 },
                          { label: 'Funny', color: 'bg-amber-500', value: 45 },
                          { label: 'Romantic', color: 'bg-pink-500', value: 30 },
                          { label: 'Sad', color: 'bg-sky-500', value: 15 }
                        ].map((m) => (
                          <div key={m.label} className="space-y-1.5">
                            <div className="flex justify-between text-[10px] uppercase font-bold tracking-widest">
                              <span className="text-slate-400">{m.label}</span>
                              <span className="text-white/40">{m.value}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                              <motion.div 
                                className={`h-full ${m.color}`}
                                initial={{ width: 0 }}
                                animate={{ width: `${m.value}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="p-6 rounded-[2.5rem] bg-white/5 border border-white/5">
                      <div className="flex items-center gap-2 mb-6">
                        <Archive size={18} className="text-white/40" />
                        <h3 className="text-sm font-black uppercase tracking-tight text-white">Content Archive</h3>
                      </div>
                      <div className="space-y-3">
                        {[
                          { icon: MessageSquare, label: 'Deleted Confessions', count: 128 },
                          { icon: Zap, label: 'Closed Debates', count: 54 },
                          { icon: RefreshCw, label: 'Expired Polls', count: 12 }
                        ].map((item, i) => (
                          <button key={i} className="w-full group flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition">
                            <div className="flex items-center gap-3">
                              <item.icon size={14} className="text-slate-500" />
                              <span className="text-xs text-slate-400">{item.label}</span>
                            </div>
                            <span className="text-[10px] font-bold bg-white/5 px-2 py-0.5 rounded-lg text-slate-500 group-hover:text-white transition">{item.count}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            )}

            {adminToolsTab === 'users' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* User Directory & Spam Watch */}
                <div className="grid gap-8 grid-cols-1 lg:grid-cols-4">
                   <div className="lg:col-span-3 space-y-8">
                      {/* User Directory Table */}
                      <section className="bg-white/5 rounded-[2.5rem] border border-white/5 overflow-hidden backdrop-blur-md">
                        <div className="p-8 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-6">
                          <div>
                            <div className="flex items-center gap-3 mb-1">
                              <Users size={22} className="text-sky-400" />
                              <h3 className="text-2xl font-black text-white uppercase tracking-tight">User Directory</h3>
                            </div>
                            <p className="text-slate-400 text-sm">Monitor and manage all citizen accounts</p>
                          </div>
                          <div className="relative group/search w-full md:w-96">
                            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within/search:text-sky-400 transition-colors" />
                            <input 
                              type="text" 
                              placeholder="Search username or ghost name..."
                              className="w-full h-14 rounded-2xl bg-black/20 border border-white/10 pl-12 pr-4 text-sm text-white outline-none focus:border-sky-500/50 focus:bg-black/40 transition-all"
                              value={userSearchQuery}
                              onChange={(e) => setUserSearchQuery(e.target.value)}
                            />
                          </div>
                        </div>

                        <div className="overflow-x-auto p-4">
                          <table className="w-full text-left border-separate border-spacing-y-3">
                            <thead>
                              <tr className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                                <th className="pb-4 pl-4">Account Profile</th>
                                <th className="pb-4">Anonymous Identity</th>
                                <th className="pb-4">Password</th>
                                <th className="pb-4">Current Status</th>
                                <th className="pb-4">Activity Index</th>
                                <th className="pb-4 text-right pr-4">Global Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {allUsers
                                .filter(u => 
                                  u.anonymous_username?.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
                                  u.ghost_name?.toLowerCase().includes(userSearchQuery.toLowerCase())
                                )
                                .slice((userListPage - 1) * usersPerPage, userListPage * usersPerPage)
                                .map((u: any) => (
                                <tr key={u.id} className="bg-white/[0.02] hover:bg-white/[0.05] transition-all rounded-2xl group border border-transparent hover:border-white/5">
                                  <td className="py-4 pl-4 rounded-l-2xl">
                                    <div className="flex items-center gap-4">
                                      <div className={`h-12 w-12 rounded-2xl flex items-center justify-center border transition-all ${
                                        u.status === 'blocked' ? 'bg-red-500/10 border-red-500/20 text-red-500' :
                                        u.status === 'muted' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' :
                                        'bg-sky-500/10 border-sky-500/20 text-sky-500'
                                      }`}>
                                        <UserIcon size={24} />
                                      </div>
                                      <div>
                                        <div className="text-base font-bold text-white leading-tight">{u.real_username || 'Anonymous'}</div>
                                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Joined {u.joined_at ? new Date(u.joined_at).toLocaleDateString() : 'N/A'}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-4">
                                    <div className="flex items-center gap-2">
                                      <Ghost size={14} className="text-slate-500" />
                                      <span className="text-sm text-slate-300 font-medium">{u.anonymous_username || 'No Identity'}</span>
                                    </div>
                                  </td>
                                  <td className="py-4">
                                    <div className="flex items-center gap-2">
                                      <button 
                                        onClick={() => setRevealedPasswords(prev => ({ ...prev, [u.id]: !prev[u.id] }))}
                                        className="text-slate-500 hover:text-white transition-colors"
                                      >
                                        {revealedPasswords[u.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                      </button>
                                      <span className="text-sm text-slate-300 font-mono tracking-tighter">
                                        {revealedPasswords[u.id] ? (u.password || 'Not Stored') : '••••••••'}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-4">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                                      u.status === 'blocked' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                      u.status === 'muted' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                                      'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                    }`}>
                                      {u.status || 'Active'}
                                    </span>
                                  </td>
                                  <td className="py-4">
                                    <div className="flex items-center gap-3">
                                       <div className="h-1.5 w-16 bg-white/5 rounded-full overflow-hidden">
                                         <motion.div 
                                           className="h-full bg-sky-500" 
                                           initial={{ width: 0 }}
                                           animate={{ width: `${Math.min((u.activity_count || 0) / 100 * 100, 100)}%` }}
                                         />
                                       </div>
                                       <span className="text-sm font-black text-white">{u.activity_count || 0}</span>
                                    </div>
                                  </td>
                                  <td className="py-4 pr-4 text-right rounded-r-2xl">
                                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                                      <button 
                                        onClick={() => updateUserStatus(u.id, u.status === 'blocked' ? 'active' : 'blocked')}
                                        className={`h-11 w-11 rounded-xl flex items-center justify-center transition-all ${u.status === 'blocked' ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20'}`}
                                        title={u.status === 'blocked' ? 'Restore Access' : 'Restrict Access'}
                                      >
                                        <Ban size={18} />
                                      </button>
                                      <button 
                                        onClick={() => updateUserStatus(u.id, u.status === 'muted' ? 'active' : 'muted')}
                                        className={`h-11 w-11 rounded-xl flex items-center justify-center transition-all ${u.status === 'muted' ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/20'}`}
                                        title={u.status === 'muted' ? 'Unmute Communications' : 'Silence User'}
                                      >
                                        <MicOff size={18} />
                                      </button>
                                      <button 
                                        onClick={() => deleteUser(u.id)}
                                        className="h-11 w-11 bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-red-500/20 hover:border-red-500/30 rounded-xl flex items-center justify-center transition-all"
                                        title="Delete Permanently"
                                      >
                                        <Trash2 size={18} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Pagination Footer */}
                        <div className="p-8 border-t border-white/5 bg-white/[0.01] flex flex-col sm:flex-row items-center justify-between gap-6">
                          <p className="text-sm text-slate-500 font-medium">
                            Showing <span className="text-white font-bold">{(userListPage - 1) * usersPerPage + 1}</span> to <span className="text-white font-bold">{Math.min(userListPage * usersPerPage, allUsers.length)}</span> of <span className="text-white font-bold">{allUsers.length}</span> verified citizens
                          </p>
                          <div className="flex items-center gap-3">
                            <button 
                              disabled={userListPage === 1}
                              onClick={() => setUserListPage(prev => prev - 1)}
                              className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-white disabled:opacity-30 hover:bg-white/10 transition-all hover:scale-105 active:scale-95"
                            >
                              <ChevronLeft size={24} />
                            </button>
                            <div className="h-12 min-w-[3rem] px-4 flex items-center justify-center rounded-2xl bg-sky-500 text-white text-sm font-black shadow-[0_0_20px_rgba(14,165,233,0.3)]">
                              {userListPage}
                            </div>
                            <button 
                              disabled={userListPage * usersPerPage >= allUsers.length}
                              onClick={() => setUserListPage(prev => prev + 1)}
                              className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-white disabled:opacity-30 hover:bg-white/10 transition-all hover:scale-105 active:scale-95"
                            >
                              <ChevronRight size={24} />
                            </button>
                          </div>
                        </div>
                      </section>
                   </div>

                   <aside className="space-y-8">
                      {/* Spam Watch Monitor */}
                      <section className="bg-white/5 rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md relative overflow-hidden group">
                         <div className="absolute top-0 right-0 p-4 opacity-10">
                            <ShieldAlert size={120} />
                         </div>
                         
                         <div className="flex items-center gap-4 mb-8">
                            <div className="h-14 w-14 rounded-2xl bg-red-500/10 flex items-center justify-center border border-red-500/20 text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
                              <ShieldAlert size={28} />
                            </div>
                            <div>
                              <h3 className="text-xl font-black text-white uppercase tracking-tight">Spam Watch</h3>
                              <p className="text-slate-400 text-sm">Automated system flagging</p>
                            </div>
                         </div>

                         <div className="space-y-6">
                           {flaggedUsers.map((u: any) => (
                             <div key={u.id} className="bg-black/40 rounded-3xl border border-red-500/20 p-6 relative overflow-hidden animate-in slide-in-from-right-4 duration-500">
                               <div className="flex justify-between items-start mb-4">
                                  <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-xl bg-red-500/20 flex items-center justify-center text-red-500">
                                       <Activity size={18} />
                                    </div>
                                    <div className="text-sm font-bold text-white">{u.anonymous_username}</div>
                                  </div>
                                  <div className="text-[10px] font-black text-red-500 bg-red-500/10 px-2 py-1 rounded-lg border border-red-500/20">
                                     {u.risk_score}% RISK
                                  </div>
                               </div>
                               <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-4">REASON: {u.spam_reason}</p>
                               <div className="grid grid-cols-2 gap-2">
                                  <button 
                                    onClick={() => updateUserStatus(u.id, 'muted')}
                                    className="h-10 rounded-xl bg-white/5 text-[10px] font-black uppercase tracking-wider text-white hover:bg-white/10 transition border border-white/10"
                                  >
                                    MUTE
                                  </button>
                                  <button 
                                    onClick={() => updateUserStatus(u.id, 'blocked')}
                                    className="h-10 rounded-xl bg-red-500 text-[10px] font-black uppercase tracking-wider text-white hover:bg-red-600 transition shadow-lg shadow-red-500/20"
                                  >
                                    BAN
                                  </button>
                               </div>
                             </div>
                           ))}

                           {flaggedUsers.length === 0 && (
                             <div className="py-12 flex flex-col items-center justify-center text-center opacity-50">
                               <ShieldCheck size={56} className="text-emerald-500 mb-4" />
                               <p className="text-white font-bold leading-tight">Platform Secure</p>
                               <p className="text-slate-400 text-[10px] uppercase tracking-widest mt-1">No anomalies detected</p>
                             </div>
                           )}
                         </div>
                      </section>

                      {/* Blocked Users Stats */}
                      <section className="bg-white/5 rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md">
                         <div className="flex items-center justify-between mb-8">
                            <h3 className="text-sm font-black text-white uppercase tracking-widest">Restricted Zone</h3>
                            <span className="h-6 w-10 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-[10px] font-black text-red-500 transition-all hover:scale-110">
                              {blockedUsers.length}
                            </span>
                         </div>
                         <div className="space-y-4">
                            {blockedUsers.slice(0, 3).map((u: any) => (
                              <div key={u.id} className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.02] border border-white/5">
                                 <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500">
                                       <UserIcon size={14} />
                                    </div>
                                    <span className="text-xs font-bold text-white">{u.anonymous_username}</span>
                                 </div>
                                 <button 
                                   onClick={() => updateUserStatus(u.id, 'active')}
                                   className="text-[10px] font-black text-emerald-500 hover:text-emerald-400 transition"
                                 >
                                    RESTORE
                                 </button>
                              </div>
                            ))}
                            {blockedUsers.length > 3 && (
                              <button 
                                onClick={() => {
                                  setAdminToolsTab('users');
                                  setUserSearchQuery('status:blocked');
                                }}
                                className="w-full py-2 text-[10px] font-black text-slate-500 hover:text-white uppercase tracking-[0.2em] transition-colors"
                              >
                                View All Restricted
                              </button>
                            )}
                            {blockedUsers.length === 0 && (
                               <p className="text-center text-[10px] text-slate-500 uppercase tracking-widest py-4">Zero restricted users</p>
                            )}
                         </div>
                      </section>
                   </aside>
                </div>
              </div>
            )}

            {adminToolsTab === 'content' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* Content Moderation Center */}
                <section className="bg-white/5 rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md">
                   <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <Layers size={22} className="text-amber-400" />
                          <h3 className="text-2xl font-black text-white uppercase tracking-tight">Content Control</h3>
                        </div>
                        <p className="text-slate-400 text-sm">Monitor and moderate recent platform activity</p>
                      </div>
                   </div>

                   <div className="grid gap-8 grid-cols-1 lg:grid-cols-3">
                      {/* Recent Confessions */}
                      <div className="space-y-6">
                        <div className="flex items-center justify-between pb-4 border-b border-white/5">
                           <h4 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Recent Confessions</h4>
                           <span className="text-[10px] bg-sky-500/10 text-sky-500 px-2 py-0.5 rounded-lg border border-sky-500/20 font-bold">LIVE</span>
                        </div>
                        <div className="space-y-4">
                           {recentContent.confessions.map((c: any) => (
                             <div key={c.id} className="group p-5 rounded-3xl bg-black/40 border border-white/5 hover:border-sky-500/30 transition-all relative">
                                <p className="text-sm text-slate-300 leading-relaxed line-clamp-3 mb-4">{c.content}</p>
                                <div className="flex items-center justify-between">
                                   <div className="flex items-center gap-2">
                                      <div className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
                                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                        {c.created_at?.toDate ? c.created_at.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'NEW'}
                                      </span>
                                   </div>
                                   <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 hover:text-white transition"><Pin size={14} /></button>
                                      <button className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 hover:text-red-500 transition"><Trash2 size={14} /></button>
                                   </div>
                                </div>
                             </div>
                           ))}
                        </div>
                      </div>

                      {/* Recent Debates */}
                      <div className="space-y-6">
                        <div className="flex items-center justify-between pb-4 border-b border-white/5">
                           <h4 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Recent Debates</h4>
                           <span className="text-[10px] bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-lg border border-amber-500/20 font-bold">ACTIVE</span>
                        </div>
                        <div className="space-y-4">
                           {recentContent.debates.map((d: any) => (
                             <div key={d.id} className="group p-5 rounded-3xl bg-black/40 border border-white/5 hover:border-amber-500/30 transition-all relative">
                                <div className="mb-2">
                                   <span className="text-[10px] font-black uppercase tracking-widest text-amber-500/70">{d.category || 'General'}</span>
                                   <h5 className="text-sm font-bold text-white mt-1 line-clamp-2">{d.topic}</h5>
                                </div>
                                <div className="flex items-center justify-between mt-4">
                                   <div className="flex items-center gap-2">
                                      <Users size={12} className="text-slate-500" />
                                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{d.participants?.length || 0} Battling</span>
                                   </div>
                                   <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 hover:text-amber-500 transition"><Star size={14} /></button>
                                      <button className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 hover:text-red-500 transition"><Trash2 size={14} /></button>
                                   </div>
                                </div>
                             </div>
                           ))}
                        </div>
                      </div>

                      {/* Recent Polls */}
                      <div className="space-y-6">
                        <div className="flex items-center justify-between pb-4 border-b border-white/5">
                           <h4 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Recent Polls</h4>
                           <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-lg border border-emerald-500/20 font-bold">VOTING</span>
                        </div>
                        <div className="space-y-4">
                           {recentContent.polls.map((p: any) => (
                             <div key={p.id} className="group p-5 rounded-3xl bg-black/40 border border-white/5 hover:border-emerald-500/30 transition-all relative">
                                <h5 className="text-sm font-bold text-white mb-2 line-clamp-2">{p.question}</h5>
                                <div className="space-y-2 mb-4">
                                   {p.options?.slice(0, 2).map((opt: any, idx: number) => (
                                     <div key={idx} className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500/40" style={{ width: `${Math.random() * 100}%` }} />
                                     </div>
                                   ))}
                                </div>
                                <div className="flex items-center justify-between">
                                   <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{p.total_votes || 0} Votes</span>
                                   <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 hover:text-emerald-500 transition"><RefreshCw size={14} /></button>
                                      <button className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 hover:text-red-500 transition"><Trash2 size={14} /></button>
                                   </div>
                                </div>
                             </div>
                           ))}
                        </div>
                      </div>
                   </div>
                </section>
              </div>
            )}

            {adminToolsTab === 'analytics' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* Advanced Analytics */}
                <div className="grid gap-8 grid-cols-1 lg:grid-cols-2">
                   <section className="bg-white/5 rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md">
                      <div className="flex items-center justify-between mb-10">
                         <div className="flex items-center gap-4">
                            <div className="h-12 w-12 rounded-2xl bg-pink-500/10 flex items-center justify-center text-pink-500">
                               <Activity size={24} />
                            </div>
                            <div>
                               <h3 className="text-xl font-black text-white uppercase tracking-tight">Growth Velocity</h3>
                               <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">New Users per Hour</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-500 px-3 py-1.5 rounded-xl border border-emerald-500/20">
                            <ArrowUpRight size={14} />
                            <span className="text-xs font-black">+12%</span>
                         </div>
                      </div>
                      <div className="h-64 flex items-end justify-between gap-2 px-2">
                         {[40, 65, 45, 90, 75, 55, 100, 85, 60, 70, 45, 80].map((h, i) => (
                           <motion.div 
                             key={i}
                             initial={{ height: 0 }}
                             animate={{ height: `${h}%` }}
                             transition={{ delay: i * 0.05, duration: 1, ease: "circOut" }}
                             className="flex-1 bg-gradient-to-t from-pink-500/20 to-pink-500/50 rounded-t-lg relative group"
                           >
                              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-white text-black text-[10px] font-bold px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                 {h}
                              </div>
                           </motion.div>
                         ))}
                      </div>
                      <div className="flex justify-between mt-4 px-2">
                         <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">08:00</span>
                         <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">20:00</span>
                      </div>
                   </section>

                   <section className="bg-white/5 rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md">
                      <div className="flex items-center justify-between mb-10">
                         <div className="flex items-center gap-4">
                            <div className="h-12 w-12 rounded-2xl bg-sky-500/10 flex items-center justify-center text-sky-500">
                               <BarChart3 size={24} />
                            </div>
                            <div>
                               <h3 className="text-xl font-black text-white uppercase tracking-tight">Engagement Heat</h3>
                               <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Activity Distribution</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-1 text-slate-500">
                            <RefreshCw size={12} className="animate-spin-slow" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Live Updates</span>
                         </div>
                      </div>
                      <div className="space-y-6">
                         {[
                           { label: 'Confessions', val: 85, color: 'sky' },
                           { label: 'Debates', val: 62, color: 'amber' },
                           { label: 'Voice Lounge', val: 44, color: 'pink' },
                           { label: 'Polls', val: 31, color: 'emerald' }
                         ].map((item) => (
                           <div key={item.label} className="space-y-2">
                              <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest">
                                 <span className="text-slate-400">{item.label}</span>
                                 <span className="text-white">{item.val}%</span>
                              </div>
                              <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                 <motion.div 
                                   initial={{ width: 0 }}
                                   animate={{ width: `${item.val}%` }}
                                   transition={{ duration: 1.5, ease: "circOut" }}
                                   className={`h-full bg-${item.color}-500 shadow-[0_0_10px_rgba(var(--${item.color}-500-rgb),0.5)]`}
                                 />
                              </div>
                           </div>
                         ))}
                      </div>
                   </section>
                </div>

                <div className="grid gap-8 grid-cols-1 md:grid-cols-4">
                   {[
                     { label: 'Total Confessions', val: '12,842', trend: '+124', icon: MessageSquare, color: 'sky' },
                     { label: 'Active Debates', val: '43', trend: '+2', icon: Sword, color: 'amber' },
                     { label: 'Live Listeners', val: '892', trend: '+45', icon: Radio, color: 'pink' },
                     { label: 'Total Votes', val: '5,120', trend: '+312', icon: Table, color: 'emerald' }
                   ].map((s) => (
                     <div key={s.label} className="bg-white/5 border border-white/5 rounded-3xl p-6 hover:bg-white/[0.07] transition-colors group">
                        <div className={`h-10 w-10 rounded-xl bg-${s.color}-500/10 flex items-center justify-center text-${s.color}-500 mb-4 group-hover:scale-110 transition-transform`}>
                           <s.icon size={20} />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{s.label}</p>
                        <div className="flex items-baseline gap-2">
                           <h4 className="text-2xl font-black text-white">{s.val}</h4>
                           <span className="text-[10px] font-bold text-emerald-500">{s.trend}</span>
                        </div>
                     </div>
                   ))}
                </div>
              </div>
            )}

            {adminToolsTab === 'system' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* System Controls & Announcements */}
                <div className="grid gap-8 grid-cols-1 lg:grid-cols-2">
                   {/* Feature Toggles */}
                   <section className="bg-white/5 rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md">
                      <div className="flex items-center gap-3 mb-8">
                         <div className="h-10 w-10 rounded-2xl bg-sky-500/10 flex items-center justify-center text-sky-500">
                            <Settings size={20} />
                         </div>
                         <div>
                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Feature Controls</h3>
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Global Platform Toggles</p>
                         </div>
                      </div>

                      <div className="space-y-4">
                         {[
                           { id: 'disableConfessions', label: 'Disable Confessions', icon: MessageSquare, color: 'sky' },
                           { id: 'disableDebates', label: 'Disable Debates', icon: Sword, color: 'amber' },
                           { id: 'disablePolls', label: 'Disable Polls', icon: Table, color: 'emerald' },
                           { id: 'disableVoiceRooms', label: 'Disable Voice Rooms', icon: Radio, color: 'pink' },
                           { id: 'disableShoutouts', label: 'Disable Shoutouts', icon: Megaphone, color: 'sky' }
                         ].map((f) => (
                           <div key={f.id} className="flex items-center justify-between p-4 rounded-3xl bg-black/40 border border-white/5">
                              <div className="flex items-center gap-4">
                                 <div className={`h-10 w-10 rounded-xl bg-${f.color}-500/10 flex items-center justify-center text-${f.color}-500`}>
                                    <f.icon size={18} />
                                 </div>
                                 <span className="text-sm font-bold text-white">{f.label}</span>
                              </div>
                              <button 
                                onClick={() => toggleSystemFeature(f.id as any)}
                                className={`relative w-14 h-7 rounded-full transition-colors duration-300 ${systemConfig[f.id as keyof typeof systemConfig] ? `bg-${f.color}-500` : 'bg-white/10'}`}
                              >
                                 <div className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white transition-transform duration-300 ${systemConfig[f.id as keyof typeof systemConfig] ? 'translate-x-7' : 'translate-x-0'}`} />
                              </button>
                           </div>
                         ))}
                      </div>
                   </section>

                   {/* Global Announcements */}
                   <section className="bg-white/5 rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md">
                      <div className="flex items-center gap-3 mb-8">
                         <div className="h-10 w-10 rounded-2xl bg-pink-500/10 flex items-center justify-center text-pink-500">
                            <Megaphone size={20} />
                         </div>
                         <div>
                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Global Broadcast</h3>
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Send Toast to all Users</p>
                         </div>
                      </div>

                      <div className="space-y-6">
                         <div className="relative">
                            <textarea 
                               value={announcementText}
                               onChange={(e) => setAnnouncementText(e.target.value)}
                               placeholder="Type your global message here..."
                               className="w-full h-40 bg-black/40 border border-white/5 rounded-[2rem] p-6 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-pink-500/50 transition-all resize-none"
                            />
                            <div className="absolute bottom-6 right-6 flex gap-2">
                               <button 
                                 onClick={() => broadcastAnnouncement()}
                                 className="h-10 px-6 rounded-xl bg-pink-500 text-xs font-black uppercase tracking-widest text-white hover:bg-pink-600 transition shadow-lg shadow-pink-500/20"
                               >
                                  Broadcast
                               </button>
                            </div>
                         </div>
                         
                         <div className="flex items-center gap-4 p-4 rounded-3xl bg-amber-500/5 border border-amber-500/10">
                            <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                            <p className="text-[10px] font-bold text-amber-500/80 uppercase leading-relaxed tracking-wider">
                               Announcements are sent in real-time to all connected clients as system notifications.
                            </p>
                         </div>
                      </div>
                   </section>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Nuclear Confirmation Modal */}
        <AnimatePresence>
          {showNuclearModal && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-2xl">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="w-full max-w-xl rounded-[2.5rem] border border-red-500/30 bg-[#0d0e12] p-8 md:p-12 shadow-[0_0_100px_rgba(239,68,68,0.2)]"
              >
                <div className="flex flex-col items-center text-center">
                  <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-red-500/10 text-red-500 border border-red-500/20">
                    <Bomb size={40} />
                  </div>
                  <h3 className="text-3xl font-black uppercase tracking-tight text-white mb-4">Are you absolutely sure?</h3>
                  <p className="text-slate-400 mb-8 max-w-md">
                    This action is <span className="text-red-400 font-bold">irreversible</span>. Once initiated, all platform data will be scrubbed from existance.
                  </p>

                  <div className="w-full space-y-6">
                    <div className="space-y-3">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-red-500/60 ml-1">
                        Type <span className="text-red-500">{CONFIRMATION_PHRASE}</span> to confirm
                      </label>
                      <input 
                        type="text" 
                        placeholder="Type confirm phrase..."
                        className="w-full h-16 rounded-2xl border border-white/10 bg-white/5 px-6 text-center text-lg font-bold text-white outline-none focus:border-red-500/50 transition caret-red-500"
                        value={nuclearConfirmText}
                        onChange={(e) => setNuclearConfirmText(e.target.value)}
                        disabled={isErasing}
                      />
                    </div>

                    {isErasing && (
                      <div className="space-y-4">
                        <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                          <motion.div 
                            className="h-full bg-red-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${(erasureProgress / erasureTotal) * 100}%` }}
                          />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-red-400 animate-pulse">
                          Wiping platform data... {erasureProgress}/{erasureTotal} regions cleaned
                        </p>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-3 pt-4">
                      <button
                        onClick={() => {
                          if (!isErasing) {
                            setShowNuclearModal(false);
                            setNuclearConfirmText('');
                          }
                        }}
                        className="flex-1 h-14 rounded-2xl border border-white/10 text-sm font-bold text-white/40 hover:bg-white/5 hover:text-white transition disabled:opacity-30"
                        disabled={isErasing}
                      >
                        ABORT
                      </button>
                      <button
                        disabled={nuclearConfirmText !== CONFIRMATION_PHRASE || isErasing}
                        onClick={executeNuclearOption}
                        className="flex-1 h-14 rounded-2xl bg-red-500 flex items-center justify-center gap-3 text-sm font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-20 disabled:hover:bg-red-500 transition shadow-lg shadow-red-500/20"
                      >
                        {isErasing ? (
                          <Loader2 className="animate-spin" size={18} />
                        ) : (
                          <>
                            <Bomb size={18} />
                            ERASE EVERYTHING
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
