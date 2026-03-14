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

async function removeMemesRoom() {
  console.log('Removing memes room...');
  const { error } = await supabase.from('chat_rooms').delete().eq('name', 'memes');
  
  if (error) {
    console.error('Error removing memes room:', error);
  } else {
    console.log('Memes room removed successfully.');
  }
}

removeMemesRoom();
