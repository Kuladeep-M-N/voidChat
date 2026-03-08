import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trash2, Copy, Plus, Eye, EyeOff, Lock } from "lucide-react";

interface InviteCode {
  id: string;
  code: string;
  is_used: boolean;
  used_by: string | null;
  created_at: string;
}

const ADMIN_PASSWORD = "whispr2024"; // Simple password protection

const Admin = () => {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [codeCount, setCodeCount] = useState(1);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      setAuthenticated(true);
      toast.success("Admin access granted");
    } else {
      toast.error("Invalid password");
    }
  };

  const fetchCodes = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invite_codes")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch codes");
    } else {
      setCodes(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (authenticated) {
      fetchCodes();
    }
  }, [authenticated]);

  const generateCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const handleGenerateCodes = async () => {
    setGenerating(true);
    const newCodes = Array.from({ length: codeCount }, () => ({
      code: generateCode(),
    }));

    const { error } = await supabase.from("invite_codes").insert(newCodes);

    if (error) {
      toast.error("Failed to generate codes");
    } else {
      toast.success(`Generated ${codeCount} invite code(s)`);
      fetchCodes();
    }
    setGenerating(false);
  };

  const handleDeleteCode = async (id: string) => {
    const { error } = await supabase.from("invite_codes").delete().eq("id", id);

    if (error) {
      toast.error("Failed to delete code");
    } else {
      toast.success("Code deleted");
      setCodes(codes.filter((c) => c.id !== id));
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("Code copied to clipboard");
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <motion.div
          className="w-full max-w-sm glass rounded-2xl p-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="text-center mb-6">
            <Lock className="w-12 h-12 text-primary mx-auto mb-2" />
            <h1 className="text-xl font-bold text-foreground">Admin Access</h1>
            <p className="text-sm text-muted-foreground">Enter password to continue</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Admin password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-muted border-border pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button type="submit" className="w-full">
              Enter
            </Button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-3xl font-bold text-foreground mb-2">Invite Code Admin</h1>
          <p className="text-muted-foreground">Generate and manage invite codes</p>
        </motion.div>

        {/* Generate Section */}
        <motion.div
          className="glass rounded-xl p-6 mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <h2 className="text-lg font-semibold text-foreground mb-4">Generate New Codes</h2>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Label htmlFor="count" className="text-muted-foreground">
                Number of codes
              </Label>
              <Input
                id="count"
                type="number"
                min={1}
                max={50}
                value={codeCount}
                onChange={(e) => setCodeCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                className="bg-muted border-border"
              />
            </div>
            <Button onClick={handleGenerateCodes} disabled={generating}>
              <Plus className="w-4 h-4 mr-2" />
              {generating ? "Generating..." : "Generate"}
            </Button>
          </div>
        </motion.div>

        {/* Codes List */}
        <motion.div
          className="glass rounded-xl p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              All Codes ({codes.length})
            </h2>
            <div className="flex gap-2 text-sm">
              <span className="text-green-400">
                Available: {codes.filter((c) => !c.is_used).length}
              </span>
              <span className="text-muted-foreground">|</span>
              <span className="text-red-400">
                Used: {codes.filter((c) => c.is_used).length}
              </span>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : codes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No invite codes yet. Generate some above!
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {codes.map((code) => (
                <div
                  key={code.id}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    code.is_used ? "bg-muted/30" : "bg-muted/60"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <code
                      className={`font-mono text-lg ${
                        code.is_used ? "text-muted-foreground line-through" : "text-primary"
                      }`}
                    >
                      {code.code}
                    </code>
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        code.is_used
                          ? "bg-red-500/20 text-red-400"
                          : "bg-green-500/20 text-green-400"
                      }`}
                    >
                      {code.is_used ? "Used" : "Available"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {!code.is_used && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyCode(code.code)}
                        title="Copy code"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    )}
                    {!code.is_used && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteCode(code.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        title="Delete code"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default Admin;
