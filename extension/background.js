// Service worker — single responsibility: when the toolbar icon is clicked,
// inject the unified dashboard (with its sweep modules pre-loaded) into the
// active Canvas tab. No popup, no in-page message bridge.

const DASHBOARD_FILES = [
  'tools/sweep/canvas-api.js',
  'tools/sweep/policy.js',
  'tools/sweep/settings.js',
  'tools/sweep/ai-client.js',
  'tools/sweep/engine.js',
  'tools/sweep/ui.js',
  'tools/dashboard.js',
];

const isCanvasTab = (url) => !!url && /^https:\/\/([^/]+\.)?instructure\.com\//.test(url);

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  if (!isCanvasTab(tab.url)) {
    chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#6e2222' });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 4000);
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: DASHBOARD_FILES,
      world: 'MAIN',
    });
    chrome.action.setBadgeText({ tabId: tab.id, text: '' });
  } catch (err) {
    console.error('[FEU] dashboard inject failed', err);
    chrome.action.setBadgeText({ tabId: tab.id, text: 'err' });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#6e2222' });
  }
});
