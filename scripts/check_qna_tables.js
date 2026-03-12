
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkTables() {
  const { data, error } = await supabase
    .from('qna_questions')
    .select('count', { count: 'exact', head: true });

  if (error) {
    console.error('Error checking qna_questions:', error.message);
    process.exit(1);
  } else {
    console.log('qna_questions table exists.');
  }

  const { data: aData, error: aError } = await supabase
    .from('qna_answers')
    .select('count', { count: 'exact', head: true });

  if (aError) {
    console.error('Error checking qna_answers:', aError.message);
    process.exit(1);
  } else {
    console.log('qna_answers table exists.');
  }
}

checkTables();
