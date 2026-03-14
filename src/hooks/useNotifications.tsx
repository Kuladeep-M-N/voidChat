import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  limit, 
  orderBy, 
  where 
} from 'firebase/firestore';
import { 
  ref, 
  onValue, 
  set, 
  onDisconnect 
} from 'firebase/database';
import { db, rtdb } from '../lib/firebase';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

interface UnreadCounts {
  [roomId: string]: number;
}

interface NotificationContextType {
  unreadCounts: UnreadCounts;
  onlineCount: number;
  clearUnread: (roomId: string) => void;
  markAsActive: (roomId: string | null) => void;
}

const NotificationContext = createContext<NotificationContextType>({
  unreadCounts: {},
  onlineCount: 1,
  clearUnread: () => {},
  markAsActive: () => {},
});

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [unreadCounts, setUnreadCounts] = useState<UnreadCounts>(() => {
    const saved = localStorage.getItem('unread_counts');
    return saved ? JSON.parse(saved) : {};
  });
  const [onlineCount, setOnlineCount] = useState(1);
  const activeRoomIdRef = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem('unread_counts', JSON.stringify(unreadCounts));
  }, [unreadCounts]);

  useEffect(() => {
    if (!user) return;

    // Global listener for new messages via Firestore
    // Note: This assumes a root "messages" collection for global notifications
    const q = query(collection(db, 'messages'), orderBy('created_at', 'desc'), limit(1));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const newMessage = change.doc.data();
          const roomId = newMessage.room_id;

          // Don't count or notify if user is in the room OR it's their own message
          if (roomId === activeRoomIdRef.current || newMessage.user_id === user.uid) {
            return;
          }

          setUnreadCounts(prev => ({
            ...prev,
            [roomId]: (prev[roomId] || 0) + 1
          }));

          // Show toast notification
          toast.message(`New message in room`, {
            description: newMessage.content.substring(0, 50) + (newMessage.content.length > 50 ? '...' : ''),
          });
        }
      });
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const presenceRef = ref(rtdb, 'presence/global/' + user.uid);
    const globalPresenceRef = ref(rtdb, 'presence/global');

    // Track own presence
    set(presenceRef, {
      user_id: user.uid,
      online_at: new Date().toISOString(),
    });
    onDisconnect(presenceRef).remove();

    // Listen to global presence
    const unsubscribe = onValue(globalPresenceRef, (snapshot) => {
      const data = snapshot.val() || {};
      setOnlineCount(Object.keys(data).length || 1);
    });

    return () => {
      set(presenceRef, null);
      unsubscribe();
    };
  }, [user]);

  const clearUnread = (roomId: string) => {
    setUnreadCounts(prev => {
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
  };

  const markAsActive = (roomId: string | null) => {
    activeRoomIdRef.current = roomId;
    if (roomId) clearUnread(roomId);
  };

  return (
    <NotificationContext.Provider value={{ unreadCounts, onlineCount, clearUnread, markAsActive }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => useContext(NotificationContext);
