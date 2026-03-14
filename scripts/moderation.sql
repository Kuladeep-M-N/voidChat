-- ============================================================
-- VoidChat Moderation & Safety Migration
-- ============================================================

-- 1. Enhance USERS table with moderation fields
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_muted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS reputation_score INTEGER DEFAULT 100;

-- 2. Create REPORTS table
CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('shoutout', 'message', 'confession', 'user')),
    target_id UUID NOT NULL,
    reason TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'ignored')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. Enable RLS on Reports
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for Reports
-- Users can insert reports but only admins can see them
DROP POLICY IF EXISTS "reports_insert" ON public.reports;
CREATE POLICY "reports_insert" ON public.reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "reports_select_admin" ON public.reports;
CREATE POLICY "reports_select_admin" ON public.reports FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() AND is_admin = TRUE
    )
);

-- 5. Content Filtering Helper (Example for dashboard)
-- We'll implement the actual filtering in the app code, 
-- but we can add a view for admins to see high-risk content.
CREATE OR REPLACE VIEW public.flagged_content AS
SELECT * FROM public.shoutouts 
WHERE id IN (
    SELECT target_id FROM public.reports 
    WHERE target_type = 'shoutout' 
    GROUP BY target_id 
    HAVING COUNT(*) >= 3
);
