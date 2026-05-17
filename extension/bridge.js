// Isolated-world bridge: lets MAIN-world tools (like dashboard.js) ask the
// background service worker to inject other tools by posting a window message.
//
//   window.postMessage({ source: 'feu', action: 'inject', tool: 'auto-sweep' }, '*')
//
// The page's MAIN-world script can't reach chrome.runtime; this isolated
// content script can. We forward and post the result back.

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'feu') return;
  if (data.action !== 'inject') return;

  chrome.runtime.sendMessage({ source: 'feu', action: 'inject', tool: data.tool }, (response) => {
    window.postMessage(
      { source: 'feu', kind: 'inject-result', tool: data.tool, ok: !!response?.ok, error: response?.error || null },
      '*',
    );
  });
});
