-- ============================================================
-- VoidChat Production Cleanup Script
-- Run this in: https://supabase.com/dashboard/project/igmlyvkqkglzuzyzvbba/sql/new
-- ============================================================

-- TRUNCATE all public tables
-- Note: CASCADE will handle foreign key dependencies
TRUNCATE TABLE 
    public.qna_answers, 
    public.qna_questions, 
    public.poll_votes, 
    public.polls, 
    public.shoutouts, 
    public.confession_comments, 
    public.confessions, 
    public.messages, 
    public.voice_rooms, 
    public.users,
    public.chat_rooms
CASCADE;

-- Optional: Delete all users from auth.users (TREAD CAREFULLY)
-- This will log everyone out and require everyone to sign up again.
-- DELETE FROM auth.users;

-- Re-seed default chat rooms (if they were truncated)
INSERT INTO public.chat_rooms (name) VALUES
  ('general'), ('gaming'), ('music'), ('random')
ON CONFLICT (name) DO NOTHING;
