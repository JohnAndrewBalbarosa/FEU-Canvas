// FILE_MAP values can be either a single file path (string) or an array
// of file paths that load in order (used for split tools like Unlock Modules,
// where canvas-api → policy → ai-client → engine → ui must run before the
// entry orchestrator).
const FILE_MAP = {
  dashboard: 'tools/dashboard.js',
  sweep: [
    'tools/sweep/canvas-api.js',
    'tools/sweep/policy.js',
    'tools/sweep/ai-client.js',
    'tools/sweep/engine.js',
    'tools/sweep/ui.js',
    'tools/auto-sweep.js',
  ],
};

const status = document.getElementById('status');
const setStatus = (msg, kind = '') => {
  status.textContent = msg;
  status.className = kind;
};

document.querySelectorAll('button.tool').forEach(btn => {
  btn.addEventListener('click', async () => {
    const tool = btn.dataset.tool;
    const entry = FILE_MAP[tool];
    if (!entry) return;
    const files = Array.isArray(entry) ? entry : [entry];

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.includes('instructure.com')) {
        setStatus('Open a Canvas tab first (feu.instructure.com).', 'err');
        return;
      }
      setStatus(`Injecting ${tool}…`);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files,
        world: 'MAIN',
      });
      setStatus(`✓ ${tool} running. Switch to the Canvas tab.`, 'ok');
      setTimeout(() => window.close(), 800);
    } catch (e) {
      setStatus(`Error: ${e.message}`, 'err');
      console.error(e);
    }
  });
});
