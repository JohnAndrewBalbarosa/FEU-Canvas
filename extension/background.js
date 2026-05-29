// Service worker for FEU Canvas Suite.
//
// Two jobs:
//   1. Keep the vendor content scripts (Always-Active, QuizFetch) registered
//      in sync with the user's toggles stored in chrome.storage.local.
//      Default = both enabled.
//   2. When the toolbar icon is clicked, inject the FEU dashboard into the
//      active Canvas tab — the bridge in ISOLATED world (chrome.* access)
//      and the dashboard modules in MAIN world (page-level DOM access).

const CANVAS_MATCHES = [
  'https://*.instructure.com/*',
  'https://*.edu/*',
];

const QUIZ_MATCHES = [
  '*://*.instructure.com/courses/*/quizzes/*/take*',
  '*://*.instructure.com/courses/*/quizzes/*',
  '*://*.instructure.com/courses/*/*',
  '*://*.edu/courses/*/quizzes/*/take*',
];

const DEFAULT_PREFS = Object.freeze({
  alwaysActiveEnabled: true,
  quizFetchEnabled: true,
});

const DASHBOARD_FILES = [
  'tools/sweep/canvas-api.js',
  'tools/sweep/policy.js',
  'tools/sweep/settings.js',
  'tools/sweep/ai-client.js',
  'tools/sweep/engine.js',
  'tools/sweep/ui.js',
  'tools/dashboard.js',
];

const BRIDGE_FILE = 'tools/bridge.js';

const isCanvasTab = (url) => !!url && /^https:\/\/([^/]+\.)?instructure\.com\//.test(url);

const getPrefs = () => new Promise((resolve) => {
  chrome.storage.local.get(DEFAULT_PREFS, (prefs) => resolve({ ...DEFAULT_PREFS, ...prefs }));
});

const buildScriptSpecs = (prefs) => {
  const specs = [];
  if (prefs.alwaysActiveEnabled) {
    specs.push({
      id: 'feu-aa-isolated',
      matches: CANVAS_MATCHES,
      js: ['vendor/always-active/inject/isolated.js'],
      runAt: 'document_start',
      allFrames: true,
      matchOriginAsFallback: true,
      world: 'ISOLATED',
    });
    specs.push({
      id: 'feu-aa-main',
      matches: CANVAS_MATCHES,
      js: ['vendor/always-active/inject/main.js'],
      runAt: 'document_start',
      allFrames: true,
      matchOriginAsFallback: true,
      world: 'MAIN',
    });
  }
  if (prefs.quizFetchEnabled) {
    specs.push({
      id: 'feu-quizfetch',
      matches: QUIZ_MATCHES,
      js: [
        'vendor/quiz-fetch/browser-polyfill.min.js',
        'vendor/quiz-fetch/src/content/config.js',
        'vendor/quiz-fetch/src/content/themes.js',
        'vendor/quiz-fetch/src/content/storage.js',
        'vendor/quiz-fetch/src/content/index.js',
      ],
      css: ['vendor/quiz-fetch/src/content/index.css'],
      runAt: 'document_idle',
    });
  }
  return specs;
};

const syncContentScripts = async () => {
  const prefs = await getPrefs();
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const ids = existing.map((s) => s.id).filter((id) => id.startsWith('feu-'));
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  } catch (e) {
    console.warn('[FEU] unregister failed', e);
  }
  const specs = buildScriptSpecs(prefs);
  if (!specs.length) return;
  try {
    await chrome.scripting.registerContentScripts(specs);
    console.log('[FEU] content scripts synced:', specs.map((s) => s.id).join(', '));
  } catch (e) {
    console.error('[FEU] register failed', e);
  }
};

chrome.runtime.onInstalled.addListener(syncContentScripts);
chrome.runtime.onStartup.addListener(syncContentScripts);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.alwaysActiveEnabled || changes.quizFetchEnabled) {
    syncContentScripts();
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  if (!isCanvasTab(tab.url)) {
    chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#6e2222' });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 4000);
    return;
  }
  try {
    // Bridge runs in ISOLATED world so it can read/write chrome.storage on
    // behalf of the dashboard (which has to run in MAIN world for DOM access).
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [BRIDGE_FILE],
      world: 'ISOLATED',
    });
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

// Silence the set-icon message Always-Active's isolated.js sends — it expects
// the original worker to respond, here it's optional. No-op listener avoids
// "Unchecked runtime.lastError" warnings.
chrome.runtime.onMessage.addListener((req) => {
  if (req?.method === 'set-icon') return;
});
