-- Enable full replica identity for messages table to allow reliable real-time filtering
ALTER TABLE public.messages REPLICA IDENTITY FULL;

-- Ensure messages is in the realtime publication (though it usually is by default)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END
$$;
