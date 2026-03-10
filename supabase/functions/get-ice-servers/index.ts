import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const STUN_FALLBACK = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  const METERED_APP_NAME = Deno.env.get('METERED_APP_NAME');
  const METERED_API_KEY = Deno.env.get('METERED_API_KEY');
  const ENABLE_TURN = Deno.env.get('ENABLE_TURN');

  if (ENABLE_TURN === 'false' || !METERED_APP_NAME || !METERED_API_KEY) {
    return new Response(JSON.stringify(STUN_FALLBACK), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const url = `https://${METERED_APP_NAME}.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Metered API error: ${res.status}`);
    const iceServers = await res.json();
    return new Response(JSON.stringify(iceServers), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    console.error('TURN fetch failed:', err);
    return new Response(JSON.stringify(STUN_FALLBACK), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
