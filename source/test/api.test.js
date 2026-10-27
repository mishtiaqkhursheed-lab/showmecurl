'use strict';
// Run: node test/api.test.js   (no network needed – uses local mock Supabase + mock AI)
const http = require('http');
const assert = require('assert');

const OWNER = 'mishtiaqkhursheed@gmail.com';
const TOKENS = {
  'tok-owner': { id: 'u1', email: 'MishtiaqKhursheed@Gmail.com', email_confirmed_at: '2026-01-01', user_metadata: { full_name: 'M Ishtiaq' } },
  'tok-friend': { id: 'u2', email: 'friend@example.com', email_confirmed_at: '2026-01-01', user_metadata: {} },
  'tok-user': { id: 'u3', email: 'user@example.com', email_confirmed_at: '2026-01-01', user_metadata: {} },
  'tok-spoof': { id: 'u4', email: OWNER, email_confirmed_at: null, user_metadata: {} } // unverified e-mail claiming to be the owner
};
const T = { admins: [], knowledge: [], app_settings: [] }; let kid = 1;

function mockSupabase() {
  return http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const u = new URL(req.url, 'http://x'); const send = (s, d) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(d === undefined ? '' : JSON.stringify(d)); };
      if (u.pathname === '/auth/v1/user') {
        const t = (req.headers.authorization || '').replace(/^Bearer /, ''); return TOKENS[t] ? send(200, TOKENS[t]) : send(401, { msg: 'bad jwt' });
      }
      if (req.headers.apikey !== 'sb_secret_test') return send(401, { message: 'bad key' });
      const tbl = u.pathname.replace('/rest/v1/', ''); const body = raw ? JSON.parse(raw) : null;
      const eq = (k) => { const v = u.searchParams.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
      if (req.method === 'GET') {
        let rows = T[tbl].slice(); const e = eq('email'), k = eq('key'); if (e) rows = rows.filter(r => r.email === e); if (k) rows = rows.filter(r => r.key === k);
        return send(200, rows);
      }
      if (req.method === 'POST') {
        if (tbl === 'admins') { if (!T.admins.find(r => r.email === body.email)) T.admins.push({ ...body, created_at: new Date().toISOString() }); return send(201); }
        if (tbl === 'app_settings') { T.app_settings = T.app_settings.filter(r => r.key !== body.key); T.app_settings.push(body); return send(201); }
        if (tbl === 'knowledge') { T.knowledge.push({ id: kid++, ...body, created_at: new Date().toISOString() }); return send(201); }
      }
      if (req.method === 'DELETE') {
        if (tbl === 'admins') T.admins = T.admins.filter(r => r.email !== eq('email'));
        if (tbl === 'knowledge') T.knowledge = T.knowledge.filter(r => String(r.id) !== eq('id'));
        return send(204);
      }
      send(404, { message: 'nope' });
    });
  });
}
let zhipuCalls = [];
function mockZhipu() {
  return http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const b = JSON.parse(raw); zhipuCalls.push({ auth: req.headers.authorization, body: b });
      if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(req.headers.authorization || '')) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'bad token' } })); }
      const continuing = b.messages.some(m => m.content === 'Continue exactly where you stopped. Do not repeat anything already written.');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: continuing ? ' part2' : 'part1' }, finish_reason: continuing ? 'stop' : 'length' }] }));
    });
  });
}

let groqCalls = [];
function mockGroq() {
  return http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const b = JSON.parse(raw); groqCalls.push({ auth: req.headers.authorization, body: b });
      if (req.headers.authorization !== 'Bearer gsk_testkey1234567890') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'bad key' } })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'groq-reply' }, finish_reason: 'stop' }] }));
    });
  });
}

