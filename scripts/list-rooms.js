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

async function listRooms() {
  const { data, error } = await supabase.from('chat_rooms').select('name');
  if (error) {
    console.error('Error listing rooms:', error);
  } else {
    console.log('Current rooms in database:', data.map(r => r.name));
  }
}

listRooms();
