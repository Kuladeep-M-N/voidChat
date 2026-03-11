ALTER TABLE public.polls
ADD COLUMN IF NOT EXISTS tag TEXT NOT NULL DEFAULT 'random',
ADD COLUMN IF NOT EXISTS closed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.poll_votes
ADD COLUMN IF NOT EXISTS option_index INTEGER,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'poll_votes'
      AND column_name = 'selected_option'
  ) THEN
    EXECUTE $sql$
      UPDATE public.poll_votes pv
      SET option_index = GREATEST(COALESCE(array_position(p.options, pv.selected_option), 1) - 1, 0)
      FROM public.polls p
      WHERE pv.poll_id = p.id
        AND pv.option_index IS NULL
        AND pv.selected_option IS NOT NULL
    $sql$;
  END IF;
END
$$;

UPDATE public.poll_votes
SET option_index = 0
WHERE option_index IS NULL;

ALTER TABLE public.poll_votes
ALTER COLUMN option_index SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'poll_votes_option_index_non_negative'
  ) THEN
    ALTER TABLE public.poll_votes
    ADD CONSTRAINT poll_votes_option_index_non_negative CHECK (option_index >= 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_polls_created_at ON public.polls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_polls_tag ON public.polls (tag);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_id ON public.poll_votes (poll_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_user_id ON public.poll_votes (user_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_created_at ON public.poll_votes (created_at DESC);

DROP POLICY IF EXISTS "Authenticated users can update polls" ON public.polls;
DROP POLICY IF EXISTS "Authenticated users can delete polls" ON public.polls;
DROP POLICY IF EXISTS "Authenticated users can update votes" ON public.poll_votes;
DROP POLICY IF EXISTS "Authenticated users can delete votes" ON public.poll_votes;

CREATE POLICY "Authenticated users can update polls"
  ON public.polls FOR UPDATE TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Authenticated users can delete polls"
  ON public.polls FOR DELETE TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Authenticated users can update votes"
  ON public.poll_votes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can delete votes"
  ON public.poll_votes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'polls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.polls;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'poll_votes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_votes;
  END IF;
END
$$;
