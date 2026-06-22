// FEU Canvas — Unified Dashboard.
//
// Single panel that hosts BOTH the pending-work bento grid AND the
// 🚀 Unlock Modules sweep tooling (blockers list, AI settings, Run, Rescan,
// live logs, per-discussion reply, per-assignment details).
//
// Loaded by background.js after the sweep modules
// (canvas-api → policy → ai-client → engine → ui), so window.FEUSweep.*
// is already populated when this runs.
//
// Read-only browsing of pending work + opt-in actions (sweep / post replies)
// behind explicit button clicks. Session cookies only.

(async () => {
  const BASE = location.origin;
  const STALE_DAYS = 90;
  const STALE_CUTOFF = Date.now() - STALE_DAYS * 86400000;
  const CACHE_KEY = 'feuDashCache';
  const CACHE_TTL_MS = 5 * 60 * 1000;

  // Sweep modules are injected before this file. If anything is missing the
  // user gets a clear error instead of a half-loaded panel.
  const FEU = window.FEUSweep || {};
  if (!FEU.api || !FEU.policy || !FEU.ai || !FEU.engine || !FEU.ui) {
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;top:16px;right:16px;background:#0f1419;color:#ff6b6b;border:1px solid #30363d;border-radius:10px;padding:12px 16px;z-index:999999;font:13px/1.4 ui-sans-serif,system-ui,sans-serif;';
    tmp.textContent = 'FEU dashboard failed to load — sweep modules missing. Reload the extension at chrome://extensions.';
    document.body.appendChild(tmp);
    setTimeout(() => tmp.remove(), 6000);
    return;
  }
  const { engine, ui, policy, ai } = FEU;
  const { categorize, chip, CAT } = policy;

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

  // fresh=true bypasses the browser HTTP cache (cache: 'no-store' + buster).
  const api = async (path, { fresh = false } = {}) => {
    const out = [];
    const buster = fresh ? `_=${Date.now()}-${Math.random().toString(36).slice(2, 8)}&` : '';
    let url = BASE + path + (path.includes('?') ? '&' : '?') + buster + 'per_page=100';
    const init = {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      ...(fresh ? { cache: 'no-store', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } } : {}),
    };
    while (url) {
      const res = await fetch(url, init);
      if (!res.ok) { console.warn('[Dash] fetch failed', url, res.status); break; }
      const data = await res.json();
      out.push(...(Array.isArray(data) ? data : [data]));
      const link = res.headers.get('Link') || '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }
    return out;
  };

  const QUICK = policy.QUICK_TYPES;

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
  const writeCache = (courseData, moduleStateMap) => {
    try {
      const mapEntries = moduleStateMap ? [...moduleStateMap.entries()] : [];
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), courseData, mapEntries }));
    } catch (e) { console.warn('[Dash] cache write failed', e); }
  };
  const clearCache = () => { try { localStorage.removeItem(CACHE_KEY); } catch {} };

  // ---------- fetch fresh ----------
  // Returns { courseData, courses, moduleStateMap }. courseData[i] mirrors the
  // shape the bento grid expects; engine-derived blockers carry the richer
  // fields (cat, quick, reqType, contentId, moduleLocked, ...) the sweep UI
  // helpers consume.
  const fetchFresh = async ({ fresh = false } = {}) => {
    const label = fresh ? '[Dash] HARD refresh (bypassing browser HTTP cache)' : '[Dash] refresh';
    console.log(`%c${label}`, 'color:#79c0ff;font-weight:bold');
    let favs = await api('/api/v1/users/self/favorites/courses', { fresh });
    if (!favs.length) {
      const cards = await api('/api/v1/dashboard/dashboard_cards', { fresh });
      favs = cards.map(c => ({ id: c.id, name: c.shortName || c.originalName || c.courseCode }));
    }
    const courses = favs.map(c => ({ id: c.id, name: c.name || c.shortName || c.course_code }));
    if (!courses.length) return { courseData: [], courses: [], moduleStateMap: new Map() };

    const moduleStateMap = new Map();

    const courseData = await Promise.all(courses.map(async (c) => {
      const [assigns, modules] = await Promise.all([
        api(`/api/v1/courses/${c.id}/assignments?bucket=unsubmitted&order_by=due_at&include[]=submission`, { fresh }).catch(() => []),
        api(`/api/v1/courses/${c.id}/modules?include[]=items&include[]=content_details`, { fresh }).catch(() => []),
      ]);

      if (fresh) {
        console.groupCollapsed(`[Dash] ${c.name} — ${assigns.length} assigns from API (bucket=unsubmitted)`);
        for (const a of assigns) {
          const ws = a.submission?.workflow_state || '(none)';
          const att = a.submission?.attempt ?? 0;
          const has = a.has_submitted_submissions;
          console.log(`  • ${a.name} — workflow=${ws} · attempts=${att} · has_submitted_submissions=${has} · locked=${a.locked_for_user}`);
        }
        console.groupEnd();
      }

      const isUnsubmittedByMe = (a) => {
        const s = a.submission;
        if (!s) return true;
        if (!s.workflow_state || s.workflow_state === 'unsubmitted') return true;
        if (s.workflow_state === 'graded' && (s.attempt ?? 0) === 0) return true;
        return false;
      };

      const pending = assigns
        .filter(a => !a.locked_for_user)
        .filter(isUnsubmittedByMe)
        .filter(a => !a.due_at || new Date(a.due_at).getTime() > STALE_CUTOFF)
        .map(a => ({
          id: a.id,
          name: a.name,
          due: a.due_at,
          points: a.points_possible,
          url: a.html_url,
          attempts: a.submission?.attempt ?? 0,
          allowedAttempts: a.allowed_attempts,
          submissionTypes: a.submission_types || [],
          allowedExtensions: a.allowed_extensions || [],
          workflowState: a.submission?.workflow_state || 'unsubmitted',
          itemType: a.submission_types?.includes('discussion_topic') ? 'Discussion'
            : (a.submission_types?.includes('online_quiz') ? 'Quiz' : 'Assignment'),
        }))
        .sort((x, y) => (new Date(x.due || '9999') - new Date(y.due || '9999')));

      for (const mod of modules) {
        moduleStateMap.set(`${c.id}-${mod.id}`, mod.state || 'unlocked');
      }
      const blockers = engine.apiModulesToBlockers(c, modules);

      // Merge unlocked heavy blockers (e.g. ungraded discussions, quizzes) that need manual action and aren't in the assignments list
      const pendingIds = new Set(pending.map(p => p.id));
      const pendingUrls = new Set(pending.map(p => p.url));
      for (const b of blockers) {
        if (!b.quick && !b.moduleLocked && !b.lockedForUser) {
          const alreadyPending = (b.contentId && pendingIds.has(b.contentId)) || pendingUrls.has(b.url);
          if (!alreadyPending) {
            pending.push({
              id: b.contentId || b.itemId,
              name: b.title,
              due: b.dueAt,
              points: b.points,
              url: b.url,
              attempts: 0,
              allowedAttempts: null,
              submissionTypes: b.itemType === 'Discussion' ? ['discussion_topic'] : (b.itemType === 'Quiz' ? ['online_quiz'] : []),
              allowedExtensions: [],
              workflowState: 'unsubmitted',
              itemType: b.itemType,
              isFromBlocker: true,
            });
            if (b.contentId) pendingIds.add(b.contentId);
            pendingUrls.add(b.url);
          }
        }
      }
      pending.sort((x, y) => (new Date(x.due || '9999') - new Date(y.due || '9999')));

      return { course: c, pending, blockers };
    }));

    return { courseData, courses, moduleStateMap };
  };

  // ---------- panel scaffold ----------
  document.getElementById('feu-dash')?.remove();
  const panel = document.createElement('div');
  panel.id = 'feu-dash';
  panel.style.cssText = `
    position:fixed;top:16px;right:16px;width:560px;max-height:88vh;overflow:auto;
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
    return '#7ee787';
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

    const fmtSubmissionTypes = (types, exts) => {
      if (!types.length) return null;
      const labels = {
        online_upload: 'file upload', online_text_entry: 'text entry',
        online_url: 'URL', online_quiz: 'quiz', media_recording: 'media',
        discussion_topic: 'discussion', external_tool: 'external tool',
        none: 'no submission', not_graded: 'not graded', on_paper: 'on paper',
      };
      const human = types.map(t => labels[t] || t).join(' / ');
      if (types.includes('online_upload') && exts.length) return `${human} (${exts.join(', ')})`;
      return human;
    };

    const pendingHtml = pending.map(p => {
      const isOverdue = p.due && new Date(p.due) < now;
      const accent = isOverdue ? '#ff6b6b' : '#7ee787';
      const cat = categorize({ name: p.name, itemType: p.itemType || 'Assignment', points: p.points });

      const inProgress = p.attempts > 0 && p.workflowState !== 'submitted' && p.workflowState !== 'graded';
      const pillColor = inProgress ? '#ffb84d' : '#8b949e';
      const pillLabel = inProgress ? 'In Progress' : 'Not Started';

      const attemptsLabel = (p.allowedAttempts == null || p.allowedAttempts === -1)
        ? `${p.attempts}/∞ attempts`
        : `${p.attempts}/${p.allowedAttempts} attempts`;

      const subType = fmtSubmissionTypes(p.submissionTypes, p.allowedExtensions);

      return `
        <div style="border-left:3px solid ${accent};padding:6px 10px;margin:4px 0;background:#161b22;border-radius:0 6px 6px 0;">
          <div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start;">
            <a href="${p.url}" target="_blank" style="color:#79c0ff;text-decoration:none;font-weight:600;font-size:12px;flex:1;">${p.name || '(untitled)'}</a>
            ${chip(cat)}
          </div>
          <div style="font-size:10.5px;margin-top:2px;display:flex;justify-content:space-between;opacity:.85;gap:6px;">
            <span>${fmt(p.due)}</span>
            <span>${p.points ?? 0} pts</span>
          </div>
          <div style="font-size:10.5px;margin-top:3px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;opacity:.85;">
            <span style="background:${pillColor}22;color:${pillColor};border:1px solid ${pillColor}55;padding:1px 6px;border-radius:4px;font-weight:600;">${pillLabel}</span>
            <span style="opacity:.75;">${attemptsLabel}</span>
            ${subType ? `<span style="opacity:.75;">· ${subType}</span>` : ''}
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
            const tag = policy.TYPE_LABEL[b.reqType] || b.reqType;
            return `
              <div style="border-left:3px solid ${accent};padding:5px 10px;margin:3px 0;background:#0d1117;border-radius:0 6px 6px 0;">
                <div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start;">
                  <a href="${b.url}" target="_blank" style="color:#79c0ff;text-decoration:none;font-size:12px;flex:1;">${b.title}</a>
                  ${chip(b.cat)}
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
      <div style="font-size:11px;opacity:.6;margin-bottom:10px;">Results only. To act on these, use 🚀 Run Sweep at the bottom of the dashboard.</div>
      ${pending.length ? `
        <details style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px 10px;margin-bottom:8px;">
          <summary style="cursor:pointer;font-size:12px;font-weight:600;color:#7ee787;list-style:none;">
            Pending Assignments & Tasks <span style="opacity:.7;font-weight:400;">(${pending.length})</span>
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
      if (!s?.at || Date.now() - s.at > 60 * 60 * 1000) return null;
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

  // Build the merged sweep section (engine UI: AI panel, category chips,
  // summary, Run/Rescan, blockers, optional walker host). All IDs match what
  // the sweep ui helpers expect so we can wire them without modification.
  const renderSweepSection = (allBlockers, courses) => {
    const quick = allBlockers.filter(b => b.quick).length;
    const manual = allBlockers.length - quick;
    return `
      <div id="sw-section" style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #30363d;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:6px;flex-wrap:wrap;">
          <strong style="font-size:14px;">🚀 Unlock Modules</strong>
          <button id="sw-batch-post" title="Post to every discussion blocker matching your Mode + Scope" style="display:none;background:#3d2414;border:1px solid #ffb84d;color:#ffb84d;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11px;font-weight:600;">⚡ Post to all matching</button>
        </div>
        <button id="sw-rescan" style="display:none;"></button>
        <div id="sw-settings-panel" style="display:none;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px;margin-bottom:10px;"></div>
        <div id="sw-header-summary" style="font-size:11px;opacity:.7;margin-bottom:10px;">${courses.length} favorited courses · ${allBlockers.length} total blockers</div>

        <div id="sw-cat-breakdown" style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">${ui.buildCatBreakdownHtml(allBlockers)}</div>

        <div id="sw-walker-host"></div>

        <div id="sw-summary" style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px;margin-bottom:10px;">
          <div style="font-size:13px;font-weight:600;color:#7ee787;">Auto-unlockable: <span id="sw-quick-count">${quick}</span></div>
          <div style="font-size:11px;opacity:.75;margin-top:2px;">Walks every currently-unlocked module in parallel. Marks <code style="background:#161b22;padding:1px 4px;border-radius:3px;">must_view</code> + <code style="background:#161b22;padding:1px 4px;border-radius:3px;">must_mark_done</code> via Canvas API, then re-cascades as prereqs flip. Never submits assignments, takes quizzes, or posts discussions.</div>
          <div style="font-size:13px;font-weight:600;color:#ffb84d;margin-top:8px;">Needs you: <span id="sw-manual-count">${manual}</span></div>
          <div style="font-size:11px;opacity:.75;margin-top:2px;">Submissions, quizzes, and discussions — use the buttons in the list below to view details or post discussion replies (with optional AI drafts).</div>
        </div>

        <button id="sw-run" ${allBlockers.length ? '' : 'disabled'} style="width:100%;background:${allBlockers.length ? '#1f6feb' : '#30363d'};color:white;border:none;border-radius:6px;padding:8px;cursor:${allBlockers.length ? 'pointer' : 'not-allowed'};font-weight:600;margin-bottom:12px;">
          🚀 Run Sweep — walk ${allBlockers.length} blocker${allBlockers.length === 1 ? '' : 's'}
        </button>

        <div id="sw-blockers" style="display:none;"></div>
      </div>
    `;
  };

  const renderMain = (courseData, fetchedAt, moduleStateMap) => {
    const sweep = readSweep();
    const totalPending = courseData.reduce((s, d) => s + d.pending.length, 0);
    const totalBlockers = courseData.reduce((s, d) => s + d.blockers.length, 0);
    const quickWins = courseData.reduce((s, d) => s + d.blockers.filter(b => b.quick).length, 0);
    const now = new Date();
    const overdue = courseData.reduce((s, d) => s + d.pending.filter(p => p.due && new Date(p.due) < now).length, 0);
    const today = courseData.reduce((s, d) => s + d.pending.filter(p => p.due && new Date(p.due).toDateString() === now.toDateString()).length, 0);

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

    // Flat blocker list across all favorited courses — shared ref so the ui
    // helpers (rescan, run, refresh) mutate it in place.
    const allBlockers = courseData.flatMap(d => d.blockers);
    const courses = courseData.map(d => d.course);

    root().innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <strong style="font-size:15px;">FEU Canvas — Pending Work</strong>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
          <span style="font-size:10px;opacity:.6;margin-right:4px;">cached ${age}</span>
          <button id="sw-settings-btn" title="Discussion-reply + AI settings" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11px;display:inline-flex;align-items:center;gap:5px;">
            ⚙ Settings
            <span id="sw-settings-dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#8b949e;"></span>
            <span id="sw-settings-mode" style="opacity:.75;font-size:10px;">Manual</span>
          </button>
          <button id="feu-refresh" title="Refresh & Rescan (Shift+click = HARD refresh, bypass browser cache)" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11px;">↻ Refresh</button>
          <button id="feu-close" title="Close" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;">×</button>
        </div>
      </div>
      <div style="font-size:11px;opacity:.7;margin-bottom:10px;">${courseData.length} favorited courses · pending bento is read-only · sweep section below acts on Canvas</div>

      ${renderSweepBanner(sweep)}

      <div style="display:flex;gap:6px;margin-bottom:12px;font-size:11px;flex-wrap:wrap;">
        <span style="background:#3d1414;border:1px solid #6e2222;padding:2px 8px;border-radius:6px;">${overdue} overdue</span>
        <span style="background:#3d3414;border:1px solid #6e5a22;padding:2px 8px;border-radius:6px;">${today} today</span>
        <span style="background:#143d2b;border:1px solid #226e4f;padding:2px 8px;border-radius:6px;">${totalPending} total pending</span>
        <span style="background:#1f2a3d;border:1px solid #2f4a6e;padding:2px 8px;border-radius:6px;">${totalBlockers} blockers (${quickWins} quick)</span>
      </div>

      ${renderSweepSection(allBlockers, courses)}

      <div id="feu-bento" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;">
        ${cards || '<div style="grid-column:1/-1;opacity:.7;padding:20px 0;text-align:center;">Nothing pending. Take a break.</div>'}
      </div>
      <div id="feu-modal" style="display:none;"></div>
    `;

    // Wire top-level dashboard buttons
    panel.querySelector('#feu-close').onclick = () => panel.remove();
    panel.querySelector('#feu-refresh').onclick = async (ev) => {
      const hard = ev.shiftKey;
      clearCache();
      root().innerHTML = `<div style="opacity:.85;">${hard ? 'HARD refreshing (bypassing all caches)…' : 'Refreshing…'}</div>`;
      const { courseData: fresh, courses: freshCourses, moduleStateMap: freshMap } = await fetchFresh({ fresh: hard });
      writeCache(fresh, freshMap);
      renderMain(fresh, Date.now(), freshMap);
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

    // Wire the sweep section using existing ui helpers.
    const courseById = new Map(courses.map(c => [c.id, c]));
    const ctx = { courses, courseById, blockers: allBlockers, moduleStateMap };
    ui.wireReplyButtons(panel.querySelector('#sw-blockers'), ctx);
    ui.wireDetailsButtons(panel.querySelector('#sw-blockers'));
    ui.openSettings(panel);
    ui.refreshSettingsBadge(panel);
    ui.wireBatchPostButton(panel, ctx);
    ui.wireRescanButton(panel, ctx);
    ui.wireSweepRun(panel, ctx);
    ui.mountModulesWalker(panel).catch(e => console.warn('[Dash] walker mount failed', e));

    window.FEUData = courseData;
  };

  const openModal = (d) => {
    const bento = panel.querySelector('#feu-bento');
    const modal = panel.querySelector('#feu-modal');
    const sweepSection = panel.querySelector('#sw-section');
    bento.style.display = 'none';
    if (sweepSection) sweepSection.style.display = 'none';
    modal.style.display = 'block';
    modal.innerHTML = renderModal(d);

    panel.querySelector('#feu-back').onclick = () => {
      modal.style.display = 'none';
      modal.innerHTML = '';
      bento.style.display = 'grid';
      if (sweepSection) sweepSection.style.display = 'block';
    };
  };

  // ---------- bootstrap ----------
  const cached = readCache();
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    const map = new Map(cached.mapEntries || []);
    if (!cached.mapEntries) {
      for (const d of cached.courseData) {
        for (const b of d.blockers) map.set(`${b.courseId}-${b.moduleId}`, b.moduleState || 'unlocked');
      }
    }
    renderMain(cached.courseData, cached.fetchedAt, map);
    console.log(`%c[Dash] Loaded from cache (${fmtAge(Date.now() - cached.fetchedAt)})`, 'color:#7ee787');
  } else {
    root().innerHTML = '<div style="opacity:.85;">Loading… iterating favorited courses in parallel…</div>';
    const { courseData: fresh, moduleStateMap } = await fetchFresh();
    writeCache(fresh, moduleStateMap);
    renderMain(fresh, Date.now(), moduleStateMap);
    console.log(`%c[Dash] Fresh fetch complete (${fresh.length} courses)`, 'color:#7ee787');
  }
})();
