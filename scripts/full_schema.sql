-- ============================================================
-- VoidChat Full Schema Migration
-- Run this in: https://supabase.com/dashboard/project/igmlyvkqkglzuzyzvbba/sql/new
-- ============================================================

-- 1. USERS table
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  anonymous_username TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_select" ON public.users;
DROP POLICY IF EXISTS "users_insert" ON public.users;
CREATE POLICY "users_select" ON public.users FOR SELECT USING (true);
CREATE POLICY "users_insert" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);

-- 2. CHAT ROOMS table
CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rooms_select" ON public.chat_rooms;
DROP POLICY IF EXISTS "rooms_insert" ON public.chat_rooms;
CREATE POLICY "rooms_select" ON public.chat_rooms FOR SELECT USING (true);
CREATE POLICY "rooms_insert" ON public.chat_rooms FOR INSERT WITH CHECK (true);

-- Seed default rooms
INSERT INTO public.chat_rooms (name) VALUES
  ('general'), ('memes'), ('gaming'), ('music'), ('random')
ON CONFLICT (name) DO NOTHING;

-- 3. MESSAGES table
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL CHECK (char_length(content) <= 2000),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_select" ON public.messages FOR SELECT USING (true);
CREATE POLICY "messages_insert" ON public.messages FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 4. CONFESSIONS table
CREATE TABLE IF NOT EXISTS public.confessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL CHECK (char_length(content) <= 500),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  likes INT DEFAULT 0 NOT NULL,
  category TEXT DEFAULT 'random' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.confessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "confessions_select" ON public.confessions;
DROP POLICY IF EXISTS "confessions_insert" ON public.confessions;
DROP POLICY IF EXISTS "confessions_update" ON public.confessions;
CREATE POLICY "confessions_select" ON public.confessions FOR SELECT USING (true);
CREATE POLICY "confessions_insert" ON public.confessions FOR INSERT WITH CHECK (true);
CREATE POLICY "confessions_update" ON public.confessions FOR UPDATE USING (true);

-- 5. CONFESSION COMMENTS table
CREATE TABLE IF NOT EXISTS public.confession_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confession_id UUID NOT NULL REFERENCES public.confessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.confession_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cc_select" ON public.confession_comments;
DROP POLICY IF EXISTS "cc_insert" ON public.confession_comments;
DROP POLICY IF EXISTS "cc_delete" ON public.confession_comments;
CREATE POLICY "cc_select" ON public.confession_comments FOR SELECT USING (true);
CREATE POLICY "cc_insert" ON public.confession_comments FOR INSERT WITH CHECK (true);
CREATE POLICY "cc_delete" ON public.confession_comments FOR DELETE USING (auth.uid() = user_id);

-- 6. POLLS table
CREATE TABLE IF NOT EXISTS public.polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_closed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "polls_select" ON public.polls;
DROP POLICY IF EXISTS "polls_insert" ON public.polls;
DROP POLICY IF EXISTS "polls_update" ON public.polls;
DROP POLICY IF EXISTS "polls_delete" ON public.polls;
CREATE POLICY "polls_select" ON public.polls FOR SELECT USING (true);
CREATE POLICY "polls_insert" ON public.polls FOR INSERT WITH CHECK (true);
CREATE POLICY "polls_update" ON public.polls FOR UPDATE USING (true);
CREATE POLICY "polls_delete" ON public.polls FOR DELETE USING (auth.uid() = created_by);

-- 7. POLL VOTES table
CREATE TABLE IF NOT EXISTS public.poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  option_index INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(poll_id, user_id)
);
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "votes_select" ON public.poll_votes;
DROP POLICY IF EXISTS "votes_insert" ON public.poll_votes;
CREATE POLICY "votes_select" ON public.poll_votes FOR SELECT USING (true);
CREATE POLICY "votes_insert" ON public.poll_votes FOR INSERT WITH CHECK (true);

-- 8. VOICE ROOMS table
CREATE TABLE IF NOT EXISTS public.voice_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.voice_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vrooms_select" ON public.voice_rooms;
DROP POLICY IF EXISTS "vrooms_insert" ON public.voice_rooms;
CREATE POLICY "vrooms_select" ON public.voice_rooms FOR SELECT USING (true);
CREATE POLICY "vrooms_insert" ON public.voice_rooms FOR INSERT WITH CHECK (true);

-- 9. SHOUTOUTS table
CREATE TABLE IF NOT EXISTS public.shoutouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_alias TEXT NOT NULL,
  from_alias TEXT NOT NULL,
  message TEXT NOT NULL CHECK (char_length(message) <= 300),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.shoutouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shoutouts_select" ON public.shoutouts;
DROP POLICY IF EXISTS "shoutouts_insert" ON public.shoutouts;
CREATE POLICY "shoutouts_select" ON public.shoutouts FOR SELECT USING (true);
CREATE POLICY "shoutouts_insert" ON public.shoutouts FOR INSERT WITH CHECK (true);

-- 10. Enable realtime on all tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.confessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.polls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_votes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shoutouts;
