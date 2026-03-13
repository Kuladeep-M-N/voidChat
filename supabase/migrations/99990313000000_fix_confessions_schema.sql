-- Migration: 99990313000000_fix_confessions_schema.sql
-- Description: Consolidates confessions schema, adds comments, and enables REPLICA IDENTITY FULL for real-time consistency.

-- 1. Ensure confessions table has all required columns
ALTER TABLE public.confessions 
ADD COLUMN IF NOT EXISTS content TEXT CHECK (char_length(content) <= 500),
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS likes INT DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'random' NOT NULL;

-- 2. Migrate data if necessary (if old column confession_text exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='confessions' AND column_name='confession_text') THEN
    UPDATE public.confessions SET content = confession_text WHERE content IS NULL;
    -- Optional: ALTER TABLE public.confessions DROP COLUMN confession_text;
  END IF;
END
$$;

-- 3. Create confession_comments table
CREATE TABLE IF NOT EXISTS public.confession_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confession_id UUID NOT NULL REFERENCES public.confessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. Enable RLS and Policies
ALTER TABLE public.confessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.confession_comments ENABLE ROW LEVEL SECURITY;

-- Confessions Policies
DROP POLICY IF EXISTS "confessions_select" ON public.confessions;
DROP POLICY IF EXISTS "confessions_insert" ON public.confessions;
DROP POLICY IF EXISTS "confessions_update" ON public.confessions;
DROP POLICY IF EXISTS "confessions_delete" ON public.confessions;

CREATE POLICY "confessions_select" ON public.confessions FOR SELECT USING (true);
CREATE POLICY "confessions_insert" ON public.confessions FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'authenticated');
CREATE POLICY "confessions_update" ON public.confessions FOR UPDATE USING (true); -- Allow likes/updates
CREATE POLICY "confessions_delete" ON public.confessions FOR DELETE USING (auth.uid() = user_id);

-- Comments Policies
DROP POLICY IF EXISTS "cc_select" ON public.confession_comments;
DROP POLICY IF EXISTS "cc_insert" ON public.confession_comments;
DROP POLICY IF EXISTS "cc_delete" ON public.confession_comments;

CREATE POLICY "cc_select" ON public.confession_comments FOR SELECT USING (true);
CREATE POLICY "cc_insert" ON public.confession_comments FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'authenticated');
CREATE POLICY "cc_delete" ON public.confession_comments FOR DELETE USING (auth.uid() = user_id);

-- 5. Real-time configuration
ALTER TABLE public.confessions REPLICA IDENTITY FULL;
ALTER TABLE public.confession_comments REPLICA IDENTITY FULL;

DO $$
BEGIN
  -- Add confessions if missing
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'confessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.confessions;
  END IF;

  -- Add comments if missing
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'confession_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.confession_comments;
  END IF;
END
$$;
