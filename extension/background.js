// Service worker. Bridges in-page requests (forwarded through bridge.js) to
// chrome.scripting so tools can be launched from inside other injected tools.
// Currently used by the Pending Dashboard to fire up Auto-Sweep without
// requiring the user to round-trip through the popup.

const INJECTABLE = {
  'auto-sweep': 'tools/auto-sweep.js',
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.source !== 'feu') return;
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ ok: false, error: 'no tab id' });
    return;
  }

  if (msg.action === 'inject') {
    const file = INJECTABLE[msg.tool];
    if (!file) {
      sendResponse({ ok: false, error: `unknown tool: ${msg.tool}` });
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId },
      files: [file],
      world: 'MAIN',
    }).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: err?.message || String(err) }),
    );
    return true; // keep channel open for async sendResponse
  }
});
