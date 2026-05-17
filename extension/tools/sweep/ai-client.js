// AI provider abstraction — self-contained.
//
// Drives the "✨ Generate draft" feature on discussion-reply panels. Stores
// its config in localStorage so the user only enters their API key once.
//
// ADD A NEW PROVIDER by appending an entry to PROVIDERS with a function
// that takes ({apiKey, model, system, user, maxTokens}) and returns the
// generated text string. Also add a PROVIDER_META entry so it shows up
// in the settings dropdown. The UI picks it up automatically.
//
// Exports onto window.FEUSweep.ai.

(() => {
  window.FEUSweep = window.FEUSweep || {};
  const AI_KEY = 'feuAIConfig';

  const PROVIDERS = {
    openai: async ({ apiKey, model, system, user, maxTokens }) => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() ?? '';
    },
    anthropic: async ({ apiKey, model, system, user, maxTokens }) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model, system,
          messages: [{ role: 'user', content: user }],
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return data.content?.[0]?.text?.trim() ?? '';
    },
    gemini: async ({ apiKey, model, system, user, maxTokens }) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    },
    groq: async ({ apiKey, model, system, user, maxTokens }) => {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() ?? '';
    },
  };

  const PROVIDER_META = {
    openai:    { label: 'OpenAI',    placeholder: 'gpt-4o-mini',              keyHint: 'sk-...' },
    anthropic: { label: 'Anthropic', placeholder: 'claude-3-5-haiku-latest',  keyHint: 'sk-ant-...' },
    gemini:    { label: 'Gemini',    placeholder: 'gemini-2.0-flash',         keyHint: 'AIza...' },
    groq:      { label: 'Groq',      placeholder: 'llama-3.3-70b-versatile',  keyHint: 'gsk_...' },
  };

  const getConfig = () => {
    try { return JSON.parse(localStorage.getItem(AI_KEY) || '{}'); } catch { return {}; }
  };
  const setConfig = (cfg) => localStorage.setItem(AI_KEY, JSON.stringify(cfg));
  const clearConfig = () => localStorage.removeItem(AI_KEY);
  const isConfigured = () => {
    const c = getConfig();
    return !!(c.provider && c.apiKey && c.model);
  };

  const generate = async ({ system, user, maxTokens = 400 }) => {
    const cfg = getConfig();
    if (!cfg.provider || !cfg.apiKey || !cfg.model) {
      throw new Error('AI not configured. Click ⚙️ AI in the header.');
    }
    const handler = PROVIDERS[cfg.provider];
    if (!handler) throw new Error(`Unknown provider: ${cfg.provider}`);
    console.log(`[AI] → ${cfg.provider}/${cfg.model} (${user.length} chars in)`);
    const out = await handler({ apiKey: cfg.apiKey, model: cfg.model, system, user, maxTokens });
    console.log(`[AI] ← ${out.length} chars out`);
    return out;
  };

  window.FEUSweep.ai = { PROVIDERS, PROVIDER_META, getConfig, setConfig, clearConfig, isConfigured, generate };
})();
