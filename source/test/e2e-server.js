'use strict';
// Local end-to-end harness: serves public/ + the real /api handlers against a mock Supabase and mock AI.
const http = require('http'), fs = require('fs'), path = require('path');
const TOK = {
  'tok-owner': { id: 'u1', email: 'mishtiaqkhursheed@gmail.com', email_confirmed_at: 'x', user_metadata: { full_name: 'M Ishtiaq' } },
  'tok-friend': { id: 'u2', email: 'friend@example.com', email_confirmed_at: 'x', user_metadata: {} },
  'tok-user': { id: 'u3', email: 'user@example.com', email_confirmed_at: 'x', user_metadata: {} }
};
const T = { admins: [], knowledge: [], app_settings: [] }; let kid = 1;
const sb = http.createServer((req, res) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
  const u = new URL(req.url, 'http://x'), send = (s, d) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(d === undefined ? '' : JSON.stringify(d)); };
  if (u.pathname === '/auth/v1/user') { const t = (req.headers.authorization || '').replace(/^Bearer /, ''); return TOK[t] ? send(200, TOK[t]) : send(401, {}); }
  const tbl = u.pathname.replace('/rest/v1/', ''), body = raw ? JSON.parse(raw) : null, eq = k => { const v = u.searchParams.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  if (req.method === 'GET') { let r = T[tbl].slice(); if (eq('email')) r = r.filter(x => x.email === eq('email')); if (eq('key')) r = r.filter(x => x.key === eq('key')); return send(200, r); }
  if (req.method === 'POST') { if (tbl === 'admins') { if (!T.admins.find(x => x.email === body.email)) T.admins.push({ ...body, created_at: new Date().toISOString() }); } else if (tbl === 'app_settings') { T.app_settings = T.app_settings.filter(x => x.key !== body.key); T.app_settings.push(body); } else T.knowledge.push({ id: kid++, ...body, created_at: new Date().toISOString() }); return send(201); }
  if (req.method === 'DELETE') { if (tbl === 'admins') T.admins = T.admins.filter(x => x.email !== eq('email')); else T.knowledge = T.knowledge.filter(x => String(x.id) !== eq('id')); return send(204); }
  send(404, {}); }); });
const zp = http.createServer((req, res) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => { const b = JSON.parse(raw); const last = b.messages[b.messages.length - 1].content; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'AI reply to: ' + (typeof last === 'string' ? last : '[image]') + '\n\n```python\nprint("hi")\n```' }, finish_reason: 'stop' }] })); }); });
sb.listen(0, () => zp.listen(0, () => {
  process.env.SUPABASE_URL = `http://127.0.0.1:${sb.address().port}`; process.env.SUPABASE_ANON_KEY = 'sb_publishable_test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.ZHIPU_URL = `http://127.0.0.1:${zp.address().port}/chat`; process.env.ZHIPU_API_KEY = 'abc.def'; process.env.GROQ_URL = `http://127.0.0.1:${zp.address().port}/chat`; process.env.GROQ_API_KEY = 'gsk_e2e_dummy_key_123';
  const H = { '/api/config': require('../api/config'), '/api/me': require('../api/me'), '/api/chat': require('../api/chat'), '/api/admin': require('../api/admin') };
  http.createServer((req, res) => { let raw = ''; req.on('data', c => raw += c); req.on('end', async () => {
    const p = req.url.split('?')[0];
    if (H[p]) { try { req.body = raw && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw) : undefined; await H[p](req, res); } catch (e) { res.statusCode = 500; res.end(String(e)); } return; }
    const f = path.join(__dirname, '..', 'public', p === '/' ? 'index.html' : p);
    if (fs.existsSync(f)) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(f)); }
    res.statusCode = 404; res.end('nf'); }); }).listen(4173, () => console.log('E2E ready http://127.0.0.1:4173'));
}));
