// FEU bridge — ISOLATED-world script with chrome.* access.
//
// The dashboard runs in MAIN world (it needs page-level DOM access and has
// to coexist with Canvas's globals), which means it can't talk to
// chrome.storage directly. This file is injected just before the dashboard
// and exposes a request/response channel over window.postMessage.
//
// Protocol — messages are tagged with source: 'feu-bridge' so other code
// on the page can't accidentally trigger it:
//   page → bridge: { source: 'feu-bridge', dir: 'req', id, op, payload }
//   bridge → page: { source: 'feu-bridge', dir: 'res', id, ok, data?, error? }
//
// Supported ops:
//   getPrefs           → { alwaysActiveEnabled, quizFetchEnabled }
//   setPref {key, value} → updates chrome.storage.local, returns the new prefs

(() => {
  if (window.__feuBridgeInstalled) return;
  window.__feuBridgeInstalled = true;

  const DEFAULTS = { alwaysActiveEnabled: true, quizFetchEnabled: true };

  const readPrefs = () => new Promise((resolve) => {
    chrome.storage.local.get(DEFAULTS, (prefs) => resolve({ ...DEFAULTS, ...prefs }));
  });

  const writePref = (key, value) => new Promise((resolve, reject) => {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      reject(new Error(`Unknown pref: ${key}`));
      return;
    }
    chrome.storage.local.set({ [key]: !!value }, async () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(await readPrefs());
    });
  });

  const reply = (id, ok, data, error) => {
    window.postMessage({ source: 'feu-bridge', dir: 'res', id, ok, data, error }, '*');
  };

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window) return;
    const m = ev.data;
    if (!m || m.source !== 'feu-bridge' || m.dir !== 'req') return;
    try {
      if (m.op === 'getPrefs') {
        reply(m.id, true, await readPrefs());
      } else if (m.op === 'setPref') {
        const next = await writePref(m.payload?.key, m.payload?.value);
        reply(m.id, true, next);
      } else {
        reply(m.id, false, null, `Unknown op: ${m.op}`);
      }
    } catch (e) {
      reply(m.id, false, null, e?.message || String(e));
    }
  });

  // Broadcast storage changes so the dashboard can react live.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes.alwaysActiveEnabled && !changes.quizFetchEnabled) return;
    readPrefs().then((prefs) => {
      window.postMessage({ source: 'feu-bridge', dir: 'event', op: 'prefsChanged', data: prefs }, '*');
    });
  });
})();
