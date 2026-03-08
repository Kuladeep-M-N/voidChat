import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Send, Flame } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface Confession {
  id: string;
  confession_text: string;
  created_at: string;
}

const REACTIONS = ["🔥", "👀", "🤫", "💀", "❤️"];

const Confessions = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [confessions, setConfessions] = useState<Confession[]>([]);
  const [newConfession, setNewConfession] = useState("");
  const [reactions, setReactions] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [user, loading, navigate]);

  useEffect(() => {
    fetchConfessions();

    const channel = supabase
      .channel("confessions")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "confessions" }, (payload) => {
        setConfessions((prev) => [payload.new as Confession, ...prev]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchConfessions = async () => {
    const { data } = await supabase
      .from("confessions")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setConfessions(data);
  };

  const submitConfession = async () => {
    if (!newConfession.trim()) return;
    const { error } = await supabase.from("confessions").insert({
      confession_text: newConfession.trim(),
    });
    if (error) toast.error("Failed to post");
    else {
      setNewConfession("");
      toast.success("Confession posted anonymously");
    }
  };

  const react = (confessionId: string, emoji: string) => {
    setReactions((prev) => ({
      ...prev,
      [confessionId]: {
        ...prev[confessionId],
        [emoji]: (prev[confessionId]?.[emoji] || 0) + 1,
      },
    }));
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass sticky top-0 z-50">
        <div className="max-w-3xl mx-auto flex items-center gap-4 px-4 py-3">
          <Link to="/dashboard">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-accent" />
            <h1 className="font-semibold">Confessions</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Submit */}
        <motion.div
          className="glass rounded-xl p-5 mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Textarea
            placeholder="Share your anonymous confession..."
            value={newConfession}
            onChange={(e) => setNewConfession(e.target.value)}
            className="bg-muted border-border mb-3 min-h-[80px] resize-none"
          />
          <Button
            onClick={submitConfession}
            className="bg-accent text-accent-foreground glow-accent hover:brightness-110"
            disabled={!newConfession.trim()}
          >
            <Send className="w-4 h-4 mr-2" /> Post Anonymously
          </Button>
        </motion.div>

        {/* Feed */}
        <AnimatePresence>
          {confessions.map((c, i) => (
            <motion.div
              key={c.id}
              className="glass rounded-xl p-5 mb-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <p className="text-foreground leading-relaxed mb-3">{c.confession_text}</p>
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5">
                  {REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => react(c.id, emoji)}
                      className="px-2.5 py-1 rounded-full bg-muted hover:bg-muted/80 text-sm transition-all hover:scale-110"
                    >
                      {emoji}
                      {reactions[c.id]?.[emoji] ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {reactions[c.id][emoji]}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {confessions.length === 0 && (
          <p className="text-center text-muted-foreground py-12">
            No confessions yet. Be the first to share.
          </p>
        )}
      </main>
    </div>
  );
};

export default Confessions;
