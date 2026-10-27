'use strict';
// Shared helpers for the ShowMe serverless functions (Vercel, Node 18+).
// No npm dependencies: Supabase is called through its REST/Auth HTTP APIs.
const crypto = require('crypto');

const env = n => (process.env[n] || '').trim();
const SB_URL = () => env('SUPABASE_URL').replace(/\/+$/, '');
const OWNER = () => (env('OWNER_EMAIL') || 'mishtiaqkhursheed@gmail.com').toLowerCase();
const ZHIPU_URL = () => env('ZHIPU_URL') || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const GROQ_URL = () => env('GROQ_URL') || 'https://api.groq.com/openai/v1/chat/completions';
// Text model for ShowMe Research (Groq) and the model used when a message contains an image
// (gpt-oss is text-only). Both can be changed with environment variables.
const GROQ_MODEL = () => env('GROQ_MODEL') || 'openai/gpt-oss-20b';
const GROQ_VISION_MODEL = () => env('GROQ_VISION_MODEL') || 'meta-llama/llama-4-scout-17b-16e-instruct';
// ShowMe model -> provider. Beta stays on Zhipu; Research now runs on Groq.
// (The ids are the names the browser already uses, so saved chats keep working.)
const MODEL_PROVIDER = { 'glm-4.5-flash': 'zhipu', 'glm-4.6v-flash': 'groq' };
const MODEL_ALLOWLIST = new Set(Object.keys(MODEL_PROVIDER));

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  return b && typeof b === 'object' ? b : {};
}

