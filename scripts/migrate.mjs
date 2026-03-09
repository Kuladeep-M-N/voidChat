// Run with: node c:\wisper\scripts\migrate.mjs
const PROJECT_ID = 'pkuacdmxvuocfdtasryg';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrdWFjZG14dnVvY2ZkdGFzcnlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NTEzNTQsImV4cCI6MjA4ODUyNzM1NH0.6LZnBHFEoyA0LH5PI50vQpvBZNnWEXmd2TxWoVBZxyY';

// We cannot drop tables from anon key, so just truncate and insert a test room via REST
const BASE = `https://${PROJECT_ID}.supabase.co/rest/v1`;
const headers = {
  'apikey': ANON_KEY,
  'Authorization': 'Bearer ' + ANON_KEY,
  'Content-Type': 'application/json',
};

const check = await fetch(`${BASE}/users?select=id&limit=1`, { headers });
console.log('DB connection check:', check.status, await check.text());
