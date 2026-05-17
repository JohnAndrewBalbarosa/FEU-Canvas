// Canvas Module Blocker Finder
// Scans the current course's modules and lists every incomplete completion requirement
// that's gating your progress. Shows direct links — you click, you read, you unlock.
// Usage: open ANY page inside the course you're stuck in, F12 → Console → paste → Enter.

(async () => {
  const m = location.pathname.match(/\/courses\/(\d+)/);
  if (!m) {
    alert('Open a course page first (URL must contain /courses/{id}/...).');
    return;
  }
  const courseId = m[1];

  const api = async (path) => {
    const out = [];
    let url = location.origin + path + (path.includes('?') ? '&' : '?') + 'per_page=100';
    while (url) {
      const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) { console.warn('fetch failed', url, res.status); break; }
      const data = await res.json();
      out.push(...(Array.isArray(data) ? data : [data]));
      const link = res.headers.get('Link') || '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }
    return out;
  };

  // Course name for display
  console.log(`%c[Blockers] Scanning course ${courseId}...`, 'color:#79c0ff;font-weight:bold');
  const [courseInfo, modules] = await Promise.all([
    fetch(`/api/v1/courses/${courseId}`, { credentials: 'include' }).then(r => r.json()).catch(() => ({})),
    api(`/api/v1/courses/${courseId}/modules?include[]=items&include[]=content_details`),
  ]);
  const courseName = courseInfo.name || `Course ${courseId}`;

  const TYPE_LABEL = {
    must_view: 'View',
    must_mark_done: 'Mark Done',
    must_contribute: 'Reply / Contribute',
    must_submit: 'Submit',
    min_score: 'Score Min',
    must_complete_requirements: 'Complete Reqs',
  };
  const QUICK_TYPES = new Set(['must_view', 'must_mark_done']);

  const blockers = [];
  for (const mod of modules) {
    if (mod.state === 'completed') continue;
    for (const item of (mod.items || [])) {
      const req = item.completion_requirement;
      if (!req || req.completed) continue;
      blockers.push({
        moduleName: mod.name,
        moduleState: mod.state,
        title: item.title,
        type: req.type,
        url: item.html_url,
        itemType: item.type, // Assignment | Discussion | Quiz | Page | File | ExternalUrl | SubHeader
        quick: QUICK_TYPES.has(req.type),
      });
    }
  }

  // ---------- Render ----------
  document.getElementById('feu-blocker-panel')?.remove();
  const panel = document.createElement('div');
  panel.id = 'feu-blocker-panel';
  panel.style.cssText = `
    position:fixed;top:16px;right:16px;width:460px;max-height:80vh;overflow:auto;
    background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:10px;
    box-shadow:0 12px 40px rgba(0,0,0,.5);font-family:ui-sans-serif,system-ui,sans-serif;
    z-index:999999;padding:14px 16px;font-size:13px;line-height:1.4;
  `;

  const quickCount = blockers.filter(b => b.quick).length;
  const heavyCount = blockers.length - quickCount;

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <strong style="font-size:15px;">Module Blockers (${blockers.length})</strong>
      <button id="feu-bk-close" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;">close</button>
    </div>
    <div style="font-size:11px;opacity:.7;margin-bottom:10px;">${courseName}</div>
    <div style="display:flex;gap:8px;margin-bottom:10px;font-size:12px;">
      <span style="background:#143d2b;border:1px solid #226e4f;padding:2px 8px;border-radius:6px;">${quickCount} quick unlocks</span>
      <span style="background:#3d3414;border:1px solid #6e5a22;padding:2px 8px;border-radius:6px;">${heavyCount} graded/submit</span>
    </div>
    ${blockers.length ? `
      <button id="feu-bk-next" style="width:100%;background:#1f6feb;color:white;border:none;border-radius:6px;padding:8px;cursor:pointer;margin-bottom:10px;font-weight:600;">
        Jump to first blocker →
      </button>
    ` : ''}
    <div id="feu-bk-list"></div>
  `;
  document.body.appendChild(panel);
  panel.querySelector('#feu-bk-close').onclick = () => panel.remove();
  if (blockers.length) {
    panel.querySelector('#feu-bk-next').onclick = () => {
      const target = blockers.find(b => b.quick) || blockers[0];
      location.href = target.url;
    };
  }

  const list = panel.querySelector('#feu-bk-list');
  if (!blockers.length) {
    list.innerHTML = `<div style="opacity:.7;padding:8px 0;">✅ No blockers found. All module requirements satisfied.</div>`;
  } else {
    // Group by module
    const byMod = {};
    for (const b of blockers) (byMod[b.moduleName] ??= []).push(b);

    list.innerHTML = Object.entries(byMod).map(([modName, items]) => `
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;opacity:.7;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px;">${modName}</div>
        ${items.map(b => {
          const accent = b.quick ? '#7ee787' : '#ffb84d';
          const tag = TYPE_LABEL[b.type] || b.type;
          return `
            <div style="border-left:3px solid ${accent};padding:6px 10px;margin-bottom:4px;background:#161b22;border-radius:0 6px 6px 0;">
              <a href="${b.url}" target="_blank" style="color:#79c0ff;text-decoration:none;font-weight:600;">${b.title}</a>
              <div style="font-size:11px;margin-top:2px;display:flex;justify-content:space-between;">
                <span style="opacity:.75;">${b.itemType}</span>
                <span style="color:${accent};">${tag}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `).join('');
  }

  console.log(`%c[Blockers] ${blockers.length} found (${quickCount} quick, ${heavyCount} heavy).`, 'color:#7ee787;font-weight:bold');
  window.FEUBlockers = blockers;
  console.log('Saved to window.FEUBlockers');
})();
