import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function clearData() {
  const tables = [
    'qna_answers',
    'qna_questions',
    'poll_votes',
    'polls',
    'shoutouts',
    'confession_comments',
    'confessions',
    'messages',
    'voice_rooms',
    'users'
  ];

  for (const table of tables) {
    console.log(`Clearing ${table}...`);
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
      console.error(`Error clearing ${table}:`, error);
    } else {
      console.log(`${table} cleared successfully.`);
    }
  }

  console.log('Done!');
}

clearData();
