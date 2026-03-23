import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import AnimatedBackground from './components/AnimatedBackground';
import Landing from './pages/Landing';
import Join from './pages/Join';
import Dashboard from './pages/Dashboard';
import ChatRoom from './pages/ChatRoom';
import Confessions from './pages/Confessions';
import Polls from './pages/Polls';
import VoiceRooms from './pages/VoiceRooms';
import Shoutouts from './pages/Shoutouts';
import QnA from './pages/QnA';
import AdminModeration from './pages/AdminModeration';
import ChatCenter from './pages/ChatCenter';
import DebateArena from './pages/DebateArena';
import DebateThread from './pages/DebateThread';
import Whisper from './pages/Whisper';


const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return user ? <>{children}</> : <Navigate to="/join" replace />;
};

const PublicRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return !user ? <>{children}</> : <Navigate to="/dashboard" replace />;
};

const GlobalVoice = () => {
  const { user, loading } = useAuth();
  if (loading || !user) return null;
  return <VoiceRooms />;
};

import { Toaster } from 'sonner';
import { NotificationProvider } from './hooks/useNotifications';
import { SystemConfigProvider } from './hooks/useSystemConfig';
import SafeModeBanner from './components/SafeModeBanner';
import GlobalAnnouncement from './components/GlobalAnnouncement';

function App() {
  return (
    <AuthProvider>
      <SystemConfigProvider>
        <NotificationProvider>
          <BrowserRouter>
          <AnimatedBackground />
          <Toaster position="top-right" richColors />
          <SafeModeBanner />
          <GlobalAnnouncement />
          <div className="relative" style={{ zIndex: 1 }}>
          <GlobalVoice />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/join" element={<PublicRoute><Join /></PublicRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/room/:id" element={<ProtectedRoute><ChatRoom /></ProtectedRoute>} />
            <Route path="/confessions" element={<ProtectedRoute><Confessions /></ProtectedRoute>} />
            <Route path="/polls" element={<ProtectedRoute><Polls /></ProtectedRoute>} />
            <Route path="/qna" element={<ProtectedRoute><QnA /></ProtectedRoute>} />
            <Route path="/voice" element={<ProtectedRoute><div className="h-0 overflow-hidden" /></ProtectedRoute>} />
            <Route path="/shoutouts" element={<ProtectedRoute><Shoutouts /></ProtectedRoute>} />
            <Route path="/chat-center" element={<ProtectedRoute><ChatCenter /></ProtectedRoute>} />
            <Route path="/debate-arena" element={<ProtectedRoute><DebateArena /></ProtectedRoute>} />
            <Route path="/debate-arena/:id" element={<ProtectedRoute><DebateThread /></ProtectedRoute>} />
            <Route path="/whisper/*" element={<ProtectedRoute><Whisper /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><AdminModeration /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        </BrowserRouter>
      </NotificationProvider>
     </SystemConfigProvider>
   </AuthProvider>
);
}

export default App;

