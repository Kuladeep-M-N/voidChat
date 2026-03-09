-- Run in Supabase SQL Editor to add new feature tables
-- Only adds new tables, does NOT drop existing ones

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
CREATE POLICY "confessions_select" ON public.confessions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "confessions_insert" ON public.confessions FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "confessions_update" ON public.confessions FOR UPDATE USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS public.polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "polls_select" ON public.polls;
DROP POLICY IF EXISTS "polls_insert" ON public.polls;
CREATE POLICY "polls_select" ON public.polls FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "polls_insert" ON public.polls FOR INSERT WITH CHECK (auth.role() = 'authenticated');

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
CREATE POLICY "votes_select" ON public.poll_votes FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "votes_insert" ON public.poll_votes FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS public.voice_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.voice_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vrooms_select" ON public.voice_rooms;
DROP POLICY IF EXISTS "vrooms_insert" ON public.voice_rooms;
CREATE POLICY "vrooms_select" ON public.voice_rooms FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "vrooms_insert" ON public.voice_rooms FOR INSERT WITH CHECK (auth.role() = 'authenticated');

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
CREATE POLICY "shoutouts_select" ON public.shoutouts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shoutouts_insert" ON public.shoutouts FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Enable realtime on new tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.confessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.polls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_votes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shoutouts;

CREATE TABLE IF NOT EXISTS public.qna_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 5 AND 120),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 10 AND 1000),
  tag TEXT NOT NULL DEFAULT 'general',
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  upvotes INT NOT NULL DEFAULT 0,
  views INT NOT NULL DEFAULT 0,
  is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.qna_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "qna_questions_select" ON public.qna_questions;
DROP POLICY IF EXISTS "qna_questions_insert" ON public.qna_questions;
DROP POLICY IF EXISTS "qna_questions_update" ON public.qna_questions;
DROP POLICY IF EXISTS "qna_questions_delete" ON public.qna_questions;
CREATE POLICY "qna_questions_select" ON public.qna_questions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "qna_questions_insert" ON public.qna_questions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "qna_questions_update" ON public.qna_questions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "qna_questions_delete" ON public.qna_questions FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.qna_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.qna_questions(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 2 AND 1200),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  upvotes INT NOT NULL DEFAULT 0,
  is_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.qna_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "qna_answers_select" ON public.qna_answers;
DROP POLICY IF EXISTS "qna_answers_insert" ON public.qna_answers;
DROP POLICY IF EXISTS "qna_answers_update" ON public.qna_answers;
DROP POLICY IF EXISTS "qna_answers_delete" ON public.qna_answers;
CREATE POLICY "qna_answers_select" ON public.qna_answers FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "qna_answers_insert" ON public.qna_answers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "qna_answers_update" ON public.qna_answers FOR UPDATE USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.qna_questions q
    WHERE q.id = qna_answers.question_id
      AND q.user_id = auth.uid()
  )
);
CREATE POLICY "qna_answers_delete" ON public.qna_answers FOR DELETE USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.qna_questions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.qna_answers;
