// Canvas Auto-Unlock — bulk-completes must_view + must_mark_done across all favorited courses.
// Uses official Canvas APIs (mark_read / done). Does NOT touch discussions, submissions, or quizzes.
// Always shows a preview and requires explicit confirmation before mutating anything.

(async () => {
  const BASE = location.origin;

  const api = async (path, init = {}) => {
    const url = BASE + path + (path.includes('?') ? '&' : '?') + 'per_page=100';
    const res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...(init.headers || {}) },
      ...init,
    });
    return res;
  };

  const apiList = async (path) => {
    const out = [];
    let url = BASE + path + (path.includes('?') ? '&' : '?') + 'per_page=100';
    while (url) {
      const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) { console.warn('[Unlock] fetch failed', url, res.status); break; }
      const data = await res.json();
      out.push(...(Array.isArray(data) ? data : [data]));
      const link = res.headers.get('Link') || '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }
    return out;
  };

  const csrf = () => {
    const m = document.cookie.match(/_csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  };

  // Concurrency limiter (avoid hammering Canvas)
  const limit = (n) => {
    let active = 0; const queue = [];
    const next = () => { if (queue.length && active < n) { active++; const fn = queue.shift(); fn().finally(() => { active--; next(); }); } };
    return (fn) => new Promise((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject));
      next();
    });
  };
  const cap = limit(3);

  // ---------- Panel ----------
  document.getElementById('feu-unlock')?.remove();
  const panel = document.createElement('div');
  panel.id = 'feu-unlock';
  panel.style.cssText = `
    position:fixed;top:16px;right:16px;width:540px;max-height:88vh;overflow:auto;
    background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:10px;
    box-shadow:0 12px 40px rgba(0,0,0,.5);font-family:ui-sans-serif,system-ui,sans-serif;
    z-index:999999;padding:14px 16px;font-size:13px;line-height:1.4;
  `;
  panel.innerHTML = `<div id="ul-root">Loading… scanning favorited courses…</div>`;
  document.body.appendChild(panel);
  const root = () => panel.querySelector('#ul-root');

  // ---------- 1. Get favorited courses ----------
  let favs = await apiList('/api/v1/users/self/favorites/courses');
  if (!favs.length) {
    const cards = await apiList('/api/v1/dashboard/dashboard_cards');
    favs = cards.map(c => ({ id: c.id, name: c.shortName || c.originalName || c.courseCode }));
  }
  const courses = favs.map(c => ({ id: c.id, name: c.name || c.shortName || c.course_code }));

  if (!courses.length) {
    root().innerHTML = '<div style="color:#ff6b6b;">No favorited courses found.</div>';
    return;
  }

  // ---------- 2. Scan modules per course ----------
  root().innerHTML = `Scanning ${courses.length} courses in parallel…`;

  const QUICK_TYPES = new Set(['must_view', 'must_mark_done']);
  const HEAVY_TYPES = new Set(['must_contribute', 'must_submit', 'min_score']);

  const allModules = await Promise.all(
    courses.map(c => apiList(`/api/v1/courses/${c.id}/modules?include[]=items`).catch(() => []).then(m => ({ course: c, modules: m })))
  );

  const queue = []; // items to auto-complete
  const heavyList = []; // items to surface manually

  for (const { course, modules } of allModules) {
    for (const mod of modules) {
      if (mod.state === 'completed') continue;
      for (const item of (mod.items || [])) {
        const req = item.completion_requirement;
        if (!req || req.completed) continue;

        const record = {
          courseId: course.id,
          courseName: course.name,
          moduleId: mod.id,
          moduleName: mod.name,
          itemId: item.id,
          title: item.title,
          itemType: item.type,
          reqType: req.type,
          url: item.html_url,
        };

        if (QUICK_TYPES.has(req.type)) queue.push(record);
        else if (HEAVY_TYPES.has(req.type)) heavyList.push(record);
      }
    }
  }

  // ---------- 3. Show preview, wait for confirmation ----------
  const byCourse = {};
  for (const q of queue) (byCourse[q.courseName] ??= []).push(q);

  const heavyHtml = heavyList.length ? `
    <div style="margin-top:14px;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;">Skipped (needs manual handling — ${heavyList.length})</div>
    ${heavyList.slice(0, 20).map(h => `
      <div style="border-left:3px solid #ffb84d;padding:5px 10px;margin:3px 0;background:#161b22;border-radius:0 6px 6px 0;">
        <a href="${h.url}" target="_blank" style="color:#79c0ff;text-decoration:none;font-size:12px;">${h.title}</a>
        <div style="font-size:10.5px;margin-top:2px;display:flex;justify-content:space-between;opacity:.8;">
          <span>${h.courseName} · ${h.itemType}</span>
          <span style="color:#ffb84d;">${h.reqType}</span>
        </div>
      </div>
    `).join('')}
    ${heavyList.length > 20 ? `<div style="font-size:11px;opacity:.6;margin-top:4px;">+${heavyList.length - 20} more…</div>` : ''}
  ` : '';

  root().innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <strong style="font-size:15px;">Auto-Unlock Preview</strong>
      <button id="ul-close" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;">×</button>
    </div>
    <div style="font-size:11px;opacity:.7;margin-bottom:10px;">Scanned ${courses.length} favorited courses</div>

    <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:600;color:#7ee787;margin-bottom:4px;">Ready to auto-complete ${queue.length} items</div>
      <div style="font-size:11px;opacity:.75;">Only <code style="background:#161b22;padding:1px 4px;border-radius:3px;">must_view</code> + <code style="background:#161b22;padding:1px 4px;border-radius:3px;">must_mark_done</code> — pure click-acknowledgment gates. No discussions, submissions, or quizzes.</div>
    </div>

    ${Object.keys(byCourse).length ? Object.entries(byCourse).map(([name, items]) => `
      <details style="margin-bottom:8px;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:6px 10px;">
        <summary style="cursor:pointer;font-size:12px;font-weight:600;">${name} <span style="opacity:.6;font-weight:400;">(${items.length})</span></summary>
        <div style="margin-top:6px;">
          ${items.slice(0, 30).map(i => `
            <div style="font-size:11px;padding:3px 0;opacity:.85;">
              <span style="color:#7ee787;">${i.reqType === 'must_view' ? '👁' : '✓'}</span>
              ${i.title} <span style="opacity:.6;">· ${i.moduleName}</span>
            </div>
          `).join('')}
          ${items.length > 30 ? `<div style="font-size:11px;opacity:.6;">+${items.length - 30} more…</div>` : ''}
        </div>
      </details>
    `).join('') : '<div style="opacity:.7;padding:14px 0;text-align:center;">No auto-completable items found. Everything quick is already done.</div>'}

    ${heavyHtml}

    <div style="margin-top:14px;display:flex;gap:8px;">
      <button id="ul-run" ${queue.length ? '' : 'disabled'} style="flex:1;background:${queue.length ? '#1f6feb' : '#30363d'};color:white;border:none;border-radius:6px;padding:8px;cursor:${queue.length ? 'pointer' : 'not-allowed'};font-weight:600;">
        Run auto-unlock (${queue.length})
      </button>
      <button id="ul-cancel" style="flex:0 0 auto;background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:8px 14px;cursor:pointer;">Cancel</button>
    </div>
  `;

  panel.querySelector('#ul-close').onclick = () => panel.remove();
  panel.querySelector('#ul-cancel').onclick = () => panel.remove();

  if (!queue.length) return;

  panel.querySelector('#ul-run').onclick = async () => {
    const runBtn = panel.querySelector('#ul-run');
    runBtn.disabled = true;
    runBtn.textContent = 'Running…';
    runBtn.style.background = '#30363d';
    runBtn.style.cursor = 'not-allowed';

    const token = csrf();
    let done = 0, failed = 0;
    const results = [];

    const progress = document.createElement('div');
    progress.style.cssText = 'margin-top:10px;font-size:12px;font-family:ui-monospace,monospace;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px;max-height:200px;overflow:auto;';
    progress.innerHTML = '<div id="ul-progress">Starting…</div><div id="ul-log"></div>';
    panel.appendChild(progress);
    const setProg = (txt) => { progress.querySelector('#ul-progress').textContent = txt; };
    const log = (msg, color = '#8b949e') => {
      const d = document.createElement('div');
      d.style.color = color;
      d.style.fontSize = '11px';
      d.textContent = msg;
      progress.querySelector('#ul-log').appendChild(d);
      progress.scrollTop = progress.scrollHeight;
    };

    await Promise.all(queue.map(item => cap(async () => {
      try {
        const path = item.reqType === 'must_view'
          ? `/api/v1/courses/${item.courseId}/modules/${item.moduleId}/items/${item.itemId}/mark_read`
          : `/api/v1/courses/${item.courseId}/modules/${item.moduleId}/items/${item.itemId}/done`;
        const method = item.reqType === 'must_view' ? 'POST' : 'PUT';

        const res = await fetch(BASE + path, {
          method,
          credentials: 'include',
          headers: { 'X-CSRF-Token': token, Accept: 'application/json' },
        });
        if (res.ok) {
          done++;
          log(`✓ ${item.title.slice(0, 60)}`, '#7ee787');
          results.push({ ...item, ok: true });
        } else {
          failed++;
          log(`✗ ${item.title.slice(0, 60)} (${res.status})`, '#ff6b6b');
          results.push({ ...item, ok: false, status: res.status });
        }
      } catch (e) {
        failed++;
        log(`✗ ${item.title.slice(0, 60)} (${e.message})`, '#ff6b6b');
        results.push({ ...item, ok: false, error: e.message });
      }
      setProg(`${done + failed} / ${queue.length} · ${done} ok · ${failed} failed`);
    })));

    setProg(`Done. ${done} completed · ${failed} failed.`);
    runBtn.textContent = `Done — ${done} unlocked`;
    runBtn.style.background = '#143d2b';

    // Invalidate dashboard cache so re-opening shows fresh state
    try { localStorage.removeItem('feuDashCache'); } catch {}

    window.FEUUnlockResults = results;
    console.log(`%c[Unlock] ${done}/${queue.length} completed. Results in window.FEUUnlockResults`, 'color:#7ee787;font-weight:bold');
  };
})();
