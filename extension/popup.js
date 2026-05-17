const FILE_MAP = {
  dashboard: 'tools/dashboard.js',
  sweep: 'tools/auto-sweep.js',
};

const status = document.getElementById('status');
const setStatus = (msg, kind = '') => {
  status.textContent = msg;
  status.className = kind;
};

document.querySelectorAll('button.tool').forEach(btn => {
  btn.addEventListener('click', async () => {
    const tool = btn.dataset.tool;
    const file = FILE_MAP[tool];
    if (!file) return;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.includes('instructure.com')) {
        setStatus('Open a Canvas tab first (feu.instructure.com).', 'err');
        return;
      }
      setStatus(`Injecting ${tool}…`);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [file],
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
