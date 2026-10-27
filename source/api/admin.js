'use strict';
const { json, parseBody, authorize, db, normEmail, validEmail, OWNER, getApiKey, getGroqKey, zhipuOnce, groqOnce, GROQ_MODEL } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const ctx = await authorize(req, res, 'admin');
  if (!ctx) return;
  const b = parseBody(req);

  try {
    switch (b.action) {
      case 'overview': {
        const [admins, knowledge, key, groqKey] = await Promise.all([
          ctx.isOwner ? db('admins?select=email,added_by,created_at&order=created_at.asc') : Promise.resolve([]),
          db('knowledge?select=id,name,created_at&order=id.asc'),
          getApiKey(),
          getGroqKey()
        ]);
        return json(res, 200, { owner: OWNER(), isOwner: ctx.isOwner, admins, knowledge, keySet: Boolean(key), groqKeySet: Boolean(groqKey) });
      }
      case 'addAdmin': {
        if (!ctx.isOwner) return json(res, 403, { error: 'Only the owner can add admins.' });
        const email = normEmail(b.email);
        if (!validEmail(email)) return json(res, 400, { error: 'Enter a valid e-mail address.' });
        if (email === OWNER()) return json(res, 400, { error: 'That is already the owner.' });
        await db('admins?on_conflict=email', { method: 'POST', body: { email, added_by: ctx.user.email }, prefer: 'resolution=ignore-duplicates,return=minimal' });
        return json(res, 200, { ok: true });
      }
      case 'removeAdmin': {
        if (!ctx.isOwner) return json(res, 403, { error: 'Only the owner can remove admins.' });
        const email = normEmail(b.email);
        if (email === OWNER()) return json(res, 400, { error: 'The owner cannot be removed.' });
        await db(`admins?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE', prefer: 'return=minimal' });
        return json(res, 200, { ok: true });
      }
      case 'setKey': {
        const key = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
        if (key.split('.').length !== 2 || key.length < 10 || key.length > 300 || /\s/.test(key)) return json(res, 400, { error: 'Enter a valid Zhipu API key in id.secret format.' });
        await db('app_settings?on_conflict=key', { method: 'POST', body: { key: 'zhipu_api_key', value: key, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' });
        return json(res, 200, { ok: true, message: 'AI key saved.' });
      }
      case 'setGroqKey': {
        const key = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
        if (!/^gsk_[A-Za-z0-9_-]{10,200}$/.test(key)) return json(res, 400, { error: 'Enter a valid Groq API key (it starts with gsk_).' });
        await db('app_settings?on_conflict=key', { method: 'POST', body: { key: 'groq_api_key', value: key, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' });
        return json(res, 200, { ok: true, message: 'Groq key saved.' });
      }
      case 'testGroq': {
        const key = await getGroqKey();
        if (!key) return json(res, 200, { message: 'Groq: no key set' });
        try { await groqOnce(key, GROQ_MODEL(), [{ role: 'user', content: 'Reply with OK.' }], 0, 64); return json(res, 200, { message: 'Groq: connected ✔' }); }
        catch (e) { return json(res, 200, { message: 'Groq: key set, but the test failed – ' + (e.message || 'unknown error') }); }
      }
      case 'testKey': {
        const key = await getApiKey();
        if (!key) return json(res, 200, { message: 'Zhipu: no key set' });
        try { await zhipuOnce(key, 'glm-4.5-flash', [{ role: 'user', content: 'Reply with OK.' }], 0, null, 8); return json(res, 200, { message: 'Zhipu: connected ✔' }); }
        catch (e) { return json(res, 200, { message: 'Zhipu: key set, but the test failed – ' + (e.message || 'unknown error') }); }
      }
      case 'addKnowledge': {
        const name = String(b.name || '').trim().slice(0, 120), text = String(b.text || '').slice(0, 400000);
        if (!name || !text) return json(res, 400, { error: 'File name and content are required.' });
        const count = await db('knowledge?select=id&limit=100');
        if (count.length >= 100) return json(res, 400, { error: 'Too many knowledge files (max 100). Delete some first.' });
        await db('knowledge', { method: 'POST', body: { name, text }, prefer: 'return=minimal' });
        return json(res, 200, { ok: true });
      }
      case 'deleteKnowledge': {
        const id = Number(b.id);
        if (!Number.isInteger(id)) return json(res, 400, { error: 'Bad id.' });
        await db(`knowledge?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
        return json(res, 200, { ok: true });
      }
      default:
        return json(res, 400, { error: 'Unknown action.' });
    }
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error.' });
  }
};
