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
  HelpCircle,
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
  limit,
  Timestamp
} from 'firebase/firestore';
import { ref, onValue, off } from 'firebase/database';
import { db, rtdb } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useSystemConfig, SystemConfig } from '../hooks/useSystemConfig';
import { toast } from 'sonner';

interface Report {
  id: string;
  reporter_id: string;
  target_type: 'shoutout' | 'shoutout_comment' | 'message' | 'confession' | 'confession_comment' | 'chat_room' | 'debate' | 'debate_argument' | 'question' | 'answer' | 'poll' | 'user' | 'whisper_story' | 'whisper_story_part' | 'whisper_story_comment';
  target_id: string;
  reason: string;
  description: string;
  status: 'pending' | 'reviewed' | 'resolved' | 'ignored';
  created_at: any;
  reporter_name?: string;
  target_preview?: string;
  story_id?: string;
  room_id?: string;
}

export default function AdminModeration() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'reviewed' | 'resolved' | 'ignored'>('pending');
  const [search, setSearch] = useState('');
  const [fetching, setFetching] = useState(true);

  const formatSafeDate = (date: any) => {
    if (!date) return '—';
    try {
      if (date?.toDate) return date.toDate().toLocaleString();
      if (date?.seconds) return new Date(date.seconds * 1000).toLocaleString();
      const d = new Date(date);
      return isNaN(d.getTime()) ? 'Invalid Date' : d.toLocaleString();
    } catch (e) {
      return 'Invalid Date';
    }
  };

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
    onlineUsers: 0,
    deletedConfessions: 0,
    closedDebates: 0,
    expiredPolls: 0,
    totalConfessions: 0,
    totalDebates: 0,
    totalPolls: 0
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
  const [isScanningSpam, setIsScanningSpam] = useState(false);
  const [activeAnnouncements, setActiveAnnouncements] = useState<any[]>([]);

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

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTimestamp = Timestamp.fromDate(startOfDay);

    // Confessions Today
    const confQ = query(
      collection(db, 'confessions'), 
      where('created_at', '>=', startTimestamp)
    );
    const unSubConf = onSnapshot(confQ, (snap) => {
      setStats(prev => ({ ...prev, confessionsToday: snap.size }));
    });

    // Active Voice Rooms
    const vrQ = query(
      collection(db, 'voice_rooms'), 
      where('status', '==', 'active')
    );
    const unSubVR = onSnapshot(vrQ, (snap) => {
      setStats(prev => ({ ...prev, activeVoiceRooms: snap.size }));
    });

    // Debates Today
    const debQ = query(
      collection(db, 'debates'), 
      where('created_at', '>=', startTimestamp)
    );
    const unSubDeb = onSnapshot(debQ, (snap) => {
      setStats(prev => ({ ...prev, debatesToday: snap.size }));
    });

    // Poll Votes Today
    const votesQ = query(
      collection(db, 'poll_votes'), 
      where('created_at', '>=', startTimestamp)
    );
    const unSubVotes = onSnapshot(votesQ, (snap) => {
      setStats(prev => ({ ...prev, pollVotesToday: snap.size }));
    });

    // Online Users (RTDB Presence)
    const presenceRef = ref(rtdb, 'presence');
    const onPresenceValue = onValue(presenceRef, (snapshot) => {
      const data = snapshot.val() || {};
      let total = 0;
      // Presence is nested by room_id or just global platform presence?
      // Based on VoiceRooms.tsx: presence/${roomId}/${userId}
      // We should probably count all unique users across all rooms or check a global presence path
      Object.keys(data).forEach(roomId => {
        total += Object.keys(data[roomId] || {}).length;
      });
      setStats(prev => ({ ...prev, onlineUsers: total }));
    });

    // Total counts for Archive
    const unsubUnConf = onSnapshot(collection(db, 'confessions'), snap => {
      setStats(prev => ({ ...prev, totalConfessions: snap.size }));
    });
    
    const unsubUnDeb = onSnapshot(collection(db, 'debates'), snap => {
      setStats(prev => ({ ...prev, totalDebates: snap.size }));
    });

    const unsubUnPolls = onSnapshot(collection(db, 'polls'), snap => {
      setStats(prev => ({ ...prev, totalPolls: snap.size }));
    });

    return () => {
      unSubConf();
      unSubVR();
      unSubDeb();
      unSubVotes();
      unsubUnConf();
      unsubUnDeb();
      unsubUnPolls();
      off(presenceRef, 'value', onPresenceValue);
    };
  }, [activeTab]);

  // User Growth Analytics Effect
  useEffect(() => {
    if (activeTab !== 'tools' || adminToolsTab !== 'analytics') return;

    // Fetch all users metadata for growth chart
    // We only need the joined_at field
    const q = query(collection(db, 'profiles'), orderBy('joined_at', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const users = snap.docs.map(d => ({ 
        joined_at: d.data().joined_at 
      }));
      setAllUsers(users);
    });

    return () => unsub();
  }, [activeTab, adminToolsTab]);

  // Trending Content & Mood Effect
  useEffect(() => {
    if (activeTab !== 'tools' || adminToolsTab !== 'overview') return;

    // Fetch collections for aggregation
    const confessionsQ = query(collection(db, 'confessions'), orderBy('created_at', 'desc'), limit(100));
    const debatesQ = query(collection(db, 'debates'), orderBy('created_at', 'desc'), limit(50));
    const pollsQ = query(collection(db, 'polls'), orderBy('created_at', 'desc'), limit(50));
    const commentsQ = query(collection(db, 'confession_comments'), orderBy('created_at', 'desc'), limit(200));

    const unsubConf = onSnapshot(confessionsQ, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      
      // Community Mood Calculation
      const moods: Record<string, number> = { Chaos: 0, Funny: 0, Romantic: 0, Sad: 0, Awkward: 0 };
      data.forEach(c => {
        if (c.category === 'crush') moods.Romantic++;
        else if (c.category === 'funny') moods.Funny++;
        else if (c.category === 'academic') moods.Awkward++;
        else if (c.category === 'random') moods.Chaos++;
        else moods.Sad++;
      });
      const total = data.length || 1;
      setStats(prev => ({ 
        ...prev, 
        moods: Object.entries(moods).map(([label, count]) => ({
          label,
          value: Math.round((count / total) * 100),
          color: label === 'Chaos' ? 'bg-red-500' : 
                 label === 'Funny' ? 'bg-amber-500' : 
                 label === 'Romantic' ? 'bg-pink-500' : 
                 label === 'Awkward' ? 'bg-sky-500' : 'bg-slate-500'
        }))
      }));

      // Trending Confession
      const topConf = data.sort((a, b) => (b.likes || 0) - (a.likes || 0))[0];
      setTrending(prev => ({ ...prev, confession: topConf }));
    });

    const unsubDeb = onSnapshot(debatesQ, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const closed = data.filter(d => d.status === 'closed').length;
      const topDeb = data.sort((a, b) => ((b.participantCount || 0) + (b.votes_a || 0) + (b.votes_b || 0)) - ((a.participantCount || 0) + (a.votes_a || 0) + (a.votes_b || 0)))[0];
      
      setStats(prev => ({ ...prev, closedDebates: closed }));
      setTrending(prev => ({ ...prev, debate: topDeb }));
    });

    const unsubPolls = onSnapshot(pollsQ, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const now = new Date();
      const expired = data.filter(p => p.expires_at && (p.expires_at.toDate ? p.expires_at.toDate() : new Date(p.expires_at)) < now).length;
      const topPoll = data.sort((a, b) => (b.total_votes || 0) - (a.total_votes || 0))[0];
      
      setStats(prev => ({ ...prev, expiredPolls: expired }));
      setTrending(prev => ({ ...prev, poll: topPoll }));
    });

    return () => {
      unsubConf();
      unsubDeb();
      unsubPolls();
    };
  }, [activeTab, adminToolsTab]);

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
    let unsubAnnouncements: any;

    if (adminToolsTab === 'system') {
      const annQ = query(collection(db, 'global_announcements'), orderBy('created_at', 'desc'), limit(5));
      unsubAnnouncements = onSnapshot(annQ, (snap) => {
        setActiveAnnouncements(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
    }
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

  const toggleSystemFeature = async (feature: keyof SystemConfig) => {
    const isCurrentlyDisabled = config[feature];
    const action = isCurrentlyDisabled ? "re-enable" : "temporarily disable";
    const featureName = (feature as string).replace('disable', '');
    
    if (!window.confirm(`Are you sure you want to ${action} ${featureName}? This will affect all users immediately.`)) return;

    try {
      await updateConfig({
        [feature]: !isCurrentlyDisabled
      });
      toast.success(`${featureName} ${isCurrentlyDisabled ? 'enabled' : 'disabled'} successfully.`);
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

  const deleteAnnouncement = async (id: string) => {
    if (!window.confirm('Are you sure you want to remove this announcement for all users?')) return;
    try {
      await deleteDoc(doc(db, 'global_announcements', id));
      toast.success('Announcement removed.');
    } catch (err) {
      console.error('Delete announcement error:', err);
      toast.error('Failed to remove announcement.');
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
    setIsScanningSpam(true);
    // Basic spam pattern detection enhanced with reports
    setTimeout(() => {
      const flagged: any[] = [];
      allUsers.forEach((u: any) => {
        let riskScore = 0;
        const reasons: string[] = [];

        // Factor 1: High activity
        if (u.activity_count > 50) {
          riskScore += 40;
          reasons.push('High activity frequency');
        } else if (u.activity_count > 20) {
          riskScore += 15;
          reasons.push('Elevated activity');
        }

        // Factor 2: Reports against user
        const userReports = reports.filter(r => r.target_id === u.id || (r.target_type === 'user' && r.target_id === u.id)).length;
        if (userReports > 0) {
          riskScore += Math.min(userReports * 20, 50);
          reasons.push(`${userReports} community report(s)`);
        }

        // Factor 3: Account Age (New accounts are higher risk if they have reports)
        const joinedDate = u.joined_at ? new Date(u.joined_at) : new Date();
        const hoursOld = (new Date().getTime() - joinedDate.getTime()) / (1000 * 60 * 60);
        if (hoursOld < 24 && (u.activity_count > 10 || userReports > 0)) {
          riskScore += 20;
          reasons.push('Highly active new account');
        }

        if (riskScore >= 40) {
          flagged.push({
            ...u,
            spam_reason: reasons.join(', '),
            risk_score: Math.min(riskScore, 100)
          });
        }
      });
      setFlaggedUsers(flagged.sort((a, b) => b.risk_score - a.risk_score));
      setIsScanningSpam(false);
    }, 1000); // Simulate processing delay for UX feedback
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
      case 'whisper_story': collectionName = 'whisper_stories'; break;
      case 'whisper_story_part': collectionName = 'whisper_story_parts'; break;
      case 'whisper_story_comment': collectionName = 'whisper_story_comments'; break;
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

  const handleQuickDelete = async (type: string, id: string) => {
    if (!window.confirm(`Are you sure you want to delete this ${type}?`)) return;
    
    let collectionName = '';
    switch (type) {
      case 'confession': collectionName = 'confessions'; break;
      case 'debate': collectionName = 'debates'; break;
      case 'poll': collectionName = 'polls'; break;
      default: return;
    }

    try {
      await deleteDoc(doc(db, collectionName, id));
      toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted successfully.`);
    } catch (error: any) {
      console.error('Delete content error:', error);
      toast.error(`Failed to delete content: ${error.message}`);
    }
  };

  const getTargetUrl = (report: Report) => {
    if (!report) return null;
    const type = (report.target_type || '').toLowerCase().trim();
    const id = report.target_id;
    const storyId = report.story_id;
    const roomId = report.room_id;

    if (!id) return null;

    switch (type) {
      case 'confession':
      case 'confession_comment':
        return `/confessions#${id}`;
      case 'debate':
      case 'debate_argument':
        return `/debate-arena/${id}`;
      case 'poll':
        return `/polls#${id}`;
      case 'whisper_story':
        return `/whisper/story/${id}`;
      case 'whisper_story_part':
      case 'whisper_story_comment':
        return storyId ? `/whisper/story/${storyId}` : '/whisper/stories';
      case 'shoutout':
      case 'shoutout_comment':
        return '/shoutouts';
      case 'chat_room':
        return `/room/${id}`;
      case 'answer':
        return `/qna#${id}`;
      case 'message':
        return roomId ? `/room/${roomId}` : '/chat-center';
      default:
        console.warn('Unknown report type for navigation:', type);
        return null;
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
                  id="adminReportSearchInput"
                  name="adminReportSearchInput"
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
                        {formatSafeDate(report.created_at)}
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
                      {getTargetUrl(report) ? (
                        <Link 
                          to={getTargetUrl(report)!}
                          className="flex items-center gap-2 text-amber-500 transition-colors group/target"
                          title="View reported content"
                        >
                          <Eye size={14} className="group-hover/target:scale-110 transition-transform" />
                          TARGET: <span className="font-mono underline decoration-amber-500/50 underline-offset-4 group-hover/target:decoration-amber-500 transition-all">{report.target_id.slice(0, 8)}</span>
                        </Link>
                      ) : (
                        <div className="flex items-center gap-2 opacity-40">
                          <Eye size={14} />
                          TARGET: <span className="font-mono">{report.target_id.slice(0, 8)}</span>
                        </div>
                      )}
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
                    onClick={() => {
                      const nextState = !safeMode;
                      if (nextState) {
                        if (window.confirm("ARE YOU SURE? This will disable content creation platform-wide for all non-admin users immediately.")) {
                          updateConfig({ safeMode: true });
                          toast.warning("EMERGENCY MODE ACTIVATED");
                        }
                      } else {
                        updateConfig({ safeMode: false });
                        toast.success("Emergency Mode Deactivated");
                      }
                    }}
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
                          { 
                            type: 'Confession', 
                            title: trending.confession?.content || 'Calculating...', 
                            engagement: `${trending.confession?.likes || 0} reactions` 
                          },
                          { 
                            type: 'Debate', 
                            title: trending.debate?.title || 'Calculating...', 
                            engagement: `${(trending.debate?.votes_a || 0) + (trending.debate?.votes_b || 0)} votes • ${trending.debate?.participantCount || 0} participants` 
                          },
                          { 
                            type: 'Poll', 
                            title: trending.poll?.question || 'Calculating...', 
                            engagement: `${trending.poll?.total_votes || 0} votes total` 
                          },
                          { 
                            type: 'Voice', 
                            title: 'Active Voice Channels', 
                            engagement: `${stats.activeVoiceRooms} channels live` 
                          }
                        ].map((item, i) => {
                          const navigateToContent = () => {
                            if (item.type === 'Confession' && trending.confession?.id) {
                              navigate(`/confessions#${trending.confession.id}`);
                            } else if (item.type === 'Debate' && trending.debate?.id) {
                              navigate(`/debate-arena/${trending.debate.id}`);
                            } else if (item.type === 'Poll' && trending.poll?.id) {
                              navigate(`/polls#${trending.poll.id}`);
                            } else if (item.type === 'Voice') {
                              navigate('/voice');
                            }
                          };

                          return (
                            <div 
                              key={i} 
                              onClick={navigateToContent}
                              className="group p-5 rounded-[2rem] bg-white/5 border border-white/5 hover:border-amber-500/30 transition cursor-pointer"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[9px] font-black uppercase tracking-widest text-amber-500/70">{item.type}</span>
                                <ChevronRight size={14} className="text-slate-600 group-hover:text-amber-500 transition" />
                              </div>
                              <h4 className="font-bold text-white mb-1 group-hover:text-amber-200 transition line-clamp-1">{item.title}</h4>
                              <p className="text-[10px] text-slate-500">{item.engagement}</p>
                            </div>
                          );
                        })}
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
                        {(stats as any).moods?.map((m: any) => (
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
                        )) || (
                          <p className="text-[10px] text-slate-500 italic">Analyzing community vibes...</p>
                        )}
                      </div>
                    </section>

                    <section className="p-6 rounded-[2.5rem] bg-white/5 border border-white/5">
                      <div className="flex items-center gap-2 mb-6">
                        <Archive size={18} className="text-white/40" />
                        <h3 className="text-sm font-black uppercase tracking-tight text-white">Content Archive</h3>
                      </div>
                      <div className="space-y-3">
                        {[
                          { icon: MessageSquare, label: 'Deleted Confessions', count: stats.deletedConfessions || 0 },
                          { icon: Zap, label: 'Closed Debates', count: stats.closedDebates || 0 },
                          { icon: RefreshCw, label: 'Expired Polls', count: stats.expiredPolls || 0 }
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
                             <button
                               onClick={runSpamDetection}
                               disabled={isScanningSpam}
                               className="ml-auto p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all disabled:opacity-50"
                               title="Run Manual Scan"
                             >
                               <RefreshCw size={18} className={isScanningSpam ? 'animate-spin text-sky-400' : ''} />
                             </button>
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
                              <div 
                                key={c.id} 
                                className="group p-5 rounded-3xl bg-black/40 border border-white/5 hover:border-sky-500/30 transition-all relative cursor-pointer"
                                onClick={(e) => {
                                  if ((e.target as HTMLElement).closest('button')) return;
                                  const url = getTargetUrl({ target_type: 'confession', target_id: c.id } as Report);
                                  if (url) navigate(url);
                                }}
                              >
                                 <p className="text-sm text-slate-300 leading-relaxed line-clamp-3 mb-4">{c.content}</p>
                                 <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                       <div className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
                                       <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                         {c.created_at?.toDate ? c.created_at.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'NEW'}
                                       </span>
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                       <button 
                                         onClick={(e) => {
                                           e.stopPropagation();
                                           handleQuickDelete('confession', c.id);
                                         }}
                                         className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 hover:text-red-500 transition"
                                       >
                                         <Trash2 size={14} />
                                       </button>
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
                              <div 
                                key={d.id} 
                                className="group p-5 rounded-3xl bg-black/40 border border-white/5 hover:border-amber-500/30 transition-all relative cursor-pointer"
                                onClick={(e) => {
                                  if ((e.target as HTMLElement).closest('button')) return;
                                  const url = getTargetUrl({ target_type: 'debate', target_id: d.id } as Report);
                                  if (url) navigate(url);
                                }}
                              >
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
                                       <button 
                                         onClick={(e) => {
                                           e.stopPropagation();
                                           handleQuickDelete('debate', d.id);
                                         }}
                                         className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 hover:text-red-500 transition"
                                       >
                                         <Trash2 size={14} />
                                       </button>
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
                              <div 
                                key={p.id} 
                                className="group p-5 rounded-3xl bg-black/40 border border-white/5 hover:border-emerald-500/30 transition-all relative cursor-pointer"
                                onClick={(e) => {
                                  if ((e.target as HTMLElement).closest('button')) return;
                                  const url = getTargetUrl({ target_type: 'poll', target_id: p.id } as Report);
                                  if (url) navigate(url);
                                }}
                              >
                                 <h5 className="text-sm font-bold text-white mb-2 line-clamp-2">{p.question}</h5>
                                 <div className="space-y-2 mb-4">
                                    {p.options?.map((opt: any, idx: number) => {
                                      const totalVotes = p.total_votes || 1;
                                      const percentage = Math.round(((opt.votes || 0) / totalVotes) * 100);
                                      return (
                                        <div key={idx} className="space-y-1">
                                          <div className="flex justify-between items-center text-[8px] uppercase font-bold text-slate-500 tracking-tighter">
                                            <span>{opt.text}</span>
                                            <span>{percentage}%</span>
                                          </div>
                                          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                            <div className="h-full bg-emerald-500/40 transition-all duration-1000" style={{ width: `${percentage}%` }} />
                                          </div>
                                        </div>
                                      );
                                    })}
                                 </div>
                                 <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{p.total_votes || 0} Votes</span>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                       <button 
                                         onClick={(e) => {
                                           e.stopPropagation();
                                           handleQuickDelete('poll', p.id);
                                         }}
                                         className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 hover:text-red-500 transition"
                                       >
                                         <Trash2 size={14} />
                                       </button>
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
                               <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Citizens per Month (New)</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-500 px-3 py-1.5 rounded-xl border border-emerald-500/20">
                            <ArrowUpRight size={14} />
                            <span className="text-xs font-black">+{Math.round((allUsers.length / 100) * 100)}%</span>
                         </div>
                      </div>
                      <div className="h-64 flex items-end justify-between gap-2 px-2">
                         {(() => {
                           // Bucket users by month/day of joining
                           const buckets = new Array(12).fill(0);
                           allUsers.forEach((u: any) => {
                             const date = u.joined_at ? new Date(u.joined_at) : new Date();
                             const month = date.getMonth();
                             buckets[month]++;
                           });
                           const max = Math.max(...buckets, 1);
                           return buckets.map((count, i) => (
                             <motion.div 
                               key={i}
                               initial={{ height: 0 }}
                               animate={{ height: `${(count / max) * 100}%` }}
                               className="flex-1 bg-gradient-to-t from-pink-500/20 to-pink-500/50 rounded-t-lg relative group"
                             >
                                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-white text-black text-[10px] font-bold px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                                   {count} New
                                </div>
                             </motion.div>
                           ));
                         })()}
                      </div>
                      <div className="flex justify-between mt-4 px-2">
                         <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">JAN</span>
                         <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">DEC</span>
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
                         <button 
                           onClick={() => {
                             toast.success('Analytics synchronized successfully.');
                           }}
                           className="flex items-center gap-1 text-slate-500 hover:text-white transition-colors group"
                         >
                            <RefreshCw size={12} className="group-active:animate-spin" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Live Updates</span>
                         </button>
                      </div>
                      <div className="space-y-6">
                         {(() => {
                           const total = (stats.totalConfessions || 0) + (stats.totalDebates || 0) + (stats.onlineUsers || 0) + (stats.totalPolls || 0) || 1;
                           return [
                             { label: 'Confessions', val: Math.round(((stats.totalConfessions || 0) / total) * 100), color: 'sky' },
                             { label: 'Debates', val: Math.round(((stats.totalDebates || 0) / total) * 100), color: 'amber' },
                             { label: 'Voice Lounge', val: Math.round(((stats.onlineUsers || 0) / total) * 100), color: 'pink' },
                             { label: 'Polls', val: Math.round(((stats.totalPolls || 0) / total) * 100), color: 'emerald' }
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
                                     className={`h-full bg-${item.color}-500`}
                                   />
                                </div>
                             </div>
                           ));
                         })()}
                      </div>
                   </section>
                </div>

                <div className="grid gap-8 grid-cols-1 md:grid-cols-4">
                   {[
                     { label: 'Total Confessions', val: stats.totalConfessions || 0, trend: `+${stats.confessionsToday}`, icon: MessageSquare, color: 'sky' },
                     { label: 'Active Debates', val: stats.totalDebates || 0, trend: `+${stats.debatesToday}`, icon: Sword, color: 'amber' },
                     { label: 'Live Listeners', val: stats.onlineUsers, trend: 'Online', icon: Radio, color: 'pink' },
                     { label: 'Total Polls', val: stats.totalPolls || 0, trend: `+${stats.pollVotesToday}`, icon: Table, color: 'emerald' }
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
                           { id: 'disableShoutouts', label: 'Disable Shoutouts', icon: Megaphone, color: 'sky' },
                           { id: 'disableQnA', label: 'Disable Q&A Section', icon: HelpCircle, color: 'violet' }
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
                         <div className="space-y-6">
                          {announcementText.trim() && (
                            <div className="space-y-3">
                              <p className="text-[10px] font-black uppercase tracking-widest text-pink-500/60 ml-1">Live Preview</p>
                              <div className="relative overflow-hidden group">
                                <div className="absolute inset-0 bg-gradient-to-r from-pink-500/20 via-violet-500/20 to-pink-500/20 animate-gradient-x opacity-50 blur-xl" />
                                <div className="relative bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
                                  <div className="flex items-start gap-4">
                                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center text-white shrink-0 shadow-lg shadow-pink-500/20">
                                      <Megaphone size={18} />
                                    </div>
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-pink-400">System Broadcast</span>
                                        <span className="h-1 w-1 rounded-full bg-white/20" />
                                        <span className="text-[10px] font-bold text-white/40">Just now</span>
                                      </div>
                                      <p className="text-sm font-medium text-white/90 leading-relaxed max-w-sm">
                                        {announcementText}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="relative">
                             <textarea 
                                id="globalAnnouncementInput"
                                name="globalAnnouncementInput"
                                value={announcementText}
                                onChange={(e) => setAnnouncementText(e.target.value)}
                                placeholder="Type your global message here..."
                                className="w-full h-32 bg-black/40 border border-white/5 rounded-[2rem] p-6 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-pink-500/50 transition-all resize-none"
                             />
                             <div className="absolute bottom-6 right-6 flex gap-2">
                                <button 
                                  onClick={() => broadcastAnnouncement()}
                                  disabled={!announcementText.trim() || isBroadcasting}
                                  className="h-10 px-6 rounded-xl bg-pink-500 text-xs font-black uppercase tracking-widest text-white hover:bg-pink-600 transition shadow-lg shadow-pink-500/20 disabled:opacity-50 disabled:cursor-not-allowed group"
                                >
                                   {isBroadcasting ? (
                                     <RefreshCw size={14} className="animate-spin" />
                                   ) : (
                                     <span className="group-hover:scale-105 transition-transform inline-block">Broadcast</span>
                                   )}
                                </button>
                             </div>
                          </div>
                          
                          <div className="flex items-center gap-4 p-4 rounded-3xl bg-amber-500/5 border border-amber-500/10">
                             <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                             <p className="text-[10px] font-bold text-amber-500/80 uppercase leading-relaxed tracking-wider">
                                Announcements are sent in real-time to all connected clients as premium system notifications.
                             </p>
                          </div>

                          {activeAnnouncements.length > 0 && (
                            <div className="space-y-4 pt-4 border-t border-white/5">
                              <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1">Manage Active Broadcasts</h4>
                              <div className="space-y-3">
                                {activeAnnouncements.map((ann) => (
                                  <div key={ann.id} className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.02] border border-white/5 group">
                                    <div className="flex items-start gap-3 min-w-0">
                                      <div className="h-8 w-8 rounded-lg bg-pink-500/10 flex items-center justify-center text-pink-500 shrink-0">
                                        <Megaphone size={14} />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-xs text-white/80 line-clamp-1">{ann.message}</p>
                                        <p className="text-[9px] text-slate-500 mt-0.5 font-bold uppercase tracking-widest">
                                          {ann.created_at?.toDate ? ann.created_at.toDate().toLocaleString() : 'Just now'}
                                        </p>
                                      </div>
                                    </div>
                                    <button 
                                      onClick={() => deleteAnnouncement(ann.id)}
                                      className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 hover:text-white hover:bg-red-500/20 hover:border-red-500/30 transition opacity-0 group-hover:opacity-100"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
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
                        id="nuclearConfirmationInput"
                        name="nuclearConfirmationInput"
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
