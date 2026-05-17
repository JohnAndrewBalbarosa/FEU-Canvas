// Service worker. Bridges in-page requests (forwarded through bridge.js) to
// chrome.scripting so tools can be launched from inside other injected tools.
// Currently used by the Pending Dashboard to fire up Auto-Sweep without
// requiring the user to round-trip through the popup.

// Keep in sync with popup.js FILE_MAP — array values inject in order.
const INJECTABLE = {
  'auto-sweep': [
    'tools/sweep/canvas-api.js',
    'tools/sweep/policy.js',
    'tools/sweep/ai-client.js',
    'tools/sweep/engine.js',
    'tools/sweep/ui.js',
    'tools/auto-sweep.js',
  ],
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.source !== 'feu') return;
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ ok: false, error: 'no tab id' });
    return;
  }

  if (msg.action === 'inject') {
    const entry = INJECTABLE[msg.tool];
    if (!entry) {
      sendResponse({ ok: false, error: `unknown tool: ${msg.tool}` });
      return;
    }
    const files = Array.isArray(entry) ? entry : [entry];
    chrome.scripting.executeScript({
      target: { tabId },
      files,
      world: 'MAIN',
    }).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: err?.message || String(err) }),
    );
    return true; // keep channel open for async sendResponse
  }
});
