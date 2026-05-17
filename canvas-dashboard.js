// Canvas Pending-Work Dashboard (favorited courses only, parallel fetch)
// Read-only overlay showing what you still need to do across your starred/card-view courses.
// Usage: log in to feu.instructure.com, press F12, paste this in Console, hit Enter.
// Uses your existing session cookies — no password, no token in this script.

(async () => {
  const BASE = location.origin;
  const STALE_DAYS = 90; // drop assignments due more than this many days ago
  const STALE_CUTOFF = Date.now() - STALE_DAYS * 86400000;

  const fmt = (d) => {
    if (!d) return 'no due date';
    const date = new Date(d), now = new Date(), ms = date - now;
    const days = Math.round(ms / 86400000);
    const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    const str = date.toLocaleString(undefined, opts);
    if (ms < 0) return `${str} (${Math.abs(days)}d OVERDUE)`;
    if (days === 0) return `${str} (TODAY)`;
    if (days === 1) return `${str} (tomorrow)`;
    return `${str} (in ${days}d)`;
  };

  const api = async (path) => {
    const out = [];
    let url = BASE + path + (path.includes('?') ? '&' : '?') + 'per_page=100';
    while (url) {
      const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) { console.warn('[Dashboard] fetch failed', url, res.status); break; }
      const data = await res.json();
      out.push(...(Array.isArray(data) ? data : [data]));
      const link = res.headers.get('Link') || '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }
    return out;
  };

  // ---------- 1. Get only favorited (card-view) courses ----------
  console.log('[Dashboard] Fetching favorited courses (card view)...');
  let favs = await api('/api/v1/users/self/favorites/courses');
  if (!favs.length) {
    console.log('[Dashboard] No favorites — falling back to dashboard_cards.');
    const cards = await api('/api/v1/dashboard/dashboard_cards');
    favs = cards.map(c => ({ id: c.id, name: c.shortName || c.originalName || c.courseCode }));
  }
  const courses = favs.map(c => ({ id: c.id, name: c.name || c.shortName || c.course_code }));
  const cardIds = new Set(courses.map(c => c.id));
  console.log(`[Dashboard] ${courses.length} favorited courses:`, courses.map(c => c.name).join(' | '));

  if (!courses.length) {
    alert('No favorited courses found. Star your current-term subjects on the Canvas dashboard first.');
    return;
  }

  // ---------- 2. Fetch missing submissions + per-course assignments IN PARALLEL ----------
  console.log('[Dashboard] Fetching assignments in parallel...');
  const [missing, ...perCourse] = await Promise.all([
    api('/api/v1/users/self/missing_submissions?include[]=planner_overrides&filter[]=submittable'),
    ...courses.map(c =>
      api(`/api/v1/courses/${c.id}/assignments?bucket=unsubmitted&order_by=due_at`)
        .then(items => items.map(a => ({ ...a, _course: c.name, _courseId: c.id })))
        .catch(e => { console.warn(`[Dashboard] Skipped ${c.name}`, e); return []; })
    ),
  ]);

  const allAssignments = perCourse.flat();
  const missingIds = new Set(missing.map(m => m.id));

  // ---------- 3. Merge + filter ----------
  const byId = new Map();
  for (const a of allAssignments) {
    if (!byId.has(a.id)) byId.set(a.id, a);
  }
  for (const m of missing) {
    if (!cardIds.has(m.course_id)) continue; // ignore old-term carryover
    if (!byId.has(m.id)) {
      m._course = courses.find(c => c.id === m.course_id)?.name || `Course ${m.course_id}`;
      byId.set(m.id, m);
    }
  }

  const items = [...byId.values()]
    .filter(a => !a.has_submitted_submissions)
    .filter(a => !a.locked_for_user)
    .filter(a => !a.due_at || new Date(a.due_at).getTime() > STALE_CUTOFF)
    .map(a => ({
      id: a.id,
      name: a.name,
      course: a._course,
      due: a.due_at,
      points: a.points_possible,
      url: a.html_url,
      missing: missingIds.has(a.id),
    }))
    .sort((x, y) => {
      if (!x.due && !y.due) return 0;
      if (!x.due) return 1;
      if (!y.due) return -1;
      return new Date(x.due) - new Date(y.due);
    });

  // ---------- 4. Render overlay ----------
  document.getElementById('feu-pending-dash')?.remove();
  const panel = document.createElement('div');
  panel.id = 'feu-pending-dash';
  panel.style.cssText = `
    position:fixed;top:16px;right:16px;width:440px;max-height:80vh;overflow:auto;
    background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:10px;
    box-shadow:0 12px 40px rgba(0,0,0,.5);font-family:ui-sans-serif,system-ui,sans-serif;
    z-index:999999;padding:14px 16px;font-size:13px;line-height:1.4;
  `;

  const now = new Date();
  const overdueCount = items.filter(i => i.due && new Date(i.due) < now).length;
  const todayCount = items.filter(i => i.due && new Date(i.due).toDateString() === now.toDateString()).length;

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <strong style="font-size:15px;">Pending Work (${items.length})</strong>
      <button id="feu-dash-close" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;">close</button>
    </div>
    <div style="font-size:11px;opacity:.6;margin-bottom:8px;">Scope: ${courses.length} favorited courses · last ${STALE_DAYS}d + upcoming</div>
    <div style="display:flex;gap:8px;margin-bottom:10px;font-size:12px;">
      <span style="background:#3d1414;border:1px solid #6e2222;padding:2px 8px;border-radius:6px;">${overdueCount} overdue</span>
      <span style="background:#3d3414;border:1px solid #6e5a22;padding:2px 8px;border-radius:6px;">${todayCount} today</span>
      <span style="background:#143d2b;border:1px solid #226e4f;padding:2px 8px;border-radius:6px;">${items.length - overdueCount - todayCount} upcoming</span>
    </div>
    <div id="feu-dash-list"></div>
  `;
  document.body.appendChild(panel);
  panel.querySelector('#feu-dash-close').onclick = () => panel.remove();

  const list = panel.querySelector('#feu-dash-list');
  if (!items.length) {
    list.innerHTML = `<div style="opacity:.7;padding:8px 0;">Nothing pending. Take a break.</div>`;
  } else {
    list.innerHTML = items.map(i => {
      const overdue = i.due && new Date(i.due) < now;
      const accent = overdue ? '#ff6b6b' : (i.missing ? '#ffb84d' : '#7ee787');
      return `
        <div style="border-left:3px solid ${accent};padding:8px 10px;margin-bottom:6px;background:#161b22;border-radius:0 6px 6px 0;">
          <a href="${i.url}" target="_blank" style="color:#79c0ff;text-decoration:none;font-weight:600;">${i.name || '(untitled)'}</a>
          <div style="font-size:11px;opacity:.75;margin-top:2px;">${i.course}</div>
          <div style="font-size:11px;margin-top:4px;display:flex;justify-content:space-between;">
            <span>${fmt(i.due)}</span>
            <span style="opacity:.7;">${i.points ?? 0} pts${i.missing ? ' · MISSING' : ''}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  console.log(`%c[Dashboard] Done. ${items.length} pending (${overdueCount} overdue, ${todayCount} today).`, 'color:#7ee787;font-weight:bold');
  window.FEUPending = items;
  console.log('Full list saved to window.FEUPending');
})();