// New-style Supabase keys (sb_publishable_/sb_secret_) go in the apikey header only;
// legacy JWT keys (anon/service_role) are also accepted as a Bearer token.
function keyHeaders(key, bearer) {
  const h = { apikey: key };
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  else if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;

// ---- Supabase Auth: who is calling? ---------------------------------------
async function getUser(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  const url = SB_URL(), anon = env('SUPABASE_ANON_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  if (!m || !url || !anon) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: keyHeaders(anon, m[1]), signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const u = await r.json();
    const email = normEmail(u.email);
    // Only verified e-mail addresses count, so nobody can claim an address they do not own.
    if (!u.id || !email || !(u.email_confirmed_at || u.confirmed_at)) return null;
    const md = u.user_metadata || {};
    return { id: u.id, email, name: md.full_name || md.name || '', avatar: md.avatar_url || md.picture || '' };
  } catch { return null; }
}

// ---- Supabase database (service role, bypasses RLS; never exposed to browsers) ----
async function db(path, { method = 'GET', body, prefer } = {}) {
  const url = SB_URL(), key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw Object.assign(new Error('Server is missing Supabase settings.'), { status: 500 });
  const headers = { ...keyHeaders(key), 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw Object.assign(new Error((data && data.message) || `Database error (${r.status})`), { status: 500 });
  return data;
}

async function isAdminEmail(email) {
  if (email === OWNER()) return true;
  const rows = await db(`admins?email=eq.${encodeURIComponent(email)}&select=email&limit=1`);
  return Array.isArray(rows) && rows.length > 0;
}

// Returns { user, isOwner, isAdmin } or sends the error response and returns null.
async function authorize(req, res, need) {
  const user = await getUser(req);
  if (!user) { json(res, 401, { error: 'Please sign in to continue.' }); return null; }
  let isAdmin = false;
  try { isAdmin = await isAdminEmail(user.email); }
  catch (e) { json(res, 500, { error: e.message }); return null; }
  const isOwner = user.email === OWNER();
  if (need === 'admin' && !isAdmin) { json(res, 403, { error: 'Admins only.' }); return null; }
  if (need === 'owner' && !isOwner) { json(res, 403, { error: 'Only the owner can do this.' }); return null; }
  return { user, isOwner, isAdmin };
}

// ---- AI key (database value set by an admin wins over the environment variable) ----
async function getApiKey() {
  try {
    const rows = await db('app_settings?key=eq.zhipu_api_key&select=value&limit=1');
    if (Array.isArray(rows) && rows[0] && rows[0].value) return rows[0].value.trim();
  } catch { /* fall back to env */ }
  return env('ZHIPU_API_KEY');
}

async function getGroqKey() {
  try {
    const rows = await db('app_settings?key=eq.groq_api_key&select=value&limit=1');
    if (Array.isArray(rows) && rows[0] && rows[0].value) return rows[0].value.trim();
  } catch { /* fall back to env */ }
  return env('GROQ_API_KEY');
}

// ---- Zhipu (BigModel) ------------------------------------------------------
function makeJwt(apiKey) {
  const [id, secret] = apiKey.split('.');
  if (!id || !secret) throw Object.assign(new Error('The AI key has the wrong format (expected id.secret).'), { status: 400 });
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Date.now();
  const data = `${b64({ alg: 'HS256', sign_type: 'SIGN' })}.${b64({ api_key: id, exp: now + 3600000, timestamp: now })}`;
  return `${data}.${crypto.createHmac('sha256', secret).update(data).digest('base64url')}`;
}

const codeLines = t => { let n = 0, m; const re = /```[^\n]*\n([\s\S]*?)(```|$)/g; while ((m = re.exec(t))) n += m[1].split('\n').length; return n; };

async function zhipuOnce(apiKey, model, messages, temperature, tools, maxTokens = 8192) {
  const r = await fetch(ZHIPU_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${makeJwt(apiKey)}` },
    body: JSON.stringify({ model, messages, temperature, stream: false, max_tokens: maxTokens, ...(tools ? { tools } : {}) }),
    signal: AbortSignal.timeout(120000)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((d && d.error && d.error.message) || (d && d.message) || `AI provider returned HTTP ${r.status}`), { status: r.status, upstream: true });
  const c = d && d.choices && d.choices[0];
  return { text: (c && c.message && c.message.content) || '', finish: c && c.finish_reason };
}

const hasImage = messages => messages.some(m => Array.isArray(m.content) && m.content.some(p => p && p.type === 'image_url'));

// ---- Groq (OpenAI-compatible) ----------------------------------------------
// `model` is the Groq model id. One automatic retry on a short rate-limit wait.
async function groqOnce(apiKey, model, messages, temperature, maxTokens = 8192, retried = false) {
  const r = await fetch(GROQ_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, messages, temperature, stream: false, max_tokens: maxTokens,
      ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {})
    }),
    signal: AbortSignal.timeout(120000)
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 429 && !retried) {
    const wait = Math.min(15, Math.ceil(Number(r.headers.get('retry-after')) || 0));
    if (wait > 0) { await new Promise(res => setTimeout(res, wait * 1000)); return groqOnce(apiKey, model, messages, temperature, maxTokens, true); }
  }
  if (!r.ok) throw Object.assign(new Error((d && d.error && d.error.message) || (d && d.message) || `AI provider returned HTTP ${r.status}`), { status: r.status, upstream: true });
  const c = d && d.choices && d.choices[0];
  return { text: (c && c.message && c.message.content) || '', finish: c && c.finish_reason };
}

// Keeps asking the model to continue while it is cut off, so replies come back complete.
async function complete(once, messages, budgetMs = 240000) {
  const t0 = Date.now(); let full = '';
  for (let i = 0; i < 8; i++) {
    const { text, finish } = await once(i ? [...messages, { role: 'assistant', content: full }, { role: 'user', content: 'Continue exactly where you stopped. Do not repeat anything already written.' }] : messages);
    full += text;
    if (finish !== 'length' || codeLines(full) >= 150 || Date.now() - t0 > budgetMs - 130000) break;
  }
  return full;
}

module.exports = { env, SB_URL, OWNER, MODEL_ALLOWLIST, MODEL_PROVIDER, GROQ_MODEL, GROQ_VISION_MODEL, getGroqKey, groqOnce, hasImage, json, parseBody, normEmail, validEmail, getUser, db, isAdminEmail, authorize, getApiKey, zhipuOnce, complete };
