const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixRealtime() {
  console.log("Checking and fixing Realtime for 'confessions' table...");
  
  // Note: We can't easily check publication status via JS client without RPC or custom SQL execution.
  // However, we can try to force-enable it if a service role key is provided, or just advise the user.
  
  console.log("Please run the following SQL in the Supabase Dashboard SQL Editor if real-time is still failing:");
  console.log(`
    -- 1. Ensure the confessions table has replica identity full (needed for all columns in payload)
    ALTER TABLE public.confessions REPLICA IDENTITY FULL;

    -- 2. Ensure real-time is enabled for the confessions table
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'confessions'
      ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.confessions;
      END IF;
    END
    $$;
  `);
}

fixRealtime();
