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
  console.log('Clearing messages...');
  const { error: msgError } = await supabase.from('messages').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (msgError) console.error('Error clearing messages:', msgError);
  else console.log('Messages cleared successfully.');

  console.log('Clearing voice rooms...');
  const { error: vrError } = await supabase.from('voice_rooms').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (vrError) console.error('Error clearing voice rooms:', vrError);
  else console.log('Voice rooms cleared successfully.');

  console.log('Done!');
}

clearData();