(async () => {
  const sb = mockSupabase(), zp = mockZhipu(), gq = mockGroq();
  await new Promise(r => gq.listen(0, r));
  process.env.GROQ_URL = `http://127.0.0.1:${gq.address().port}/chat`; delete process.env.GROQ_API_KEY;
  await new Promise(r => sb.listen(0, r)); await new Promise(r => zp.listen(0, r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${sb.address().port}`;
  process.env.SUPABASE_ANON_KEY = 'sb_publishable_test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.ZHIPU_URL = `http://127.0.0.1:${zp.address().port}/chat`;
  delete process.env.OWNER_EMAIL; delete process.env.ZHIPU_API_KEY;

  const handlers = { '/api/config': require('../api/config'), '/api/me': require('../api/me'), '/api/chat': require('../api/chat'), '/api/admin': require('../api/admin') };
  const app = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', async () => {
      try { req.body = raw && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw) : undefined; await handlers[req.url.split('?')[0]](req, res); }
      catch (e) { res.statusCode = 500; res.end(String(e.stack)); }
    });
  });
  await new Promise(r => app.listen(0, r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (path, tok, body, method) => {
    const r = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const ok = (name) => console.log('  ✓', name);

  // config
  let r = await call('/api/config'); assert.equal(r.status, 200); assert.equal(r.data.anonKey, 'sb_publishable_test'); assert(!JSON.stringify(r.data).includes('secret')); ok('config exposes only url + publishable key');

  // me
  r = await call('/api/me'); assert.equal(r.status, 401); ok('me: no token → 401');
  r = await call('/api/me', 'tok-fake'); assert.equal(r.status, 401); ok('me: bad token → 401');
  r = await call('/api/me', 'tok-spoof'); assert.equal(r.status, 401); ok('me: UNVERIFIED e-mail claiming owner address is rejected');
  r = await call('/api/me', 'tok-owner'); assert.deepEqual([r.data.isOwner, r.data.isAdmin, r.data.email], [true, true, OWNER]); ok('me: owner (case-insensitive) is owner+admin');
  r = await call('/api/me', 'tok-user'); assert.deepEqual([r.data.isOwner, r.data.isAdmin], [false, false]); ok('me: normal user is not admin');

  // admin access control
  r = await call('/api/admin', null, { action: 'overview' }); assert.equal(r.status, 401); ok('admin: anonymous → 401');
  r = await call('/api/admin', 'tok-user', { action: 'overview' }); assert.equal(r.status, 403); ok('admin: normal user → 403');
  r = await call('/api/admin', 'tok-spoof', { action: 'overview' }); assert.equal(r.status, 401); ok('admin: spoofed owner → 401');
  r = await call('/api/admin', 'tok-friend', { action: 'overview' }); assert.equal(r.status, 403); ok('admin: friend not yet admin → 403');

  // owner adds admin
  r = await call('/api/admin', 'tok-owner', { action: 'addAdmin', email: 'not-an-email' }); assert.equal(r.status, 400); ok('addAdmin: invalid e-mail rejected');
  r = await call('/api/admin', 'tok-owner', { action: 'addAdmin', email: OWNER }); assert.equal(r.status, 400); ok('addAdmin: owner address rejected');
  r = await call('/api/admin', 'tok-owner', { action: 'addAdmin', email: '  Friend@Example.com ' }); assert.equal(r.status, 200); assert.deepEqual(T.admins.map(a => a.email), ['friend@example.com']); ok('addAdmin: stored lower-cased + trimmed');
  r = await call('/api/me', 'tok-friend'); assert.deepEqual([r.data.isOwner, r.data.isAdmin], [false, true]); ok('me: added e-mail is now admin (not owner)');
  r = await call('/api/admin', 'tok-friend', { action: 'overview' }); assert.equal(r.status, 200); assert.deepEqual(r.data.admins, []); ok('admin: delegated admin can open admin, does not see admin list');
  r = await call('/api/admin', 'tok-friend', { action: 'addAdmin', email: 'x@y.com' }); assert.equal(r.status, 403); ok('addAdmin: delegated admin cannot add admins');
  r = await call('/api/admin', 'tok-friend', { action: 'removeAdmin', email: 'friend@example.com' }); assert.equal(r.status, 403); ok('removeAdmin: delegated admin cannot remove admins');
  r = await call('/api/admin', 'tok-owner', { action: 'overview' }); assert.equal(r.data.admins.length, 1); assert.equal(r.data.keySet, false); ok('overview: owner sees admin list');

  // key + knowledge
  r = await call('/api/admin', 'tok-friend', { action: 'setKey', apiKey: 'bad' }); assert.equal(r.status, 400); ok('setKey: bad format rejected');
  r = await call('/api/admin', 'tok-friend', { action: 'setKey', apiKey: 'abc123.secret456' }); assert.equal(r.status, 200); ok('setKey: admin can save key');
  r = await call('/api/admin', 'tok-friend', { action: 'testKey' }); assert.match(r.data.message, /connected/); ok('testKey: pings provider');
  r = await call('/api/admin', 'tok-friend', { action: 'addKnowledge', name: 'faq.txt', text: 'The shop opens at 9am.' }); assert.equal(r.status, 200); ok('addKnowledge');
  r = await call('/api/admin', 'tok-user', { action: 'addKnowledge', name: 'x', text: 'y' }); assert.equal(r.status, 403); ok('addKnowledge: normal user → 403');

  // chat
  const msgs = [{ role: 'system', content: 'You are ShowMe.' }, { role: 'user', content: 'hi' }];
  r = await call('/api/chat', null, { model: 'glm-4.5-flash', messages: msgs }); assert.equal(r.status, 401); ok('chat: anonymous → 401');
  r = await call('/api/chat', 'tok-spoof', { model: 'glm-4.5-flash', messages: msgs }); assert.equal(r.status, 401); ok('chat: unverified e-mail → 401');
  r = await call('/api/chat', 'tok-user', { model: 'evil-model', messages: msgs }); assert.equal(r.status, 400); ok('chat: unknown model rejected');
  zhipuCalls = [];
  r = await call('/api/chat', 'tok-user', { model: 'glm-4.5-flash', messages: [...msgs, { role: 'tool', content: 'x' }], think: true }); assert.equal(r.status, 200); assert.equal(r.data.reply, 'part1 part2'); ok('chat: normal user gets reply, auto-continues when cut off');
  assert(zhipuCalls[0].body.messages.every(m => m.role !== 'tool')); ok('chat: disallowed roles stripped');
  assert(zhipuCalls[0].body.messages[0].content.includes('The shop opens at 9am.')); ok('chat: Think mode adds admin knowledge on the server');
  zhipuCalls = []; r = await call('/api/chat', 'tok-user', { model: 'glm-4.5-flash', messages: msgs }); assert(!zhipuCalls[0].body.messages[0].content.includes('shop opens')); ok('chat: knowledge NOT added when Think is off');

  // Groq (ShowMe Research)
  zhipuCalls = []; groqCalls = [];
  r = await call('/api/chat', 'tok-user', { model: 'glm-4.6v-flash', messages: msgs }); assert.equal(r.status, 503); ok('chat: Research without a Groq key → 503');
  r = await call('/api/admin', 'tok-friend', { action: 'setGroqKey', apiKey: 'abc.def' }); assert.equal(r.status, 400); ok('setGroqKey: non-gsk key rejected');
  r = await call('/api/admin', 'tok-user', { action: 'setGroqKey', apiKey: 'gsk_testkey1234567890' }); assert.equal(r.status, 403); ok('setGroqKey: normal user → 403');
  r = await call('/api/admin', 'tok-friend', { action: 'setGroqKey', apiKey: 'gsk_testkey1234567890' }); assert.equal(r.status, 200); ok('setGroqKey: admin can save key');
  r = await call('/api/admin', 'tok-friend', { action: 'testGroq' }); assert.match(r.data.message, /connected/); ok('testGroq: pings Groq');
  r = await call('/api/admin', 'tok-friend', { action: 'overview' }); assert.equal(r.data.groqKeySet, true); ok('overview: reports Groq key');
  groqCalls = [];
  r = await call('/api/chat', 'tok-user', { model: 'glm-4.6v-flash', messages: msgs, tools: [{ type: 'web_search' }] }); assert.equal(r.status, 200); assert.equal(r.data.reply, 'groq-reply'); ok('chat: Research is answered by Groq');
  assert.equal(zhipuCalls.length, 0); ok('chat: Research never calls Zhipu');
  assert.equal(groqCalls[0].body.model, 'openai/gpt-oss-20b'); assert.equal(groqCalls[0].body.reasoning_effort, 'low'); assert(!('tools' in groqCalls[0].body)); ok('chat: Groq gets gpt-oss model, low reasoning, no Zhipu tools');
  groqCalls = []; await call('/api/chat', 'tok-user', { model: 'glm-4.6v-flash', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }, { type: 'text', text: 'what is this' }] }] });
  assert.match(groqCalls[0].body.model, /llama-4-scout/); assert(!('reasoning_effort' in groqCalls[0].body)); ok('chat: image messages use the Groq vision model');
  groqCalls = []; r = await call('/api/chat', 'tok-user', { model: 'glm-4.5-flash', messages: msgs }); assert.equal(groqCalls.length, 0); ok('chat: Beta still uses Zhipu, not Groq');

  // remove admin
  r = await call('/api/admin', 'tok-owner', { action: 'removeAdmin', email: OWNER }); assert.equal(r.status, 400); ok('removeAdmin: owner cannot be removed');
  r = await call('/api/admin', 'tok-owner', { action: 'removeAdmin', email: 'friend@example.com' }); assert.equal(r.status, 200);
  r = await call('/api/admin', 'tok-friend', { action: 'overview' }); assert.equal(r.status, 403); ok('removeAdmin: access revoked immediately');
  r = await call('/api/admin', 'tok-owner', { action: 'deleteKnowledge', id: 1 }); assert.equal(r.status, 200); assert.equal(T.knowledge.length, 0); ok('deleteKnowledge');

  console.log('\nAll backend tests passed.'); sb.close(); zp.close(); gq.close(); app.close(); process.exit(0);
})().catch(e => { console.error('\nFAILED:', e); process.exit(1); });
