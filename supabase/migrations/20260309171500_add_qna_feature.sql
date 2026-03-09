CREATE TABLE IF NOT EXISTS public.qna_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 5 AND 120),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 10 AND 1000),
  tag TEXT NOT NULL DEFAULT 'general',
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  upvotes INTEGER NOT NULL DEFAULT 0 CHECK (upvotes >= 0),
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.qna_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.qna_questions(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 2 AND 1200),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  upvotes INTEGER NOT NULL DEFAULT 0 CHECK (upvotes >= 0),
  is_accepted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qna_questions_created_at ON public.qna_questions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qna_questions_tag ON public.qna_questions (tag);
CREATE INDEX IF NOT EXISTS idx_qna_questions_user_id ON public.qna_questions (user_id);
CREATE INDEX IF NOT EXISTS idx_qna_answers_question_id ON public.qna_answers (question_id);
CREATE INDEX IF NOT EXISTS idx_qna_answers_user_id ON public.qna_answers (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qna_answers_one_accepted_per_question
  ON public.qna_answers (question_id) WHERE is_accepted = true;

ALTER TABLE public.qna_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qna_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qna_questions_select" ON public.qna_questions;
DROP POLICY IF EXISTS "qna_questions_insert" ON public.qna_questions;
DROP POLICY IF EXISTS "qna_questions_update" ON public.qna_questions;
DROP POLICY IF EXISTS "qna_questions_delete" ON public.qna_questions;

CREATE POLICY "qna_questions_select"
  ON public.qna_questions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "qna_questions_insert"
  ON public.qna_questions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "qna_questions_update"
  ON public.qna_questions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "qna_questions_delete"
  ON public.qna_questions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "qna_answers_select" ON public.qna_answers;
DROP POLICY IF EXISTS "qna_answers_insert" ON public.qna_answers;
DROP POLICY IF EXISTS "qna_answers_update" ON public.qna_answers;
DROP POLICY IF EXISTS "qna_answers_delete" ON public.qna_answers;

CREATE POLICY "qna_answers_select"
  ON public.qna_answers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "qna_answers_insert"
  ON public.qna_answers FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "qna_answers_update"
  ON public.qna_answers FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.qna_questions q
      WHERE q.id = qna_answers.question_id
        AND q.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.qna_questions q
      WHERE q.id = qna_answers.question_id
        AND q.user_id = auth.uid()
    )
  );

CREATE POLICY "qna_answers_delete"
  ON public.qna_answers FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.qna_questions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.qna_answers;

