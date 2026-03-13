-- Migration: 20260313190000_add_admin_system.sql
-- Description: Adds is_admin column to users and updates RLS policies for admin overrides.

-- 1. Add is_admin column to users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- 1.1 Add is_archived to chat_rooms
ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

-- 2. Update Confessions policies for admin
DROP POLICY IF EXISTS "confessions_admin_delete" ON public.confessions;
CREATE POLICY "confessions_admin_delete" ON public.confessions 
FOR DELETE USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));

-- Update existing delete policy to be clear (already exists as "confessions_delete" usually)
-- But we can just add an OR condition to the existing one if we want.
-- In Supabase, multiple policies are ORed. So adding a new DELETE policy for admins is cleaner.

-- 3. Update Confession Comments policies for admin
DROP POLICY IF EXISTS "cc_admin_delete" ON public.confession_comments;
CREATE POLICY "cc_admin_delete" ON public.confession_comments 
FOR DELETE USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));

-- 4. Update Polls policies for admin
DROP POLICY IF EXISTS "polls_admin_delete" ON public.polls;
CREATE POLICY "polls_admin_delete" ON public.polls 
FOR DELETE USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "polls_admin_update" ON public.polls;
CREATE POLICY "polls_admin_update" ON public.polls 
FOR UPDATE USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));

-- 5. Update QnA policies for admin
DROP POLICY IF EXISTS "qna_questions_admin_delete" ON public.qna_questions;
CREATE POLICY "qna_questions_admin_delete" ON public.qna_questions 
FOR DELETE USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "qna_answers_admin_delete" ON public.qna_answers;
CREATE POLICY "qna_answers_admin_delete" ON public.qna_answers 
FOR DELETE USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));

-- 6. Update Shoutouts policies for admin
DROP POLICY IF EXISTS "shoutouts_admin_delete" ON public.shoutouts;
CREATE POLICY "shoutouts_admin_delete" ON public.shoutouts 
FOR DELETE USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));

-- 7. Update Chat Rooms policies for admin
DROP POLICY IF EXISTS "rooms_admin_delete" ON public.chat_rooms;
CREATE POLICY "rooms_admin_delete" ON public.chat_rooms 
FOR DELETE USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "rooms_admin_update" ON public.chat_rooms;
CREATE POLICY "rooms_admin_update" ON public.chat_rooms 
FOR UPDATE USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));

-- 8. Update Voice Rooms policies for admin
DROP POLICY IF EXISTS "vrooms_admin_delete" ON public.voice_rooms;
CREATE POLICY "vrooms_admin_delete" ON public.voice_rooms 
FOR DELETE USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));
