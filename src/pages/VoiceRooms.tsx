import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Plus, ArrowLeft, Users, Volume2, PhoneOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Room,
  RoomEvent,
  Track,
  LocalParticipant,
  RemoteParticipant,
  Participant,
} from "livekit-client";

interface VoiceRoom {
  id: string;
  room_name: string;
  created_by: string;
  active_users: string[];
  created_at: string;
}

const VoiceRooms = () => {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<VoiceRoom[]>([]);
  const [newRoomName, setNewRoomName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const [connecting, setConnecting] = useState(false);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [user, loading, navigate]);

  useEffect(() => {
    fetchRooms();

    const channel = supabase
      .channel("voice_rooms_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "voice_rooms" }, () => {
        fetchRooms();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
    };
  }, []);

  const fetchRooms = async () => {
    const { data } = await supabase
      .from("voice_rooms")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) {
      setRooms(data as VoiceRoom[]);
      const allUserIds = [...new Set(data.flatMap((r: VoiceRoom) => r.active_users))];
      if (allUserIds.length > 0) {
        const { data: users } = await supabase
          .from("users")
          .select("id, anonymous_username")
          .in("id", allUserIds);
        if (users) {
          const map: Record<string, string> = {};
          users.forEach((u) => { map[u.id] = u.anonymous_username; });
          setUsernames((prev) => ({ ...prev, ...map }));
        }
      }
    }
  };

  const createRoom = async () => {
    if (!newRoomName.trim() || !user) return;
    const { error } = await supabase.from("voice_rooms").insert({
      room_name: newRoomName.trim(),
      created_by: user.id,
    });
    if (error) {
      toast.error("Failed to create voice room");
    } else {
      toast.success("Voice room created!");
      setNewRoomName("");
      setCreateOpen(false);
    }
  };

  const updateParticipants = useCallback((room: Room) => {
    const allParticipants = new Map<string, Participant>();
    allParticipants.set(room.localParticipant.identity, room.localParticipant);
    room.remoteParticipants.forEach((p) => {
      allParticipants.set(p.identity, p);
    });
    setParticipants(new Map(allParticipants));
  }, []);

  const joinRoom = async (roomId: string) => {
    if (!user || !profile || connecting) return;

    // Leave current room first
    if (activeRoomId) {
      await leaveRoom();
    }

    setConnecting(true);
    const dbRoom = rooms.find((r) => r.id === roomId);
    if (!dbRoom) {
      setConnecting(false);
      return;
    }

    try {
      // Get LiveKit token from edge function
      const { data, error } = await supabase.functions.invoke("livekit-token", {
        body: {
          roomName: roomId,
          participantName: profile.anonymous_username,
          participantId: user.id,
        },
      });

      if (error || !data?.token) {
        throw new Error(error?.message || "Failed to get token");
      }

      // Create and connect to LiveKit room
      const livekitRoom = new Room();
      roomRef.current = livekitRoom;

      // Set up event listeners
      livekitRoom.on(RoomEvent.ParticipantConnected, () => updateParticipants(livekitRoom));
      livekitRoom.on(RoomEvent.ParticipantDisconnected, () => updateParticipants(livekitRoom));
      livekitRoom.on(RoomEvent.TrackSubscribed, () => updateParticipants(livekitRoom));
      livekitRoom.on(RoomEvent.TrackUnsubscribed, () => updateParticipants(livekitRoom));
      livekitRoom.on(RoomEvent.Disconnected, () => {
        setActiveRoomId(null);
        setParticipants(new Map());
        roomRef.current = null;
      });

      await livekitRoom.connect(data.url, data.token);
      await livekitRoom.localParticipant.setMicrophoneEnabled(true);

      updateParticipants(livekitRoom);
      setActiveRoomId(roomId);
      setMuted(false);

      // Update database with active user
      const updatedUsers = [...new Set([...dbRoom.active_users, user.id])];
      await supabase
        .from("voice_rooms")
        .update({ active_users: updatedUsers })
        .eq("id", roomId);

      toast.success(`Joined ${dbRoom.room_name}`);
    } catch (err: any) {
      console.error("Failed to join voice room:", err);
      toast.error(err.message || "Failed to join voice room");
    } finally {
      setConnecting(false);
    }
  };

  const leaveRoom = async () => {
    if (!user) return;

    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    if (activeRoomId) {
      const dbRoom = rooms.find((r) => r.id === activeRoomId);
      if (dbRoom) {
        const updatedUsers = dbRoom.active_users.filter((id) => id !== user.id);
        await supabase
          .from("voice_rooms")
          .update({ active_users: updatedUsers })
          .eq("id", activeRoomId);
      }
    }

    setActiveRoomId(null);
    setParticipants(new Map());
    toast("Left voice room");
  };

  const toggleMute = async () => {
    if (!roomRef.current) return;
    const newMuted = !muted;
    await roomRef.current.localParticipant.setMicrophoneEnabled(!newMuted);
    setMuted(newMuted);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const currentDbRoom = rooms.find((r) => r.id === activeRoomId);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <span className="text-xl font-bold text-primary text-glow-primary">Voice Rooms</span>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-primary text-primary-foreground glow-primary">
                <Plus className="w-4 h-4 mr-1" /> New Room
              </Button>
            </DialogTrigger>
            <DialogContent className="glass border-border">
              <DialogHeader>
                <DialogTitle>Create Voice Room</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <Input
                  placeholder="Room name..."
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  className="bg-muted border-border"
                  onKeyDown={(e) => e.key === "Enter" && createRoom()}
                />
                <Button onClick={createRoom} className="w-full bg-primary text-primary-foreground glow-primary">
                  Create Room
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Active Room Banner */}
        <AnimatePresence>
          {currentDbRoom && activeRoomId && (
            <motion.div
              className="mb-8 glass rounded-2xl p-6 neon-border"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-primary flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-accent animate-pulse" />
                    {currentDbRoom.room_name}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {participants.size} participant{participants.size !== 1 ? "s" : ""} connected
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleMute}
                    className={muted ? "text-destructive bg-destructive/10" : "text-primary bg-primary/10"}
                  >
                    {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={leaveRoom}
                    className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <PhoneOff className="w-4 h-4 mr-1" /> Leave
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {Array.from(participants.values()).map((participant) => {
                  const isLocal = participant instanceof LocalParticipant;
                  const isSpeaking = participant.isSpeaking;
                  const isMicMuted = !participant.isMicrophoneEnabled;
                  
                  return (
                    <div
                      key={participant.identity}
                      className={`flex items-center gap-2 glass rounded-full px-4 py-2 transition-all ${
                        isSpeaking ? "ring-2 ring-primary" : ""
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full ${isSpeaking ? "bg-primary animate-pulse" : "bg-accent"}`} />
                      <span className="text-sm font-medium">
                        {participant.name || "Anonymous"}
                        {isLocal && " (You)"}
                      </span>
                      {isMicMuted ? (
                        <MicOff className="w-3 h-3 text-destructive" />
                      ) : isSpeaking ? (
                        <Volume2 className="w-3 h-3 text-primary animate-pulse" />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Room List */}
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-primary" /> Available Rooms
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((room, i) => (
            <motion.div
              key={room.id}
              className={`glass rounded-xl p-5 transition-all duration-300 ${
                activeRoomId === room.id ? "neon-border" : "hover:neon-border cursor-pointer"
              } ${connecting ? "opacity-50 pointer-events-none" : ""}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => activeRoomId !== room.id && joinRoom(room.id)}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-lg">{room.room_name}</h3>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Users className="w-4 h-4" />
                  <span className="text-sm">{room.active_users.length}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {room.active_users.length > 0 ? (
                  <div className="flex -space-x-2">
                    {room.active_users.slice(0, 5).map((uid, idx) => (
                      <div
                        key={idx}
                        className="w-6 h-6 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center"
                      >
                        <span className="text-[10px] text-primary">👤</span>
                      </div>
                    ))}
                    {room.active_users.length > 5 && (
                      <div className="w-6 h-6 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                        <span className="text-[10px] text-muted-foreground">+{room.active_users.length - 5}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">Empty — be the first to join!</span>
                )}
              </div>
              {activeRoomId === room.id && (
                <p className="text-xs text-primary mt-2 font-medium">🎙️ Currently connected</p>
              )}
            </motion.div>
          ))}
          {rooms.length === 0 && (
            <p className="text-muted-foreground col-span-full text-center py-12">
              No voice rooms yet. Create the first one!
            </p>
          )}
        </div>
      </main>
    </div>
  );
};

export default VoiceRooms;
