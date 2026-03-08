import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Message {
  id: string;
  message_text: string;
  created_at: string;
  user_id: string;
  anonymous_username?: string;
}

const REACTIONS = ["🔥", "👀", "🤫", "💀", "❤️"];

const ChatRoom = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [roomName, setRoomName] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!roomId) return;

    // Fetch room info
    supabase.from("chat_rooms").select("room_name").eq("id", roomId).single()
      .then(({ data }) => { if (data) setRoomName(data.room_name); });

    // Fetch messages with usernames
    const fetchMessages = async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, message_text, created_at, user_id")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true });

      if (data) {
        // Fetch usernames for all unique user_ids
        const userIds = [...new Set(data.map((m) => m.user_id))];
        const { data: users } = await supabase
          .from("users")
          .select("id, anonymous_username")
          .in("id", userIds);

        const userMap = new Map(users?.map((u) => [u.id, u.anonymous_username]) || []);
        setMessages(
          data.map((m) => ({ ...m, anonymous_username: userMap.get(m.user_id) || "Unknown" }))
        );
      }
    };

    fetchMessages();

    // Realtime subscription
    const channel = supabase
      .channel(`room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const msg = payload.new as Message;
          const { data: userData } = await supabase
            .from("users")
            .select("anonymous_username")
            .eq("id", msg.user_id)
            .single();
          setMessages((prev) => [
            ...prev,
            { ...msg, anonymous_username: userData?.anonymous_username || "Unknown" },
          ]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !user || !roomId) return;
    const text = newMessage.trim();
    setNewMessage("");
    await supabase.from("messages").insert({
      message_text: text,
      user_id: user.id,
      room_id: roomId,
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border glass sticky top-0 z-50">
        <div className="max-w-4xl mx-auto flex items-center gap-4 px-4 py-3">
          <Link to="/dashboard">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="font-semibold">{roomName}</h1>
            <p className="text-xs text-muted-foreground">{messages.length} messages</p>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-4xl mx-auto w-full">
        <AnimatePresence initial={false}>
          {messages.map((msg) => {
            const isMe = msg.user_id === user?.id;
            return (
              <motion.div
                key={msg.id}
                className={`flex mb-3 ${isMe ? "justify-end" : "justify-start"}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                    isMe
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "glass rounded-bl-md"
                  }`}
                >
                  {!isMe && (
                    <p className="text-xs text-primary font-medium mb-1">
                      {msg.anonymous_username}
                    </p>
                  )}
                  <p className="text-sm leading-relaxed">{msg.message_text}</p>
                  <p className={`text-[10px] mt-1 ${isMe ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border glass">
        <div className="max-w-4xl mx-auto flex items-center gap-3 px-4 py-3">
          <Input
            placeholder="Type a message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            className="bg-muted border-border flex-1"
          />
          <Button
            onClick={sendMessage}
            size="icon"
            className="bg-primary text-primary-foreground glow-primary hover:brightness-110 shrink-0"
            disabled={!newMessage.trim()}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatRoom;
