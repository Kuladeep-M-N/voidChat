
-- Users table
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  real_name TEXT NOT NULL,
  anonymous_username TEXT NOT NULL UNIQUE,
  invite_code_used TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read all profiles" ON public.users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);

-- Invite codes table
CREATE TABLE public.invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  used_by UUID REFERENCES auth.users(id),
  is_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can check invite codes" ON public.invite_codes FOR SELECT USING (true);
CREATE POLICY "Authenticated users can update invite codes" ON public.invite_codes FOR UPDATE TO authenticated USING (true);

-- Chat rooms table
CREATE TABLE public.chat_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read rooms" ON public.chat_rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can create rooms" ON public.chat_rooms FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

-- Messages table
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read messages" ON public.messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can send messages" ON public.messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Confessions table
CREATE TABLE public.confessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confession_text TEXT NOT NULL,
  room_id UUID REFERENCES public.chat_rooms(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.confessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read confessions" ON public.confessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can post confessions" ON public.confessions FOR INSERT TO authenticated WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.confessions;

-- Polls table
CREATE TABLE public.polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  room_id UUID REFERENCES public.chat_rooms(id),
  options TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read polls" ON public.polls FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can create polls" ON public.polls FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

-- Poll votes table
CREATE TABLE public.poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  selected_option TEXT NOT NULL,
  UNIQUE(poll_id, user_id)
);

ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read votes" ON public.poll_votes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can vote" ON public.poll_votes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Insert sample invite codes
INSERT INTO public.invite_codes (code) VALUES
  ('WHISPR2026'),
  ('SHADOW-ENTRY'),
  ('ANON-SQUAD'),
  ('CAMPUS-SECRET'),
  ('GHOST-MODE');
