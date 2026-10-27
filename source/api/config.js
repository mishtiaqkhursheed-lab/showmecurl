'use strict';
// Public browser settings (the Supabase URL and the publishable/anon key are meant to be public).
const { env, SB_URL, json } = require('./_lib');
module.exports = (req, res) => {
  const url = SB_URL(), anonKey = env('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return json(res, 503, { error: 'Supabase is not configured on the server yet.' });
  json(res, 200, { url, anonKey });
};
