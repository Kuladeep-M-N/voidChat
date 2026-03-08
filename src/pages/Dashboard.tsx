import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, MessageCircle, Flame, BarChart3, LogOut, Ghost, Mic } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

interface ChatRoom {
  id: string;
  room_name: string;
  created_at: string;
}

const Dashboard = () => {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [newRoomName, setNewRoomName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [user, loading, navigate]);

  useEffect(() => {
    fetchRooms();
  }, []);

  const fetchRooms = async () => {
    const { data } = await supabase
      .from("chat_rooms")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setRooms(data);
  };

  const createRoom = async () => {
    if (!newRoomName.trim() || !user) return;
    const { error } = await supabase.from("chat_rooms").insert({
      room_name: newRoomName.trim(),
      created_by: user.id,
    });
    if (error) {
      toast.error("Failed to create room");
    } else {
      toast.success("Room created!");
      setNewRoomName("");
      setCreateOpen(false);
      fetchRooms();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border glass sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <span className="text-xl font-bold text-primary text-glow-primary">WHISPR</span>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <Ghost className="w-4 h-4 text-primary" />
              {profile?.anonymous_username || "Anonymous"}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground hover:text-foreground">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Welcome */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-3xl font-bold mb-1">
            Welcome, <span className="text-primary">{profile?.anonymous_username}</span>
          </h1>
          <p className="text-muted-foreground">Your identity is safe here.</p>
        </motion.div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10">
          <QuickAction
            icon={Flame}
            title="Confessions"
            desc="Share anonymous secrets"
            onClick={() => navigate("/confessions")}
            color="accent"
            delay={0.1}
          />
          <QuickAction
            icon={BarChart3}
            title="Polls"
            desc="Vote anonymously"
            onClick={() => navigate("/polls")}
            color="secondary"
            delay={0.2}
          />
          <QuickAction
            icon={Mic}
            title="Voice Rooms"
            desc="Talk live with others"
            onClick={() => navigate("/voice")}
            color="primary"
            delay={0.25}
          />
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <motion.button
                className="glass rounded-xl p-6 text-left hover:neon-border transition-all duration-300 cursor-pointer"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <Plus className="w-8 h-8 text-primary mb-3" />
                <h3 className="font-semibold text-lg mb-1">Create Room</h3>
                <p className="text-sm text-muted-foreground">Start a new chat room</p>
              </motion.button>
            </DialogTrigger>
            <DialogContent className="glass border-border">
              <DialogHeader>
                <DialogTitle>Create Chat Room</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <Input
                  placeholder="Room name..."
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  className="bg-muted border-border"
                  onKeyDown={(e) => e.key === "Enter" && createRoom()}
                />
                <Button
                  onClick={createRoom}
                  className="w-full bg-primary text-primary-foreground glow-primary"
                >
                  Create Room
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Chat Rooms */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary" /> Chat Rooms
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((room, i) => (
            <motion.div
              key={room.id}
              className="glass rounded-xl p-5 cursor-pointer hover:neon-border transition-all duration-300"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => navigate(`/chat/${room.id}`)}
            >
              <h3 className="font-semibold text-lg mb-1">{room.room_name}</h3>
              <p className="text-xs text-muted-foreground">
                {new Date(room.created_at).toLocaleDateString()}
              </p>
            </motion.div>
          ))}
          {rooms.length === 0 && (
            <p className="text-muted-foreground col-span-full text-center py-12">
              No rooms yet. Create the first one!
            </p>
          )}
        </div>
      </main>
    </div>
  );
};

const QuickAction = ({
  icon: Icon,
  title,
  desc,
  onClick,
  color,
  delay,
}: {
  icon: any;
  title: string;
  desc: string;
  onClick: () => void;
  color: string;
  delay: number;
}) => (
  <motion.button
    className="glass rounded-xl p-6 text-left hover:neon-border transition-all duration-300 cursor-pointer"
    onClick={onClick}
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
  >
    <Icon className={`w-8 h-8 text-${color} mb-3`} />
    <h3 className="font-semibold text-lg mb-1">{title}</h3>
    <p className="text-sm text-muted-foreground">{desc}</p>
  </motion.button>
);

export default Dashboard;
