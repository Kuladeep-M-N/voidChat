import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const Signup = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    inviteCode: "",
    realName: "",
    anonUsername: "",
    email: "",
    password: "",
  });

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. Validate invite code
      const { data: codeData, error: codeError } = await supabase
        .from("invite_codes")
        .select("*")
        .eq("code", form.inviteCode)
        .eq("is_used", false)
        .single();

      if (codeError || !codeData) {
        toast.error("Invalid or already used invite code");
        setLoading(false);
        return;
      }

      // 2. Check username uniqueness
      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("anonymous_username", form.anonUsername)
        .single();

      if (existingUser) {
        toast.error("This anonymous username is already taken");
        setLoading(false);
        return;
      }

      // 3. Sign up with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
      });

      if (authError || !authData.user) {
        toast.error(authError?.message || "Failed to create account");
        setLoading(false);
        return;
      }

      // 4. Insert user profile
      const { error: userError } = await supabase.from("users").insert({
        id: authData.user.id,
        real_name: form.realName,
        anonymous_username: form.anonUsername,
        invite_code_used: form.inviteCode,
      });

      if (userError) {
        toast.error("Failed to create profile");
        setLoading(false);
        return;
      }

      // 5. Mark invite code as used
      await supabase
        .from("invite_codes")
        .update({ is_used: true, used_by: authData.user.id })
        .eq("id", codeData.id);

      toast.success("Welcome to WHISPR!");
      navigate("/dashboard");
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative">
      <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-primary/8 blur-[120px] pointer-events-none" />

      <motion.div
        className="w-full max-w-md glass rounded-2xl p-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="text-center mb-8">
          <Link to="/" className="text-2xl font-bold text-primary text-glow-primary">
            WHISPR
          </Link>
          <p className="text-sm text-muted-foreground mt-2">Join the anonymous community</p>
        </div>

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <Label htmlFor="inviteCode" className="text-muted-foreground">Invite Code</Label>
            <Input
              id="inviteCode"
              placeholder="Enter your invite code"
              value={form.inviteCode}
              onChange={(e) => setForm({ ...form, inviteCode: e.target.value })}
              required
              className="bg-muted border-border focus:border-primary"
            />
          </div>
          <div>
            <Label htmlFor="realName" className="text-muted-foreground">Real Name (private)</Label>
            <Input
              id="realName"
              placeholder="Your real name"
              value={form.realName}
              onChange={(e) => setForm({ ...form, realName: e.target.value })}
              required
              className="bg-muted border-border focus:border-primary"
            />
          </div>
          <div>
            <Label htmlFor="anonUsername" className="text-muted-foreground">Anonymous Username</Label>
            <Input
              id="anonUsername"
              placeholder="Choose your alias"
              value={form.anonUsername}
              onChange={(e) => setForm({ ...form, anonUsername: e.target.value })}
              required
              className="bg-muted border-border focus:border-primary"
            />
          </div>
          <div>
            <Label htmlFor="email" className="text-muted-foreground">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="your@email.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              className="bg-muted border-border focus:border-primary"
            />
          </div>
          <div>
            <Label htmlFor="password" className="text-muted-foreground">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={6}
              className="bg-muted border-border focus:border-primary"
            />
          </div>

          <Button
            type="submit"
            className="w-full bg-primary text-primary-foreground glow-primary hover:brightness-110"
            disabled={loading}
          >
            {loading ? "Creating account..." : "Join WHISPR"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline">Sign in</Link>
        </p>
      </motion.div>
    </div>
  );
};

export default Signup;
