-- Enable Realtime for confession_comments and ensure full replica identity
ALTER TABLE public.confessions REPLICA IDENTITY FULL;
ALTER TABLE public.confession_comments REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'confession_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.confession_comments;
  END IF;
END
$$;
