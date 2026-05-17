// Canvas Unified Dashboard — bento grid of courses with stateful cache.
// Read-only. Session cookies only. Cache via localStorage (5-min TTL).

(async () => {
  const BASE = location.origin;
  const STALE_DAYS = 90;
  const STALE_CUTOFF = Date.now() - STALE_DAYS * 86400000;
  const CACHE_KEY = 'feuDashCache';
  const CACHE_TTL_MS = 5 * 60 * 1000;

  // ---------- helpers ----------
  const fmt = (d) => {
    if (!d) return 'no due';
    const date = new Date(d), now = new Date(), ms = date - now;
    const days = Math.round(ms / 86400000);
    const str = date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (ms < 0) return `${str} · ${Math.abs(days)}d OVERDUE`;
    if (days === 0) return `${str} · TODAY`;
    if (days === 1) return `${str} · tomorrow`;
    return `${str} · in ${days}d`;
  };

  const fmtAge = (ms) => {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  };

  const api = async (path) => {
    const out = [];
    let url = BASE + path + (path.includes('?') ? '&' : '?') + 'per_page=100';
    while (url) {
      const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) { console.warn('[Dash] fetch failed', url, res.status); break; }
      const data = await res.json();
      out.push(...(Array.isArray(data) ? data : [data]));
      const link = res.headers.get('Link') || '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }
    return out;
  };

  const TYPE_LABEL = {
    must_view: 'View',
    must_mark_done: 'Mark Done',
    must_contribute: 'Reply',
    must_submit: 'Submit',
    min_score: 'Score',
  };
  const QUICK = new Set(['must_view', 'must_mark_done']);

  // Category classifier (FEU naming patterns + Canvas item types + points heuristic)
  const CAT = {
    SOCIAL: { label: 'Social', color: '#a371f7' },
    REFLECTION: { label: 'Reflection', color: '#79c0ff' },
    FORMATIVE: { label: 'Formative', color: '#7ee787' },
    SUMMATIVE: { label: 'Summative', color: '#ff6b6b' },
    ACTIVITY: { label: 'Activity', color: '#ffb84d' },
    READING: { label: 'Reading', color: '#8b949e' },
  };
  const categorize = ({ name, itemType, type, points }) => {
    const t = (name || '').toLowerCase();
    if (/fellow\s*itammaraw|introduce yourself|introduction discussion|getting to know|\bintro\b/i.test(t)) return CAT.SOCIAL;
    if (/end of module|wrap.?up|reflection|what.+(learn|takeaway)|module recap|conclusion/i.test(t)) return CAT.REFLECTION;
    if (/\bsa\s*\d|summative|major exam|prelim|midterm|\bfinal(s|\s*exam|\s*assessment)?\b|\bexam\b/i.test(t)) return CAT.SUMMATIVE;
    if (/\bfa\s*\d|formative|practice|self.?check|checkup|drill|quiz\s*\d/i.test(t)) return CAT.FORMATIVE;
    // Fall back by Canvas item type
    if (itemType === 'Quiz') return points && points >= 50 ? CAT.SUMMATIVE : CAT.FORMATIVE;
    if (itemType === 'Assignment') return points && points >= 50 ? CAT.SUMMATIVE : CAT.ACTIVITY;
    if (itemType === 'Discussion' || type === 'must_contribute') return CAT.REFLECTION;
    if (itemType === 'Page' || itemType === 'File' || type === 'must_view') return CAT.READING;
    return CAT.ACTIVITY;
  };
  const chip = (cat) => `<span style="background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}55;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">${cat.label}</span>`;

  // ---------- cache ----------
  const readCache = () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c?.fetchedAt || !c?.courseData) return null;
      return c;
    } catch { return null; }
  };
  const writeCache = (courseData) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), courseData }));
    } catch (e) { console.warn('[Dash] cache write failed', e); }
  };
  const clearCache = () => { try { localStorage.removeItem(CACHE_KEY); } catch {} };

  // ---------- fetch fresh ----------
  const fetchFresh = async () => {
    let favs = await api('/api/v1/users/self/favorites/courses');
    if (!favs.length) {
      const cards = await api('/api/v1/dashboard/dashboard_cards');
      favs = cards.map(c => ({ id: c.id, name: c.shortName || c.originalName || c.courseCode }));
    }
    const courses = favs.map(c => ({ id: c.id, name: c.name || c.shortName || c.course_code }));
    if (!courses.length) return [];

    return await Promise.all(courses.map(async (c) => {
      const [assigns, modules] = await Promise.all([
        api(`/api/v1/courses/${c.id}/assignments?bucket=unsubmitted&order_by=due_at`).catch(() => []),
        api(`/api/v1/courses/${c.id}/modules?include[]=items&include[]=content_details`).catch(() => []),
      ]);

      const pending = assigns
        .filter(a => !a.has_submitted_submissions && !a.locked_for_user)
        .filter(a => !a.due_at || new Date(a.due_at).getTime() > STALE_CUTOFF)
        .map(a => ({ id: a.id, name: a.name, due: a.due_at, points: a.points_possible, url: a.html_url }))
        .sort((x, y) => (new Date(x.due || '9999') - new Date(y.due || '9999')));

      const blockers = [];
      for (const mod of modules) {
        if (mod.state === 'completed') continue;
        for (const item of (mod.items || [])) {
          const req = item.completion_requirement;
          if (!req || req.completed) continue;
          blockers.push({
            moduleName: mod.name,
            title: item.title,
            type: req.type,
            url: item.html_url,
            itemType: item.type,
            quick: QUICK.has(req.type),
          });
        }
      }

      return { course: c, pending, blockers };
    }));
  };

  // ---------- panel scaffold ----------
  document.getElementById('feu-dash')?.remove();
  const panel = document.createElement('div');
  panel.id = 'feu-dash';
  panel.style.cssText = `
    position:fixed;top:16px;right:16px;width:540px;max-height:88vh;overflow:auto;
    background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:10px;
    box-shadow:0 12px 40px rgba(0,0,0,.5);font-family:ui-sans-serif,system-ui,sans-serif;
    z-index:999999;padding:14px 16px;font-size:13px;line-height:1.4;
  `;
  panel.innerHTML = `<div id="feu-dash-root" style="opacity:.85;">Loading…</div>`;
  document.body.appendChild(panel);
  const root = () => panel.querySelector('#feu-dash-root');

  // ---------- render ----------
  const urgencyColor = (pending) => {
    const now = new Date();
    if (pending.some(p => p.due && new Date(p.due) < now)) return '#ff6b6b';
    if (pending.some(p => p.due && new Date(p.due).toDateString() === now.toDateString())) return '#ffb84d';
    if (pending.length || true) return '#7ee787';
    return '#30363d';
  };

  const renderCard = (d, idx) => {
    const { course, pending, blockers } = d;
    const now = new Date();
    const overdueCount = pending.filter(p => p.due && new Date(p.due) < now).length;
    const todayCount = pending.filter(p => p.due && new Date(p.due).toDateString() === now.toDateString()).length;
    const isEmpty = !pending.length && !blockers.length;
    const stripe = isEmpty ? '#30363d' : urgencyColor(pending);
    const opacity = isEmpty ? '.5' : '1';

    let warn = '';
    if (overdueCount) warn = `<div style="font-size:11px;color:#ff6b6b;margin-top:2px;">⚠ ${overdueCount} OVERDUE</div>`;
    else if (todayCount) warn = `<div style="font-size:11px;color:#ffb84d;margin-top:2px;">⏰ ${todayCount} due today</div>`;

    return `
      <div class="feu-card" data-idx="${idx}" style="
        border:1px solid #30363d;border-left:4px solid ${stripe};border-radius:8px;
        background:#161b22;padding:10px 12px;cursor:pointer;opacity:${opacity};
        transition:transform .08s, border-color .15s;
      ">
        <div style="font-weight:600;font-size:12.5px;color:#e6edf3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${course.name}</div>
        <div style="font-size:11px;opacity:.75;margin-top:4px;">${pending.length} pending · ${blockers.length} blkrs</div>
        ${warn}
      </div>`;
  };

  const renderModal = (d) => {
    const { course, pending, blockers } = d;
    const now = new Date();
    const firstQuick = blockers.find(b => b.quick);
    const firstBlocker = firstQuick || blockers[0];

    const pendingHtml = pending.map(p => {
      const isOverdue = p.due && new Date(p.due) < now;
      const accent = isOverdue ? '#ff6b6b' : '#7ee787';
      const cat = categorize({ name: p.name, itemType: 'Assignment', points: p.points });
      return `
        <div style="border-left:3px solid ${accent};padding:6px 10px;margin:4px 0;background:#161b22;border-radius:0 6px 6px 0;">
          <div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start;">
            <a href="${p.url}" target="_blank" style="color:#79c0ff;text-decoration:none;font-weight:600;font-size:12px;flex:1;">${p.name || '(untitled)'}</a>
            ${chip(cat)}
          </div>
          <div style="font-size:10.5px;margin-top:2px;display:flex;justify-content:space-between;opacity:.8;">
            <span>${fmt(p.due)}</span>
            <span>${p.points ?? 0} pts</span>
          </div>
        </div>`;
    }).join('');

    // Group blockers by module — each module collapsible, collapsed by default
    const byMod = {};
    for (const b of blockers) (byMod[b.moduleName] ??= []).push(b);
    const blockerHtml = Object.entries(byMod).map(([modName, items]) => `
      <details style="margin-top:6px;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:6px 10px;">
        <summary style="cursor:pointer;font-size:11.5px;font-weight:600;color:#8b949e;list-style:none;text-transform:uppercase;letter-spacing:.5px;">
          ${modName}
          <span style="float:right;font-weight:400;opacity:.7;">${items.length}</span>
        </summary>
        <div style="margin-top:6px;">
          ${items.map(b => {
            const accent = b.quick ? '#7ee787' : '#ffb84d';
            const tag = TYPE_LABEL[b.type] || b.type;
            const cat = categorize({ name: b.title, itemType: b.itemType, type: b.type });
            return `
              <div style="border-left:3px solid ${accent};padding:5px 10px;margin:3px 0;background:#0d1117;border-radius:0 6px 6px 0;">
                <div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start;">
                  <a href="${b.url}" target="_blank" style="color:#79c0ff;text-decoration:none;font-size:12px;flex:1;">${b.title}</a>
                  ${chip(cat)}
                </div>
                <div style="font-size:10.5px;margin-top:2px;display:flex;justify-content:space-between;opacity:.8;">
                  <span>${b.itemType}</span>
                  <span style="color:${accent};">${tag}</span>
                </div>
              </div>`;
          }).join('')}
        </div>
      </details>
    `).join('');

    return `
      <button id="feu-back" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;margin-bottom:10px;">← All courses</button>
      <div style="font-weight:700;font-size:15px;margin-bottom:8px;">${course.name}</div>
      ${blockers.length ? `
        <div style="display:flex;gap:6px;margin-bottom:12px;">
          <button id="feu-sweep" style="flex:1;background:#1f6feb;color:white;border:none;border-radius:6px;padding:7px;cursor:pointer;font-size:12px;font-weight:600;">🪄 Auto-Sweep</button>
          <button id="feu-autonext" ${firstBlocker ? `data-url="${firstBlocker.url}"` : 'disabled'} style="flex:1;background:${firstBlocker ? '#a371f7' : '#30363d'};color:white;border:none;border-radius:6px;padding:7px;cursor:${firstBlocker ? 'pointer' : 'not-allowed'};font-size:12px;font-weight:600;">⏭ Autonext</button>
        </div>
        <div id="feu-action-status" style="font-size:10.5px;opacity:.7;margin:-6px 0 10px;min-height:13px;"></div>
      ` : ''}
      ${pending.length ? `
        <details style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px 10px;margin-bottom:8px;">
          <summary style="cursor:pointer;font-size:12px;font-weight:600;color:#7ee787;list-style:none;">
            Pending Assignments <span style="opacity:.7;font-weight:400;">(${pending.length})</span>
          </summary>
          <div style="margin-top:6px;">${pendingHtml}</div>
        </details>` : ''}
      ${blockers.length ? `
        <details style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px 10px;">
          <summary style="cursor:pointer;font-size:12px;font-weight:600;color:#ffb84d;list-style:none;">
            Module Blockers <span style="opacity:.7;font-weight:400;">(${blockers.length})</span>
          </summary>
          <div style="margin-top:6px;">${blockerHtml}</div>
        </details>` : ''}
      ${!pending.length && !blockers.length ? '<div style="opacity:.7;padding:20px 0;text-align:center;">Nothing pending for this course.</div>' : ''}
    `;
  };

  const readSweep = () => {
    try {
      const raw = localStorage.getItem('feuLastSweep');
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s?.at || Date.now() - s.at > 60 * 60 * 1000) return null; // only show within 1 hour
      return s;
    } catch { return null; }
  };

  const renderSweepBanner = (sweep) => {
    if (!sweep || !sweep.unlocked?.length) return '';
    const ageMin = Math.max(1, Math.floor((Date.now() - sweep.at) / 60000));
    const byCat = {};
    for (const u of sweep.unlocked) (byCat[u.cat.key] ??= { cat: u.cat, count: 0 }).count++;
    const cats = Object.values(byCat)
      .map(({ cat, count }) => `<span style="background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}55;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">${cat.label} ${count}</span>`)
      .join(' ');
    return `
      <div id="feu-sweep-banner" style="background:#0d2818;border:1px solid #226e4f;border-radius:8px;padding:8px 10px;margin-bottom:10px;cursor:pointer;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:12px;font-weight:600;color:#7ee787;">🪄 Auto-Sweep unlocked ${sweep.unlocked.length} items · ${ageMin}m ago</div>
          <span style="font-size:10px;opacity:.6;">click to view</span>
        </div>
        <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">${cats}</div>
        ${sweep.manualPending ? `<div style="font-size:11px;color:#ffb84d;margin-top:6px;">${sweep.manualPending} items still need manual handling</div>` : ''}
      </div>`;
  };

  const renderSweepModal = (sweep) => {
    const byCat = {};
    for (const u of sweep.unlocked) (byCat[u.cat.key] ??= { cat: u.cat, items: [] }).items.push(u);
    return `
      <button id="feu-back" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;margin-bottom:10px;">← All courses</button>
      <div style="font-weight:700;font-size:15px;margin-bottom:8px;">🪄 Last sweep · ${sweep.unlocked.length} items unlocked</div>
      ${Object.values(byCat).map(({ cat, items }) => `
        <div style="font-size:11px;color:${cat.color};margin-top:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">${cat.label} (${items.length})</div>
        ${items.map(u => `
          <div style="border-left:3px solid ${cat.color};padding:5px 10px;margin:3px 0;background:#161b22;border-radius:0 6px 6px 0;">
            <a href="${u.url}" target="_blank" style="color:#79c0ff;text-decoration:none;font-size:12px;">${u.title}</a>
            <div style="font-size:10.5px;margin-top:2px;opacity:.7;">${u.courseName} · ${u.moduleName}</div>
          </div>
        `).join('')}
      `).join('')}
    `;
  };

  const renderMain = (courseData, fetchedAt) => {
    const sweep = readSweep();
    const totalPending = courseData.reduce((s, d) => s + d.pending.length, 0);
    const totalBlockers = courseData.reduce((s, d) => s + d.blockers.length, 0);
    const quickWins = courseData.reduce((s, d) => s + d.blockers.filter(b => b.quick).length, 0);
    const now = new Date();
    const overdue = courseData.reduce((s, d) => s + d.pending.filter(p => p.due && new Date(p.due) < now).length, 0);
    const today = courseData.reduce((s, d) => s + d.pending.filter(p => p.due && new Date(p.due).toDateString() === now.toDateString()).length, 0);

    // Sort: overdue first, then today, then by total pending+blockers, then empty
    const scored = courseData.map((d, idx) => {
      const ov = d.pending.filter(p => p.due && new Date(p.due) < now).length;
      const td = d.pending.filter(p => p.due && new Date(p.due).toDateString() === now.toDateString()).length;
      const empty = !d.pending.length && !d.blockers.length;
      return { d, idx, score: ov * 1000 + td * 100 + d.pending.length + d.blockers.length, empty };
    }).sort((a, b) => {
      if (a.empty !== b.empty) return a.empty ? 1 : -1;
      return b.score - a.score;
    });

    const cards = scored.map(s => renderCard(s.d, s.idx)).join('');
    const age = fmtAge(Date.now() - fetchedAt);

    root().innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <strong style="font-size:15px;">FEU Canvas — Pending Work</strong>
        <div style="display:flex;gap:4px;align-items:center;">
          <span style="font-size:10px;opacity:.6;margin-right:4px;">cached ${age}</span>
          <button id="feu-refresh" title="Refresh" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;">⟳</button>
          <button id="feu-close" title="Close" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;">×</button>
        </div>
      </div>
      <div style="font-size:11px;opacity:.7;margin-bottom:10px;">${courseData.length} favorited courses</div>

      ${renderSweepBanner(sweep)}

      <div style="display:flex;gap:6px;margin-bottom:12px;font-size:11px;flex-wrap:wrap;">
        <span style="background:#3d1414;border:1px solid #6e2222;padding:2px 8px;border-radius:6px;">${overdue} overdue</span>
        <span style="background:#3d3414;border:1px solid #6e5a22;padding:2px 8px;border-radius:6px;">${today} today</span>
        <span style="background:#143d2b;border:1px solid #226e4f;padding:2px 8px;border-radius:6px;">${totalPending} total pending</span>
        <span style="background:#1f2a3d;border:1px solid #2f4a6e;padding:2px 8px;border-radius:6px;">${totalBlockers} blockers (${quickWins} quick)</span>
      </div>

      <div id="feu-bento" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${cards || '<div style="grid-column:1/-1;opacity:.7;padding:20px 0;text-align:center;">Nothing pending. Take a break.</div>'}
      </div>
      <div id="feu-modal" style="display:none;"></div>
    `;

    // Wire up
    panel.querySelector('#feu-close').onclick = () => panel.remove();
    panel.querySelector('#feu-refresh').onclick = async () => {
      clearCache();
      root().innerHTML = '<div style="opacity:.85;">Refreshing…</div>';
      const fresh = await fetchFresh();
      writeCache(fresh);
      renderMain(fresh, Date.now());
    };

    const sweepBanner = panel.querySelector('#feu-sweep-banner');
    if (sweepBanner && sweep) {
      sweepBanner.onclick = () => {
        const bento = panel.querySelector('#feu-bento');
        const modal = panel.querySelector('#feu-modal');
        bento.style.display = 'none';
        modal.style.display = 'block';
        modal.innerHTML = renderSweepModal(sweep);
        panel.querySelector('#feu-back').onclick = () => {
          modal.style.display = 'none'; modal.innerHTML = '';
          bento.style.display = 'grid';
        };
      };
    }

    panel.querySelectorAll('.feu-card').forEach(card => {
      card.onmouseenter = () => { card.style.borderColor = '#1f6feb'; };
      card.onmouseleave = () => { card.style.borderColor = '#30363d'; };
      card.onclick = () => {
        const idx = parseInt(card.dataset.idx, 10);
        openModal(courseData[idx]);
      };
    });

    window.FEUData = courseData;
  };

  const openModal = (d) => {
    const bento = panel.querySelector('#feu-bento');
    const modal = panel.querySelector('#feu-modal');
    bento.style.display = 'none';
    modal.style.display = 'block';
    modal.innerHTML = renderModal(d);

    panel.querySelector('#feu-back').onclick = () => {
      modal.style.display = 'none';
      modal.innerHTML = '';
      bento.style.display = 'grid';
    };

    const setActionStatus = (text, color) => {
      const el = panel.querySelector('#feu-action-status');
      if (!el) return;
      el.textContent = text || '';
      if (color) el.style.color = color;
    };

    const sweepBtn = panel.querySelector('#feu-sweep');
    if (sweepBtn) {
      sweepBtn.onclick = () => {
        sweepBtn.disabled = true;
        sweepBtn.textContent = '🪄 launching…';
        setActionStatus('Asking the extension to inject Auto-Sweep…', '#8b949e');
        const handler = (ev) => {
          if (ev.source !== window) return;
          const data = ev.data;
          if (!data || data.source !== 'feu' || data.kind !== 'inject-result' || data.tool !== 'auto-sweep') return;
          window.removeEventListener('message', handler);
          if (data.ok) {
            setActionStatus('✓ Auto-Sweep panel opened. (You can close this dashboard.)', '#7ee787');
            sweepBtn.textContent = '✓ launched';
          } else {
            setActionStatus(`Failed: ${data.error || 'unknown'}. Try the popup button instead.`, '#ff6b6b');
            sweepBtn.disabled = false;
            sweepBtn.textContent = '🪄 Auto-Sweep';
          }
        };
        window.addEventListener('message', handler);
        window.postMessage({ source: 'feu', action: 'inject', tool: 'auto-sweep' }, '*');
        // Safety: if no reply in 3s, restore the button.
        setTimeout(() => {
          if (sweepBtn.disabled && sweepBtn.textContent === '🪄 launching…') {
            window.removeEventListener('message', handler);
            setActionStatus('No reply from bridge. Reload the extension at chrome://extensions.', '#ff6b6b');
            sweepBtn.disabled = false;
            sweepBtn.textContent = '🪄 Auto-Sweep';
          }
        }, 3000);
      };
    }

    const anBtn = panel.querySelector('#feu-autonext');
    if (anBtn && !anBtn.disabled) {
      anBtn.onclick = () => {
        const url = anBtn.dataset.url;
        if (!url) return;
        sessionStorage.setItem('feuAutonext', '1');
        setActionStatus('Autonext armed. Navigating to first blocker — runner will take over.', '#a371f7');
        anBtn.textContent = '⏭ navigating…';
        anBtn.disabled = true;
        setTimeout(() => { location.href = url; }, 250);
      };
    }
  };

  // ---------- bootstrap ----------
  const cached = readCache();
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    renderMain(cached.courseData, cached.fetchedAt);
    console.log(`%c[Dash] Loaded from cache (${fmtAge(Date.now() - cached.fetchedAt)})`, 'color:#7ee787');
  } else {
    root().innerHTML = '<div style="opacity:.85;">Loading… iterating favorited courses in parallel…</div>';
    const fresh = await fetchFresh();
    writeCache(fresh);
    renderMain(fresh, Date.now());
    console.log(`%c[Dash] Fresh fetch complete (${fresh.length} courses)`, 'color:#7ee787');
  }
})();
