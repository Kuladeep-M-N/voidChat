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

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AnimatedBackground />
        <div className="relative" style={{ zIndex: 1 }}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/join" element={<PublicRoute><Join /></PublicRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/room/:id" element={<ProtectedRoute><ChatRoom /></ProtectedRoute>} />
            <Route path="/confessions" element={<ProtectedRoute><Confessions /></ProtectedRoute>} />
            <Route path="/polls" element={<ProtectedRoute><Polls /></ProtectedRoute>} />
            <Route path="/qna" element={<ProtectedRoute><QnA /></ProtectedRoute>} />
            <Route path="/voice" element={<ProtectedRoute><VoiceRooms /></ProtectedRoute>} />
            <Route path="/shoutouts" element={<ProtectedRoute><Shoutouts /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;

