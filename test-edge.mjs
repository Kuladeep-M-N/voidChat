import dotenv from 'dotenv';
dotenv.config();

const VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

async function test() {
  try {
    const res = await fetch(`${VITE_SUPABASE_URL}/functions/v1/get-ice-servers`, {
      method: 'POST', // or GET depending on the edge function
      headers: {
        'apikey': VITE_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${VITE_SUPABASE_ANON_KEY}`
      }
    });
    
    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Response:", text);
  } catch (err) {
    console.error(err);
  }
}

test();
