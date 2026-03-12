import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
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

  useEffect(() => {
    if (!user) return;

    const presenceChannel = supabase.channel('global-presence');
    
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const uniqueUsers = new Set(Object.values(state).flat().map((p: any) => p.user_id));
        setOnlineCount(uniqueUsers.size || 1);
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        console.log('join', key, newPresences);
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        console.log('leave', key, leftPresences);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            user_id: user.id,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(presenceChannel);
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
