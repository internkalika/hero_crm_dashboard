// Vercel serverless function: a thin, locked-down proxy between the dashboard and Groq.
// - The API key lives only in the GROQ_API_KEY environment variable (never in the HTML).
// - The system prompt, model, temperature and tool list are fixed here; the browser only sends the conversation.
// - Nothing is logged or stored.
const TOOLS = require('./tools.js');

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());

const SYSTEM = `You are the data assistant of the Hero Cycles CRM Tracker dashboard.
RULES (follow exactly):
1. Answer ONLY from the results returned by the tools. Never use outside knowledge, memory or estimates.
2. Call a tool for every question about data. You may call at most 3 tools. Never calculate new numbers yourself: quote numbers exactly as they appear in the tool results (use the *_display strings when present).
3. Always state the period and scope (dealers, channel) given in the tool result.
4. If the tools return status "no_data", "not_available" or "error", or no tool can answer the question, reply exactly: "Currently no such data is present in the dashboard." followed by one short reason taken from the tool result (if any).
5. Order value is sales value, never profit. There is no cost or profit data. DataSense has no model/SKU data. The Dealer App has no data before September 2026.
6. Be concise: at most 5 short sentences, plain text, no markdown tables.`;

const buckets = new Map();
function limited(ip) {
  const now = Date.now();
  const b = (buckets.get(ip) || []).filter((t) => now - t < 60000);
  b.push(now);
  buckets.set(ip, b);
  return b.length > Number(process.env.RATE_PER_MIN || 20);
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  const allow = ALLOWED.includes('*') ? '*' : ALLOWED.includes(origin) ? origin : ALLOWED[0];
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY is not set on the server' });
  if (limited(String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x'))) return res.status(429).json({ error: 'Too many requests, try again in a minute' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const msgs = body && Array.isArray(body.messages) ? body.messages : null;
  if (!msgs || msgs.length < 1 || msgs.length > 14) return res.status(400).json({ error: 'messages must be an array of 1-14 items' });
  const ok = msgs.every((m) => m && ['user', 'assistant', 'tool'].includes(m.role));
  const size = JSON.stringify(msgs).length;
  if (!ok || size > 30000) return res.status(400).json({ error: 'invalid or too large conversation' });

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 600, messages: [{ role: 'system', content: SYSTEM }, ...msgs], tools: TOOLS, tool_choice: 'auto' }),
    });
    const text = await r.text();
    if (!r.ok) {
      const retry = r.headers.get('retry-after');
      if (retry) res.setHeader('Retry-After', retry);
      return res.status(r.status === 429 ? 429 : 502).json({ error: r.status === 429 ? 'rate_limited' : 'upstream_error' });
    }
    const data = JSON.parse(text);
    const message = data.choices && data.choices[0] && data.choices[0].message;
    if (!message) return res.status(502).json({ error: 'empty response' });
    return res.status(200).json({ message: { role: 'assistant', content: message.content || null, tool_calls: message.tool_calls || undefined } });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unreachable' });
  }
};
