import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

interface UnreadCounts {
  [roomId: string]: number;
}

interface NotificationContextType {
  unreadCounts: UnreadCounts;
  clearUnread: (roomId: string) => void;
  markAsActive: (roomId: string | null) => void;
}

const NotificationContext = createContext<NotificationContextType>({
  unreadCounts: {},
  clearUnread: () => {},
  markAsActive: () => {},
});

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [unreadCounts, setUnreadCounts] = useState<UnreadCounts>(() => {
    const saved = localStorage.getItem('unread_counts');
    return saved ? JSON.parse(saved) : {};
  });
  const activeRoomIdRef = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem('unread_counts', JSON.stringify(unreadCounts));
  }, [unreadCounts]);

  useEffect(() => {
    if (!user) return;

    // Global listener for new messages
    const channel = supabase.channel('global-messages')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages' 
      }, (payload) => {
        const newMessage = payload.new;
        const roomId = newMessage.room_id;

        // Don't count or notify if user is in the room OR it's their own message
        if (roomId === activeRoomIdRef.current || newMessage.user_id === user.id) {
          return;
        }

        setUnreadCounts(prev => ({
          ...prev,
          [roomId]: (prev[roomId] || 0) + 1
        }));

        // Show toast notification
        toast.message(`New message in ${roomId}`, {
          description: newMessage.content.substring(0, 50) + (newMessage.content.length > 50 ? '...' : ''),
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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
    <NotificationContext.Provider value={{ unreadCounts, clearUnread, markAsActive }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => useContext(NotificationContext);
