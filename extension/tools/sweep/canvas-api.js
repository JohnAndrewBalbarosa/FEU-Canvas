// Canvas HTTP layer — pure transport.
//
// No knowledge of modules, items, completion-requirements, or Canvas policy.
// This file should outlive the rest; only change it if Canvas itself changes
// how its REST API works (auth, pagination, headers).
//
// Exports onto window.FEUSweep.api:
//   BASE          — origin (e.g. "https://feu.instructure.com")
//   apiList(path) — paginated GET, browser cache OK. Fast scans.
//   apiListFresh  — paginated GET, cache-bypassing. Use after writes
//                   so Canvas can't hand back stale module state.
//   csrf()        — pulls the X-CSRF-Token from cookie/meta/form
//   sleep(ms)     — await-able delay
//   limit(n)      — concurrency limiter factory (e.g. const cap = limit(3))

(() => {
  window.FEUSweep = window.FEUSweep || {};
  const BASE = location.origin;

  const apiList = async (path) => {
    const out = [];
    let url = BASE + path + (path.includes('?') ? '&' : '?') + 'per_page=100';
    while (url) {
      const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) { console.warn('[Sweep] fetch failed', url, res.status); break; }
      const data = await res.json();
      out.push(...(Array.isArray(data) ? data : [data]));
      const link = res.headers.get('Link') || '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }
    return out;
  };

  const apiListFresh = async (path) => {
    const out = [];
    const buster = `_=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let url = BASE + path + (path.includes('?') ? '&' : '?') + 'per_page=100&' + buster;
    while (url) {
      const res = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) { console.warn('[Sweep] fresh fetch failed', url, res.status); break; }
      const data = await res.json();
      out.push(...(Array.isArray(data) ? data : [data]));
      const link = res.headers.get('Link') || '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }
    return out;
  };

  const csrf = () => {
    const cookieMatch = document.cookie.match(/_csrf_token=([^;]+)/);
    if (cookieMatch) return decodeURIComponent(cookieMatch[1]);
    const meta = document.querySelector('meta[name="csrf-token"]')?.content;
    if (meta) return meta;
    const input = document.querySelector('input[name="authenticity_token"]')?.value;
    if (input) return input;
    return '';
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const limit = (n) => {
    let active = 0; const q = [];
    const next = () => { if (q.length && active < n) { active++; q.shift()().finally(() => { active--; next(); }); } };
    return (fn) => new Promise((res, rej) => { q.push(() => fn().then(res, rej)); next(); });
  };

  window.FEUSweep.api = { BASE, apiList, apiListFresh, csrf, sleep, limit };
})();
