import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, BarChart3, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

interface Poll {
  id: string;
  question: string;
  created_at: string;
  options: string[];
}

const Polls = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [polls, setPolls] = useState<Poll[]>([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [votes, setVotes] = useState<Record<string, Record<string, number>>>({});
  const [voted, setVoted] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [user, loading, navigate]);

  useEffect(() => {
    fetchPolls();
  }, []);

  const fetchPolls = async () => {
    const { data } = await supabase
      .from("polls")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setPolls(data);
  };

  const createPoll = async () => {
    const validOptions = options.filter((o) => o.trim());
    if (!newQuestion.trim() || validOptions.length < 2 || !user) return;

    const { error } = await supabase.from("polls").insert({
      question: newQuestion.trim(),
      created_by: user.id,
      options: validOptions,
    });

    if (error) toast.error("Failed to create poll");
    else {
      toast.success("Poll created!");
      setNewQuestion("");
      setOptions(["", ""]);
      setCreateOpen(false);
      fetchPolls();
    }
  };

  const vote = (pollId: string, option: string) => {
    if (voted.has(pollId)) return;
    setVoted((prev) => new Set(prev).add(pollId));
    setVotes((prev) => ({
      ...prev,
      [pollId]: {
        ...prev[pollId],
        [option]: (prev[pollId]?.[option] || 0) + 1,
      },
    }));
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass sticky top-0 z-50">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-secondary" />
              <h1 className="font-semibold">Polls</h1>
            </div>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-secondary text-secondary-foreground glow-secondary">
                <Plus className="w-4 h-4 mr-1" /> New Poll
              </Button>
            </DialogTrigger>
            <DialogContent className="glass border-border">
              <DialogHeader>
                <DialogTitle>Create Poll</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <Input
                  placeholder="Your question..."
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  className="bg-muted border-border"
                />
                {options.map((opt, i) => (
                  <Input
                    key={i}
                    placeholder={`Option ${i + 1}`}
                    value={opt}
                    onChange={(e) => {
                      const newOpts = [...options];
                      newOpts[i] = e.target.value;
                      setOptions(newOpts);
                    }}
                    className="bg-muted border-border"
                  />
                ))}
                {options.length < 4 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOptions([...options, ""])}
                    className="text-muted-foreground"
                  >
                    + Add option
                  </Button>
                )}
                <Button onClick={createPoll} className="w-full bg-secondary text-secondary-foreground glow-secondary">
                  Create Poll
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {polls.map((poll, i) => (
          <motion.div
            key={poll.id}
            className="glass rounded-xl p-5"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <h3 className="font-semibold text-lg mb-4">{poll.question}</h3>
            <div className="space-y-2">
              {poll.options?.map((option: string) => {
                const count = votes[poll.id]?.[option] || 0;
                const totalVotes = Object.values(votes[poll.id] || {}).reduce((a, b) => a + b, 0);
                const pct = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
                const hasVoted = voted.has(poll.id);

                return (
                  <button
                    key={option}
                    onClick={() => vote(poll.id, option)}
                    disabled={hasVoted}
                    className="w-full text-left relative rounded-lg overflow-hidden bg-muted p-3 transition-all hover:bg-muted/80 disabled:cursor-default"
                  >
                    {hasVoted && (
                      <div
                        className="absolute inset-0 bg-primary/10 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    )}
                    <span className="relative z-10 flex justify-between">
                      <span className="text-sm">{option}</span>
                      {hasVoted && (
                        <span className="text-xs text-muted-foreground">{Math.round(pct)}%</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {new Date(poll.created_at).toLocaleDateString()}
            </p>
          </motion.div>
        ))}

        {polls.length === 0 && (
          <p className="text-center text-muted-foreground py-12">
            No polls yet. Create the first one!
          </p>
        )}
      </main>
    </div>
  );
};

export default Polls;
