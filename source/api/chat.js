'use strict';
const { MODEL_ALLOWLIST, MODEL_PROVIDER, GROQ_MODEL, GROQ_VISION_MODEL, json, parseBody, authorize, db, getApiKey, getGroqKey, zhipuOnce, groqOnce, hasImage, complete } = require('./_lib');

const ROLES = new Set(['system', 'user', 'assistant']);

// Instruction appended to system prompt when Think mode is on.
// Asks the model to show its reasoning inside <think>…</think> before answering.
const THINK_INSTRUCTION = `

THINK MODE: Before writing your final answer, reason step by step inside <think> tags. Example format:
<think>
Let me break this down…
[your reasoning]
</think>
[Your actual answer here]

Keep the <think> block concise (a few sentences). Place it at the very start of your reply.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const ctx = await authorize(req, res);
  if (!ctx) return;

  const body = parseBody(req);
  if (!MODEL_ALLOWLIST.has(body.model)) return json(res, 400, { error: 'Unknown ShowMe model selection.' });
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 400) return json(res, 400, { error: 'Messages are required.' });
  const messages = body.messages
    .filter(m => m && ROLES.has(m.role) && (typeof m.content === 'string' || Array.isArray(m.content)))
    .map(m => ({ role: m.role, content: m.content }));
  if (!messages.length) return json(res, 400, { error: 'Messages are required.' });

  const provider = MODEL_PROVIDER[body.model];
  const apiKey = provider === 'groq' ? await getGroqKey() : await getApiKey();
  if (!apiKey) return json(res, 503, { error: 'The AI is not set up yet. Ask the admin to add the AI key.' });

  try {
    // Think mode: inject knowledge data AND ask model to expose its reasoning.
    if (body.think) {
      const rows = await db('knowledge?select=name,text&order=id.asc&limit=100');
      const kd = (rows || []).map(d => `--- ${d.name} ---\n${d.text}`).join('\n').slice(0, 300000);

      // Build the think injection (knowledge data + reasoning instruction)
      let note = THINK_INSTRUCTION;
      if (kd) {
        note += '\n\nIMPORTED DATA (Think mode): First check whether the answer exists in this data, recognise its structure, and answer from it. If not found, say so, then answer normally.\n' + kd;
      }

      const i = messages.findIndex(m => m.role === 'system' && typeof m.content === 'string');
      if (i >= 0) messages[i] = { ...messages[i], content: messages[i].content + note };
      else messages.unshift({ role: 'system', content: note.trim() });
    }

    const temperature = Number.isFinite(body.temperature) ? Math.min(2, Math.max(0, body.temperature)) : 0.7;
    const tools = Array.isArray(body.tools) && body.tools.length && body.tools.every(t => t && t.type === 'web_search') ? body.tools : null;
    // Research runs on Groq (web-search tools are Zhipu-only, so they are not sent); Beta stays on Zhipu.
    const groqModel = hasImage(messages) ? GROQ_VISION_MODEL() : GROQ_MODEL();
    const once = provider === 'groq'
      ? m => groqOnce(apiKey, groqModel, m, temperature)
      : m => zhipuOnce(apiKey, body.model, m, temperature, tools);
    const reply = await complete(once, messages);
    return json(res, 200, { reply });
  } catch (err) {
    // Never forward the provider's 401/403 as-is: the browser reads 401 as "session expired".
    if (err.name === 'TimeoutError') return json(res, 504, { error: 'The AI provider timed out. Try again.' });
    if (err.upstream && (err.status === 401 || err.status === 403)) return json(res, 502, { error: 'The AI key was rejected. Please tell the admin to check it.' });
    if (err.upstream && err.status === 429) return json(res, 429, { error: 'The AI is busy right now. Try again in a moment.' });
    return json(res, 502, { error: err.message || 'Could not contact the AI provider.' });
  }
};
