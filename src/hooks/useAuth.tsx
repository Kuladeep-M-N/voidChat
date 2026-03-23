import { useState, useEffect, createContext, useContext } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

interface UserProfile {
  id: string;
  anonymous_username: string;
  joined_at: string;
  is_admin: boolean;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

const api = {
  post: async (endpoint: string, data?: any) => {
    const response = await fetch(`${apiBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
      credentials: 'include',
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Request failed with status ${response.status}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : { status: 'success' };
  }
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const checkSession = async (firebaseUser: User | null) => {
      if (firebaseUser) {
        try {
          // If we have a Firebase user, ensure we have a backend session
          // In a real app, we might check /auth/session here
          const profileRef = doc(db, 'users', firebaseUser.uid);
          
          unsubscribeProfile = onSnapshot(profileRef, (docSnap) => {
            if (docSnap.exists()) {
              setProfile({ id: docSnap.id, ...docSnap.data() } as UserProfile);
            }
            setLoading(false);
          });
        } catch (err) {
          console.error("Session check error:", err);
          setLoading(false);
        }
      } else {
        setProfile(null);
        setLoading(false);
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      checkSession(firebaseUser);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  const signOut = async () => {
    try {
      // Always clear firebase and local state, but also try to inform backend
      await Promise.allSettled([
        api.post('/auth/logout'),
        firebaseSignOut(auth)
      ]);
      setUser(null);
      setProfile(null);
    } catch (err) {
      console.error("Sign out error:", err);
      // Even if everything fails, force clear local state to get user out of the dashboard
      setUser(null);
      setProfile(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
