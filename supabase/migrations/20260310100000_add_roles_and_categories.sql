-- Add roles and categories to voidChat
-- Migration: 20260310100000_add_roles_and_categories.sql

-- Add category and permissions to chat_rooms
ALTER TABLE public.chat_rooms
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general' CHECK (category IN ('general', 'gaming', 'confessions', 'music', 'qa', 'memes')),
ADD COLUMN IF NOT EXISTS only_admins_can_message BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;

-- Update existing rooms with categories
UPDATE public.chat_rooms SET category = 'general' WHERE room_name = 'general' OR name = 'general';
UPDATE public.chat_rooms SET category = 'gaming' WHERE room_name = 'gaming' OR name = 'gaming';
UPDATE public.chat_rooms SET category = 'memes' WHERE room_name = 'memes' OR name = 'memes';
UPDATE public.chat_rooms SET category = 'music' WHERE room_name = 'music' OR name = 'music';
UPDATE public.chat_rooms SET category = 'random' WHERE room_name = 'random' OR name = 'random';

-- Create room_members table for roles
CREATE TABLE IF NOT EXISTS public.room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('creator', 'admin', 'member', 'muted')),
  joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  muted_until TIMESTAMPTZ,
  UNIQUE(room_id, user_id)
);

-- Insert creators as room_members with creator role
INSERT INTO public.room_members (room_id, user_id, role, joined_at)
SELECT id, created_by, 'creator', created_at
FROM public.chat_rooms
WHERE created_by IS NOT NULL
ON CONFLICT (room_id, user_id) DO NOTHING;

-- Enable RLS on room_members
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;

-- Policies for room_members
DROP POLICY IF EXISTS "room_members_select" ON public.room_members;
DROP POLICY IF EXISTS "room_members_insert" ON public.room_members;
DROP POLICY IF EXISTS "room_members_update" ON public.room_members;
DROP POLICY IF EXISTS "room_members_delete" ON public.room_members;

CREATE POLICY "room_members_select" ON public.room_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "room_members_insert" ON public.room_members FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "room_members_update" ON public.room_members FOR UPDATE TO authenticated USING (
  -- Users can update their own membership, or admins/creators can update others
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM public.room_members rm
    WHERE rm.room_id = room_members.room_id
    AND rm.user_id = auth.uid()
    AND rm.role IN ('creator', 'admin')
  )
);
CREATE POLICY "room_members_delete" ON public.room_members FOR DELETE TO authenticated USING (
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM public.room_members rm
    WHERE rm.room_id = room_members.room_id
    AND rm.user_id = auth.uid()
    AND rm.role IN ('creator', 'admin')
  )
);

-- Update messages policy to respect permissions
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_insert" ON public.messages FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = user_id AND (
    -- If room allows everyone to message, or user is not muted
    NOT EXISTS (
      SELECT 1 FROM public.chat_rooms cr
      WHERE cr.id = room_id AND (cr.only_admins_can_message = true OR cr.is_locked = true)
    ) OR
    EXISTS (
      SELECT 1 FROM public.room_members rm
      WHERE rm.room_id = messages.room_id
      AND rm.user_id = auth.uid()
      AND rm.role IN ('creator', 'admin')
      AND (rm.muted_until IS NULL OR rm.muted_until < NOW())
    )
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON public.room_members (room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON public.room_members (user_id);
CREATE INDEX IF NOT EXISTS idx_room_members_role ON public.room_members (role);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_category ON public.chat_rooms (category);