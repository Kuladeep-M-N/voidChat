/**
 * Run: node c:\wisper\scripts\create_tables.mjs
 * This uses the Supabase Management API to apply SQL migrations.
 */

const PROJECT_ID = 'igmlyvkqkglzuzyzvbba';
// Uses the anon key - but we'll call the pg endpoint directly via the Management API
// Actually, let's use the Supabase REST API with service role to execute SQL

// INSTRUCTIONS:
// 1. Go to: https://supabase.com/dashboard/project/igmlyvkqkglzuzyzvbba/settings/api
// 2. Copy your SERVICE ROLE key (secret, keep it safe)
// 3. Paste it below replacing YOUR_SERVICE_ROLE_KEY
// 4. Run: node c:\wisper\scripts\create_tables.mjs

const SERVICE_ROLE_KEY = 'YOUR_SERVICE_ROLE_KEY'; // Replace this

if (SERVICE_ROLE_KEY === 'YOUR_SERVICE_ROLE_KEY') {
  console.error('❌ Please set your SERVICE_ROLE_KEY in this file first.');
  console.log('Get it from: https://supabase.com/dashboard/project/igmlyvkqkglzuzyzvbba/settings/api');
  process.exit(1);
}

const SQL = `
CREATE TABLE IF NOT EXISTS public.confessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  likes INT DEFAULT 0 NOT NULL,
  category TEXT DEFAULT 'random' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.confessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conf_select" ON public.confessions;
DROP POLICY IF EXISTS "conf_insert" ON public.confessions;
DROP POLICY IF EXISTS "conf_update" ON public.confessions;
DROP POLICY IF EXISTS "conf_delete" ON public.confessions;
CREATE POLICY "conf_select" ON public.confessions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "conf_insert" ON public.confessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "conf_update" ON public.confessions FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "conf_delete" ON public.confessions FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.confession_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confession_id UUID NOT NULL REFERENCES public.confessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE public.confession_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cc_select" ON public.confession_comments;
DROP POLICY IF EXISTS "cc_insert" ON public.confession_comments;
DROP POLICY IF EXISTS "cc_delete" ON public.confession_comments;
CREATE POLICY "cc_select" ON public.confession_comments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "cc_insert" ON public.confession_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cc_delete" ON public.confession_comments FOR DELETE USING (auth.uid() = user_id);
`;

// Call Supabase Management API
const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: SQL }),
});

if (res.ok) {
  console.log('✅ Tables created successfully!');
} else {
  const err = await res.text();
  console.error('❌ Error:', res.status, err);
}
