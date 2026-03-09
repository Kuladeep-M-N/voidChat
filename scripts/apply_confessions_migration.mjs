// Run: node c:\wisper\scripts\apply_confessions_migration.mjs
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://pkuacdmxvuocfdtasryg.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrdWFjZG14dnVvY2ZkdGFzcnlnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjk1MTM1NCwiZXhwIjoyMDg4NTI3MzU0fQ.placeholder'
);

console.log('Note: This script needs a SERVICE ROLE key to bypass RLS.');
console.log('Please run the SQL directly in the Supabase dashboard:');
console.log('https://supabase.com/dashboard/project/pkuacdmxvuocfdtasryg/sql/new');
