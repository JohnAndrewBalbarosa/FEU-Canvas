// UI layer — everything DOM-shaped.
//
// Depends on: window.FEUSweep.{api, policy, ai, engine}.
//
// Public surface:
//   mountPanel({courses, blockers, moduleStateMap}) → panel element
//   refreshPanelFromCourses(panel, courseIds, courseById, blockers, moduleStateMap)
//   wireDetailsButtons(root)
//   wireReplyButtons(root)
//   wireAiSettings(panel)
//   wireRescanButton(panel, courses, courseById, blockers, moduleStateMap)
//   wireSweepRun(panel, courses, courseById, blockers, moduleStateMap)
//
// Engine never reaches into here — UI subscribes to engine callbacks instead.

(() => {
  window.FEUSweep = window.FEUSweep || {};
  const { api, policy, ai, engine } = window.FEUSweep;
  if (!api || !policy || !ai || !engine) {
    console.error('[Sweep ui] requires canvas-api.js, policy.js, ai-client.js, engine.js loaded first');
    return;
  }
  const { BASE, sleep, csrf } = api;
  const { TYPE_LABEL, categorize, chip, formatDue, buildDraft } = policy;
  const { PROVIDER_META } = ai;

  // -------- Pure HTML builders --------

  const itemBadge = (b) => {
    if (b.moduleLocked) return { emoji: '🔒', color: '#ff6b6b', label: 'prereq-locked' };
    if (b.quick)        return { emoji: '🔓', color: '#7ee787', label: 'auto-unlockable' };
    return                       { emoji: '🟡', color: '#ffb84d', label: 'needs you' };
  };

  const renderItem = (b) => {
    const isReplyable = (b.reqType === 'must_contribute' || b.itemType === 'Discussion') && b.contentId && !b.moduleLocked;
    const isAssignmentLike = b.itemType === 'Assignment' || b.itemType === 'Quiz';
    const showDetails = isAssignmentLike && b.contentId && !b.quick;
    const badge = itemBadge(b);
    const itemKey = `${b.courseId}-${b.itemId}`;
    const due = formatDue(b.dueAt);
    return `
    <div id="sw-item-${itemKey}" style="border-left:3px solid ${b.cat.color};padding:5px 10px;margin:3px 0;background:#161b22;border-radius:0 6px 6px 0;${b.moduleLocked ? 'opacity:.65;' : ''}">
      <div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start;">
        <span style="flex:1;display:flex;gap:6px;align-items:flex-start;">
          <span title="${badge.label}" style="font-size:12px;flex:0 0 auto;">${badge.emoji}</span>
          <a href="${b.url}" target="_blank" style="color:#79c0ff;text-decoration:none;font-size:12px;">${b.title}</a>
        </span>
        ${chip(b.cat)}
      </div>
      <div style="font-size:10.5px;margin-top:2px;display:flex;justify-content:space-between;align-items:center;opacity:.9;gap:6px;">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.courseName} · ${b.moduleName}</span>
        <span style="color:${due.color};font-weight:${b.dueAt && due.color !== '#7ee787' ? '600' : '400'};white-space:nowrap;">${due.text}</span>
      </div>
      <div style="font-size:10.5px;margin-top:2px;display:flex;justify-content:space-between;align-items:center;opacity:.85;">
        <span style="display:flex;gap:6px;align-items:center;">
          ${showDetails ? `<button class="sw-details-toggle" data-key="${itemKey}" data-course-id="${b.courseId}" data-assignment-id="${b.contentId}" style="background:transparent;border:1px solid #30363d;color:#8b949e;border-radius:4px;padding:1px 6px;cursor:pointer;font-size:10px;">ⓘ details</button>` : ''}
          ${isReplyable ? `<button class="sw-reply-toggle" data-key="${itemKey}" data-course-id="${b.courseId}" data-topic-id="${b.contentId}" data-title="${b.title.replace(/"/g, '&quot;')}" style="background:#1f6feb;color:white;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:10px;font-weight:600;">💬 Reply ↓</button>` : ''}
        </span>
        <span style="color:${badge.color};">${TYPE_LABEL[b.reqType] || b.reqType}${b.points != null ? ` · ${b.points} pts` : ''}</span>
      </div>
      ${showDetails ? `<div class="sw-details-panel" data-key="${itemKey}" style="display:none;margin-top:6px;padding:8px 10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;font-size:11px;line-height:1.5;"></div>` : ''}
      ${isReplyable ? `<div class="sw-reply-panel" data-key="${itemKey}" style="display:none;margin-top:8px;padding:10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;"></div>` : ''}
    </div>`;
  };

  const buildCatBreakdownHtml = (blockersArr) => {
    const byCat = {};
    for (const b of blockersArr) (byCat[b.cat.key] ??= { cat: b.cat, items: [] }).items.push(b);
    return Object.values(byCat)
      .sort((a, b) => b.items.length - a.items.length)
      .map(({ cat, items }) => `<span style="background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}55;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;">${cat.label} ${items.length}</span>`)
      .join(' ');
  };

  const buildBlockersListHtml = (blockersArr) => {
    if (!blockersArr.length) {
      return '<div style="opacity:.65;font-size:12px;padding:14px;text-align:center;background:#0d1117;border:1px solid #30363d;border-radius:8px;">✓ No pending blockers. You\'re clear.</div>';
    }
    const byCourse = {};
    for (const b of blockersArr) {
      const c = (byCourse[b.courseName] ??= { courseName: b.courseName, modules: {} });
      const m = (c.modules[b.moduleName] ??= { name: b.moduleName, position: b.modulePosition, items: [] });
      m.items.push(b);
    }
    const courseEntries = Object.values(byCourse).sort((a, b) => a.courseName.localeCompare(b.courseName));
    return courseEntries.map(course => {
      const mods = Object.values(course.modules).sort((a, b) => a.position - b.position);
      const totalItems = mods.reduce((s, m) => s + m.items.length, 0);
      const quickInCourse = mods.reduce((s, m) => s + m.items.filter(i => i.quick).length, 0);
      return `
        <details style="margin-bottom:10px;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:8px 10px;">
          <summary style="cursor:pointer;font-weight:700;font-size:13px;list-style:none;">
            <span style="color:#e6edf3;">▸ ${course.courseName}</span>
            <span style="float:right;font-size:11px;font-weight:400;opacity:.7;">${totalItems} blockers · ${quickInCourse} quick</span>
          </summary>
          ${mods.map(m => {
            m.items.sort((a, b) => {
              if (a.quick !== b.quick) return a.quick ? 1 : -1;
              const aDue = formatDue(a.dueAt).sortKey;
              const bDue = formatDue(b.dueAt).sortKey;
              if (aDue !== bDue) return aDue - bDue;
              return a.itemPosition - b.itemPosition;
            });
            return `
              <details style="margin-top:6px;margin-left:6px;background:#161b22;border-left:2px solid #30363d;padding:6px 10px;border-radius:0 6px 6px 0;">
                <summary style="cursor:pointer;font-size:12px;font-weight:600;color:#8b949e;list-style:none;">
                  ▸ ${m.name}
                  <span style="float:right;font-weight:400;opacity:.7;">${m.items.length}</span>
                </summary>
                <div style="margin-top:4px;">${m.items.map(renderItem).join('')}</div>
              </details>
            `;
          }).join('')}
        </details>
      `;
    }).join('');
  };

  // -------- DOM walker (only renders when on a /modules page) --------

  const stripText = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();

  const expandCollapsedDOM = async () => {
    const collapsed = document.querySelectorAll(
      '.context_module:not(.locked_module) .collapse_module_link[aria-expanded="false"]'
    );
    for (const btn of collapsed) { btn.click(); await sleep(40); }
    if (collapsed.length) await sleep(120);
  };

  const scanDOMModules = () => {
    const mods = [...document.querySelectorAll('#context_modules > .context_module')];
    return mods.map(mod => {
      const locked = mod.classList.contains('locked_module');
      const completed = mod.classList.contains('completed');
      const started = mod.classList.contains('started');
      const name = stripText(mod.querySelector('.ig-header .name'))
        || stripText(mod.querySelector('.collapse_module_link'))
        || mod.id;
      const prereqText = locked ? stripText(mod.querySelector('.prerequisites_list, .prerequisites_message')) : '';
      const items = [...mod.querySelectorAll('.context_module_item')].map(item => {
        const link = item.querySelector('a.title.item_link, a.ig-title.title');
        const req = item.querySelector('.completion_requirement');
        const reqText = stripText(req);
        const complete = !!item.querySelector('.completion_requirement .icon-check, .completion_requirement .ig-icon-check');
        const heavy = /must submit|must score|must contribute/i.test(reqText);
        return { title: stripText(link) || stripText(item.querySelector('.ig-title')) || '(untitled)', href: link?.href || null, complete, heavy, requirement: reqText };
      });
      return { name, locked, completed, started, prereqText, items };
    });
  };

  const buildWalkerHtml = (domModules, domOpenable) => {
    if (!domModules.length) return '';
    const OPEN_CHUNK = 25;
    const lockedCount = domModules.filter(m => m.locked).length;
    const modulesHtml = domModules.map(m => {
      const badge = m.completed ? { e: '✓', c: '#7ee787' }
        : m.locked   ? { e: '🔒', c: '#ff6b6b' }
        : m.started  ? { e: '⏳', c: '#ffb84d' }
        :              { e: '🔓', c: '#79c0ff' };
      const itemsHtml = m.items.map(it => {
        const icon = it.complete ? { e: '✓', c: '#7ee787' }
          : it.heavy   ? { e: '⚠', c: '#ffb84d' }
          : it.href    ? { e: '○', c: '#79c0ff' }
          :              { e: '·', c: '#8b949e' };
        const title = it.href
          ? `<a href="${it.href}" target="_blank" style="color:#79c0ff;text-decoration:none;">${it.title}</a>`
          : `<span style="opacity:.85;">${it.title}</span>`;
        const req = it.requirement ? `<span style="font-size:10.5px;opacity:.7;margin-left:6px;">${it.requirement}</span>` : '';
        return `<div style="padding:3px 10px;display:flex;gap:6px;align-items:flex-start;font-size:12px;"><span style="color:${icon.c};">${icon.e}</span><span style="flex:1;">${title}${req}</span></div>`;
      }).join('') || '<div style="font-size:11px;opacity:.6;padding:4px 10px;">(no items)</div>';
      const prereq = m.locked && m.prereqText
        ? `<div style="background:#3d1414;border-left:3px solid #ff6b6b;padding:5px 10px;margin:4px 0 6px;font-size:11px;color:#ffb3b3;border-radius:0 4px 4px 0;">🔒 ${m.prereqText}</div>`
        : '';
      return `
        <details ${m.locked || m.completed ? '' : 'open'} style="margin-bottom:6px;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:5px 10px;">
          <summary style="cursor:pointer;font-weight:600;font-size:12px;list-style:none;display:flex;justify-content:space-between;gap:8px;">
            <span><span style="color:${badge.c};">${badge.e}</span> ${m.name}</span>
            <span style="font-size:11px;opacity:.7;font-weight:400;">${m.items.length} items</span>
          </summary>
          ${prereq}<div>${itemsHtml}</div>
        </details>`;
    }).join('');
    return `
      <details open style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:8px 10px;margin-bottom:10px;">
        <summary style="cursor:pointer;font-weight:700;font-size:13px;list-style:none;display:flex;justify-content:space-between;">
          <span>🚶 This Modules page</span>
          <span style="font-size:11px;font-weight:400;opacity:.7;">${domModules.length} modules · ${lockedCount} locked · ${domOpenable.length} click-ready</span>
        </summary>
        <div style="font-size:11px;opacity:.7;margin:6px 0;">Read-only. Will only open pages in tabs — never submits, never takes quizzes.</div>
        <button id="sw-walk-open" ${domOpenable.length ? '' : 'disabled'} style="width:100%;background:${domOpenable.length ? '#1f6feb' : '#30363d'};color:white;border:none;border-radius:6px;padding:7px;cursor:${domOpenable.length ? 'pointer' : 'not-allowed'};font-weight:600;font-size:12px;margin-bottom:8px;">
          Open ${Math.min(domOpenable.length, OPEN_CHUNK)}${domOpenable.length > OPEN_CHUNK ? ` of ${domOpenable.length}` : ''} click-ready items in new tabs
        </button>
        ${modulesHtml}
      </details>`;
  };

  // -------- Toast + small UI helpers --------

  const toast = (msg, color = '#7ee787') => {
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:20px;right:20px;background:#161b22;color:${color};border:1px solid ${color};padding:10px 14px;border-radius:8px;font-size:12px;z-index:1000000;box-shadow:0 4px 12px rgba(0,0,0,.4);font-family:ui-sans-serif,system-ui,sans-serif;`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  };

  const stripHtml = (html) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
  };

  // Lazy assignment-detail cache (filled on click).
  const assignmentDetailCache = new Map();

  // -------- Mount: build the panel and inject into the page --------

  const mountPanel = async ({ courses, blockers, moduleStateMap }) => {
    document.getElementById('feu-sweep')?.remove();
    const panel = document.createElement('div');
    panel.id = 'feu-sweep';
    panel.style.cssText = `
      position:fixed;top:16px;right:16px;width:560px;max-height:88vh;overflow:auto;
      background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:10px;
      box-shadow:0 12px 40px rgba(0,0,0,.5);font-family:ui-sans-serif,system-ui,sans-serif;
      z-index:999999;padding:14px 16px;font-size:13px;line-height:1.4;
    `;
    document.body.appendChild(panel);

    // Optional /modules-page DOM walker
    let domModules = [], domOpenable = [];
    const onModulesPage = /\/courses\/\d+\/modules\b/.test(location.pathname)
      && !!document.querySelector('#context_modules');
    if (onModulesPage) {
      await expandCollapsedDOM();
      domModules = scanDOMModules();
      for (const m of domModules) {
        if (m.locked) continue;
        for (const it of m.items) {
          if (!it.href || it.complete || it.heavy) continue;
          domOpenable.push(it);
        }
      }
    }

    const quickQueue = blockers.filter(b => b.quick);
    const manualList = blockers.filter(b => !b.quick);

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="font-size:15px;">🚀 Unlock Modules</strong>
        <div style="display:flex;gap:4px;">
          <button id="sw-ai-settings" title="AI settings" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11px;">
            ⚙️ AI <span id="sw-ai-dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${ai.isConfigured() ? '#7ee787' : '#8b949e'};margin-left:2px;"></span>
          </button>
          <button id="sw-rescan" title="Rescan all favorited courses (force fresh from Canvas)" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11px;">↻ Rescan</button>
          <button id="sw-close" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;">×</button>
        </div>
      </div>
      <div id="sw-ai-panel" style="display:none;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px;margin-bottom:10px;"></div>
      <div id="sw-header-summary" style="font-size:11px;opacity:.7;margin-bottom:10px;">${courses.length} favorited courses · ${blockers.length} total blockers</div>

      <div id="sw-cat-breakdown" style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">${buildCatBreakdownHtml(blockers)}</div>

      ${buildWalkerHtml(domModules, domOpenable)}

      <div id="sw-summary" style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="font-size:13px;font-weight:600;color:#7ee787;">Auto-unlockable: <span id="sw-quick-count">${quickQueue.length}</span></div>
        <div style="font-size:11px;opacity:.75;margin-top:2px;">Walks every currently-unlocked module in parallel across all favorited courses. Marks <code style="background:#161b22;padding:1px 4px;border-radius:3px;">must_view</code> + <code style="background:#161b22;padding:1px 4px;border-radius:3px;">must_mark_done</code> via Canvas API, then re-cascades as prereqs flip. Never submits assignments, takes quizzes, or posts discussions.</div>
        <div style="font-size:13px;font-weight:600;color:#ffb84d;margin-top:8px;">Needs you: <span id="sw-manual-count">${manualList.length}</span></div>
        <div style="font-size:11px;opacity:.75;margin-top:2px;">Submissions, quizzes, discussions — listed below.</div>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button id="sw-run" ${blockers.length ? '' : 'disabled'} style="flex:1;background:${blockers.length ? '#1f6feb' : '#30363d'};color:white;border:none;border-radius:6px;padding:8px;cursor:${blockers.length ? 'pointer' : 'not-allowed'};font-weight:600;">
          🚀 Unlock Modules — walk ${blockers.length} blocker${blockers.length === 1 ? '' : 's'}
        </button>
        <button id="sw-skip" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:8px 14px;cursor:pointer;">View only</button>
      </div>

      <div id="sw-blockers">${buildBlockersListHtml(blockers)}</div>
    `;

    panel.querySelector('#sw-close').onclick = () => panel.remove();
    panel.querySelector('#sw-skip').onclick = () => panel.remove();

    // Walker "open in tabs" button (only present when on a /modules page)
    const walkOpenBtn = panel.querySelector('#sw-walk-open');
    if (walkOpenBtn) {
      walkOpenBtn.onclick = () => {
        const OPEN_CHUNK = 25;
        const batch = domOpenable.slice(0, OPEN_CHUNK);
        let opened = 0;
        for (const it of batch) {
          if (window.open(it.href, '_blank', 'noopener')) opened++;
        }
        walkOpenBtn.textContent = `✓ opened ${opened}`;
        walkOpenBtn.style.background = '#143d2b';
        domOpenable = domOpenable.slice(OPEN_CHUNK);
        if (domOpenable.length) {
          setTimeout(() => {
            walkOpenBtn.disabled = false;
            walkOpenBtn.style.background = '#1f6feb';
            walkOpenBtn.style.cursor = 'pointer';
            walkOpenBtn.textContent = `Open next ${Math.min(domOpenable.length, OPEN_CHUNK)}${domOpenable.length > OPEN_CHUNK ? ` of ${domOpenable.length}` : ''}`;
          }, 1200);
        } else {
          walkOpenBtn.disabled = true;
        }
      };
    }

    return panel;
  };

  // -------- AI settings panel --------

  const openAiSettings = (panel) => {
    const aiPanel = panel.querySelector('#sw-ai-panel');
    const aiDot = panel.querySelector('#sw-ai-dot');
    const render = () => {
      const cfg = ai.getConfig();
      const provider = cfg.provider || 'openai';
      const meta = PROVIDER_META[provider];
      aiPanel.innerHTML = `
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">AI provider settings</div>
        <div style="font-size:10.5px;opacity:.65;margin-bottom:8px;">Stored locally in your browser. Used only when you click "Generate draft".</div>
        <label style="display:block;font-size:11px;margin-bottom:4px;">Provider</label>
        <select id="sw-ai-provider" style="width:100%;background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:5px;padding:5px;font:inherit;font-size:12px;margin-bottom:8px;">
          ${Object.entries(PROVIDER_META).map(([key, m]) => `<option value="${key}" ${provider === key ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
        <label style="display:block;font-size:11px;margin-bottom:4px;">Model</label>
        <input id="sw-ai-model" type="text" value="${cfg.model || ''}" placeholder="${meta.placeholder}" style="width:100%;background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:5px;padding:5px 8px;font:inherit;font-size:12px;margin-bottom:8px;box-sizing:border-box;">
        <label style="display:block;font-size:11px;margin-bottom:4px;">API key</label>
        <input id="sw-ai-key" type="password" value="${cfg.apiKey || ''}" placeholder="${meta.keyHint}" style="width:100%;background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:5px;padding:5px 8px;font:inherit;font-size:12px;margin-bottom:10px;box-sizing:border-box;">
        <div style="display:flex;gap:6px;">
          <button id="sw-ai-save" style="flex:1;background:#1f6feb;color:white;border:none;border-radius:5px;padding:6px;cursor:pointer;font-size:11px;font-weight:600;">Save</button>
          <button id="sw-ai-clear" style="background:transparent;border:1px solid #6e2222;color:#ff6b6b;border-radius:5px;padding:6px 10px;cursor:pointer;font-size:11px;">Clear</button>
          <button id="sw-ai-cancel" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:5px;padding:6px 10px;cursor:pointer;font-size:11px;">Close</button>
        </div>
        <div id="sw-ai-status" style="font-size:10.5px;margin-top:6px;min-height:13px;opacity:.85;"></div>
      `;
      const providerSel = aiPanel.querySelector('#sw-ai-provider');
      const modelInput = aiPanel.querySelector('#sw-ai-model');
      const keyInput = aiPanel.querySelector('#sw-ai-key');
      const status = aiPanel.querySelector('#sw-ai-status');
      providerSel.onchange = () => {
        modelInput.placeholder = PROVIDER_META[providerSel.value].placeholder;
        keyInput.placeholder = PROVIDER_META[providerSel.value].keyHint;
      };
      aiPanel.querySelector('#sw-ai-save').onclick = () => {
        const cfg = { provider: providerSel.value, model: modelInput.value.trim(), apiKey: keyInput.value.trim() };
        if (!cfg.model || !cfg.apiKey) {
          status.textContent = 'Both model and API key required.';
          status.style.color = '#ff6b6b';
          return;
        }
        ai.setConfig(cfg);
        aiDot.style.background = '#7ee787';
        status.textContent = '✓ Saved.';
        status.style.color = '#7ee787';
        setTimeout(() => { aiPanel.style.display = 'none'; }, 600);
      };
      aiPanel.querySelector('#sw-ai-clear').onclick = () => {
        if (confirm('Clear stored AI config?')) {
          ai.clearConfig();
          aiDot.style.background = '#8b949e';
          render();
          status.textContent = 'Cleared.';
        }
      };
      aiPanel.querySelector('#sw-ai-cancel').onclick = () => { aiPanel.style.display = 'none'; };
    };
    panel.querySelector('#sw-ai-settings').onclick = () => {
      if (aiPanel.style.display === 'none') { render(); aiPanel.style.display = 'block'; }
      else aiPanel.style.display = 'none';
    };
  };

  // -------- Reply panel (per-item, lazy) --------

  const openReplyPanel = async (toggleBtn, ctx) => {
    const key = toggleBtn.dataset.key;
    const courseId = toggleBtn.dataset.courseId;
    const topicId = toggleBtn.dataset.topicId;
    const title = toggleBtn.dataset.title;
    const panelEl = document.querySelector(`.sw-reply-panel[data-key="${key}"]`);
    if (!panelEl) return;
    if (panelEl.style.display !== 'none') {
      panelEl.style.display = 'none';
      toggleBtn.textContent = '💬 Reply ↓';
      return;
    }
    toggleBtn.textContent = '💬 Reply ↑';
    panelEl.style.display = 'block';
    panelEl.innerHTML = '<div style="font-size:11px;opacity:.7;">Loading discussion prompt…</div>';

    let promptText = '(could not load prompt)';
    try {
      const res = await fetch(`${BASE}/api/v1/courses/${courseId}/discussion_topics/${topicId}`, {
        credentials: 'include', headers: { Accept: 'application/json' },
      });
      if (res.ok) { const data = await res.json(); promptText = stripHtml(data.message).slice(0, 800); }
    } catch (e) { console.warn('[Sweep] prompt fetch failed', e); }

    panelEl.innerHTML = `
      <div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Discussion prompt</div>
      <div style="font-size:11.5px;line-height:1.45;background:#161b22;padding:8px 10px;border-radius:6px;max-height:160px;overflow:auto;margin-bottom:10px;color:#c9d1d9;">${promptText || '(no prompt text)'}</div>
      <div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Your reply</div>
      <textarea class="sw-reply-text" placeholder="Read the prompt above, then write your own reflection…" style="width:100%;min-height:100px;background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px;font:inherit;font-size:12px;line-height:1.45;resize:vertical;box-sizing:border-box;"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
        <button class="sw-gen-draft" style="background:transparent;border:1px solid #30363d;color:#8b949e;border-radius:5px;padding:5px 10px;cursor:pointer;font-size:11px;">✨ Generate draft (then edit)</button>
        <button class="sw-submit" style="background:#1f6feb;color:white;border:none;border-radius:5px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:600;margin-left:auto;">Post reply</button>
      </div>
      <div class="sw-reply-status" style="font-size:10.5px;margin-top:6px;min-height:13px;opacity:.8;"></div>
    `;

    const textarea = panelEl.querySelector('.sw-reply-text');
    const statusEl = panelEl.querySelector('.sw-reply-status');
    panelEl.querySelector('.sw-gen-draft').onclick = async () => {
      const btn = panelEl.querySelector('.sw-gen-draft');
      const originalLabel = btn.textContent;
      if (ai.isConfigured()) {
        btn.disabled = true;
        btn.textContent = '⏳ Generating…';
        statusEl.textContent = '';
        try {
          const system = "You are helping a Filipino college student write an authentic 'end of module' reflection for an online discussion in Canvas. Output 3 to 4 sentences in first-person English. Reference one specific concept from the prompt. Keep it natural and student-like — no formal academic phrasing, no bullet points, no headings. Do not include a salutation or signature.";
          const userMsg = `Discussion title: ${title}\n\nDiscussion prompt:\n${promptText}\n\nWrite a brief reflection.`;
          const out = await ai.generate({ system, user: userMsg, maxTokens: 400 });
          textarea.value = out;
          textarea.focus();
          statusEl.textContent = '✨ AI draft generated. Edit it to match your own thinking before posting.';
          statusEl.style.color = '#ffb84d';
        } catch (e) {
          statusEl.textContent = `AI error: ${e.message}. Falling back to template.`;
          statusEl.style.color = '#ff6b6b';
          textarea.value = buildDraft(title);
        } finally {
          btn.disabled = false;
          btn.textContent = originalLabel;
        }
      } else {
        textarea.value = buildDraft(title);
        textarea.focus();
        statusEl.textContent = 'Template draft (no AI configured — click ⚙️ AI in header for better drafts). Edit before posting.';
        statusEl.style.color = '#ffb84d';
      }
    };

    panelEl.querySelector('.sw-submit').onclick = async () => {
      const message = textarea.value.trim();
      if (message.length < 30) {
        statusEl.textContent = 'Reply seems too short (min 30 chars). Add more thought.';
        statusEl.style.color = '#ff6b6b';
        return;
      }
      const submitBtn = panelEl.querySelector('.sw-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Posting…';
      statusEl.textContent = '';
      try {
        const res = await fetch(`${BASE}/api/v1/courses/${courseId}/discussion_topics/${topicId}/entries`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'X-CSRF-Token': csrf(),
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({ message }),
        });
        if (res.ok) {
          submitBtn.textContent = '✓ Posted';
          submitBtn.style.background = '#143d2b';
          const itemDiv = document.getElementById(`sw-item-${key}`);
          if (itemDiv) itemDiv.style.opacity = '.5';
          toast('Reply posted.');

          // Auto-refresh + auto-walk THIS course only. Posting a discussion
          // can only cascade-unlock prereqs in the same course.
          if (ctx && engine && refreshPanelFromCourses) {
            const panelRoot = panelEl.closest('#feu-sweep');
            statusEl.textContent = '✅ Posted. Auto-refreshing and walking newly-unlocked modules in this course…';
            statusEl.style.color = '#79c0ff';
            try {
              await sleep(1200); // give Canvas a beat to register the contribution
              const cidNum = Number(courseId);
              await refreshPanelFromCourses(panelRoot, [cidNum], ctx);

              const miniLog = document.createElement('div');
              miniLog.style.cssText = 'margin-top:8px;font-size:10.5px;font-family:ui-monospace,monospace;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:6px 8px;max-height:160px;overflow:auto;line-height:1.5;';
              panelEl.appendChild(miniLog);
              const miniLogger = (msg, color) => {
                const d = document.createElement('div');
                d.style.color = color || '#8b949e';
                d.textContent = msg;
                miniLog.appendChild(d);
                miniLog.scrollTop = miniLog.scrollHeight;
              };
              const result = await engine.runUnlockModules(
                { courses: ctx.courses, courseById: ctx.courseById, moduleStateMap: ctx.moduleStateMap, targetCourseIds: [cidNum] },
                { log: miniLogger, setProgress: () => {}, refreshPanel: (ids) => refreshPanelFromCourses(panelRoot, ids, ctx) },
              );
              statusEl.textContent = `✅ Posted + auto-walked ${result.totalDone} item(s) in this course.`;
              statusEl.style.color = '#7ee787';
            } catch (e) {
              statusEl.textContent = `✅ Posted, but auto-walk failed: ${e.message}. Click ↻ Rescan manually.`;
              statusEl.style.color = '#ffb84d';
            }
          } else {
            statusEl.textContent = '✅ Posted. Refresh Auto-Sweep to update status.';
            statusEl.style.color = '#7ee787';
          }
        } else {
          const errText = await res.text().catch(() => '');
          statusEl.textContent = `Failed (${res.status}): ${errText.slice(0, 120)}`;
          statusEl.style.color = '#ff6b6b';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Post reply';
        }
      } catch (e) {
        statusEl.textContent = `Error: ${e.message}`;
        statusEl.style.color = '#ff6b6b';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Post reply';
      }
    };
  };

  // -------- Details panel (per-item, lazy) --------

  const openDetailsPanel = async (toggleBtn) => {
    const key = toggleBtn.dataset.key;
    const courseId = toggleBtn.dataset.courseId;
    const assignmentId = toggleBtn.dataset.assignmentId;
    const panelEl = document.querySelector(`.sw-details-panel[data-key="${key}"]`);
    if (!panelEl) return;
    if (panelEl.style.display !== 'none') {
      panelEl.style.display = 'none';
      toggleBtn.textContent = 'ⓘ details';
      return;
    }
    toggleBtn.textContent = 'ⓘ hide';
    panelEl.style.display = 'block';
    panelEl.innerHTML = '<div style="opacity:.7;">Loading assignment details…</div>';

    const cacheKey = `${courseId}-${assignmentId}`;
    let a = assignmentDetailCache.get(cacheKey);
    if (!a) {
      try {
        const res = await fetch(`${BASE}/api/v1/courses/${courseId}/assignments/${assignmentId}`, {
          credentials: 'include', cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`${res.status}`);
        a = await res.json();
        assignmentDetailCache.set(cacheKey, a);
      } catch (e) {
        panelEl.innerHTML = `<div style="color:#ff6b6b;">Failed to load: ${e.message}</div>`;
        return;
      }
    }

    const due = formatDue(a.due_at);
    const lockInfo = a.lock_at ? `<div><span style="opacity:.6;">Locks at:</span> ${new Date(a.lock_at).toLocaleString()}</div>` : '';
    const unlockInfo = a.unlock_at && new Date(a.unlock_at) > new Date() ? `<div><span style="opacity:.6;">Unlocks at:</span> ${new Date(a.unlock_at).toLocaleString()}</div>` : '';
    const submissionTypes = (a.submission_types || []).join(', ') || '—';
    const fileTypes = a.allowed_extensions?.length ? a.allowed_extensions.join(', ') : '—';
    const attempts = a.allowed_attempts === -1 || a.allowed_attempts == null ? 'Unlimited' : a.allowed_attempts;
    const usedAttempts = a.submission?.attempt ?? 0;
    const hasSubmission = a.has_submitted_submissions || (a.submission && a.submission.workflow_state && a.submission.workflow_state !== 'unsubmitted');
    const workflow = a.submission?.workflow_state || '—';
    const grade = a.submission?.grade || a.submission?.score;
    const score = a.submission?.score != null ? `${a.submission.score} / ${a.points_possible ?? '?'}` : null;

    panelEl.innerHTML = `
      <div style="display:grid;grid-template-columns:max-content 1fr;gap:3px 10px;">
        <span style="opacity:.6;">Due:</span><span style="color:${due.color};font-weight:600;">${due.text}</span>
        <span style="opacity:.6;">Points:</span><span>${a.points_possible ?? '—'}</span>
        <span style="opacity:.6;">Submission:</span><span>${submissionTypes}</span>
        ${a.allowed_extensions?.length ? `<span style="opacity:.6;">File types:</span><span>${fileTypes}</span>` : ''}
        <span style="opacity:.6;">Attempts:</span><span>${usedAttempts} / ${attempts}</span>
        <span style="opacity:.6;">Status:</span><span style="color:${hasSubmission ? '#7ee787' : '#ffb84d'};">${hasSubmission ? `submitted (${workflow})` : 'not submitted'}</span>
        ${score ? `<span style="opacity:.6;">Score:</span><span>${score}${grade && grade !== score.split(' ')[0] ? ` (${grade})` : ''}</span>` : ''}
      </div>
      ${unlockInfo}${lockInfo}
      <div style="margin-top:6px;display:flex;gap:6px;">
        <a href="${a.html_url}" target="_blank" style="color:#79c0ff;text-decoration:none;font-size:11px;">Open assignment →</a>
        ${hasSubmission && a.submission?.preview_url ? `<a href="${a.submission.preview_url}" target="_blank" style="color:#79c0ff;text-decoration:none;font-size:11px;">View submission →</a>` : ''}
      </div>
    `;
  };

  const wireReplyButtons = (root, ctx) => {
    root.querySelectorAll('.sw-reply-toggle').forEach(btn => {
      btn.onclick = (e) => { e.preventDefault(); openReplyPanel(btn, ctx); };
    });
  };
  const wireDetailsButtons = (root) => {
    root.querySelectorAll('.sw-details-toggle').forEach(btn => {
      btn.onclick = (e) => { e.preventDefault(); openDetailsPanel(btn); };
    });
  };

  // -------- Panel refresh after sweep / on rescan --------

  const refreshPanelFromCourses = async (panel, courseIds, ctx) => {
    const fresh = await engine.refreshBlockersForCourses(courseIds, ctx.courseById, ctx.blockers, ctx.moduleStateMap);
    ctx.blockers.length = 0;
    ctx.blockers.push(...fresh);
    const quick = fresh.filter(b => b.quick).length;
    const manual = fresh.length - quick;
    panel.querySelector('#sw-cat-breakdown').innerHTML = buildCatBreakdownHtml(fresh);
    panel.querySelector('#sw-quick-count').textContent = quick;
    panel.querySelector('#sw-manual-count').textContent = manual;
    panel.querySelector('#sw-header-summary').textContent = `${ctx.courses.length} favorited courses · ${fresh.length} total blockers`;
    panel.querySelector('#sw-blockers').innerHTML = buildBlockersListHtml(fresh);
    wireReplyButtons(panel.querySelector('#sw-blockers'), ctx);
    wireDetailsButtons(panel.querySelector('#sw-blockers'));
    return fresh;
  };

  const wireRescanButton = (panel, ctx) => {
    const btn = panel.querySelector('#sw-rescan');
    btn.onclick = async () => {
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = '↻ …';
      try {
        await refreshPanelFromCourses(panel, ctx.courses.map(c => c.id), ctx);
        btn.textContent = '✓';
        toast('Rescan complete.', '#7ee787');
      } catch (e) {
        btn.textContent = '✗';
        toast(`Rescan failed: ${e.message}`, '#ff6b6b');
      } finally {
        setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 1200);
      }
    };
  };

  const wireSweepRun = (panel, ctx) => {
    const btn = panel.querySelector('#sw-run');
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Running…';
      btn.style.background = '#30363d'; btn.style.cursor = 'not-allowed';

      // Create the log box on first run.
      const logBox = document.createElement('div');
      logBox.style.cssText = 'margin-top:10px;font-size:11px;font-family:ui-monospace,monospace;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px;max-height:300px;overflow:auto;';
      logBox.innerHTML = '<div id="sw-prog" style="font-weight:600;">Starting…</div><div id="sw-log"></div>';
      panel.appendChild(logBox);
      const setProgress = (t) => { logBox.querySelector('#sw-prog').textContent = t; };
      const log = (msg, color) => {
        const d = document.createElement('div');
        d.style.color = color; d.textContent = msg;
        logBox.querySelector('#sw-log').appendChild(d);
        logBox.scrollTop = logBox.scrollHeight;
      };
      const refreshPanel = (courseIds) => refreshPanelFromCourses(panel, courseIds, ctx);

      const result = await engine.runUnlockModules(
        { courses: ctx.courses, courseById: ctx.courseById, moduleStateMap: ctx.moduleStateMap },
        { log, setProgress, refreshPanel },
      );

      btn.textContent = `✓ Unlocked ${result.totalDone}`;
      btn.style.background = '#143d2b';

      // Save sweep result for the dashboard's "recently unlocked" banner.
      try {
        const unlocked = result.allResults.map(r => ({
          title: r.title, courseName: r.courseName, moduleName: r.moduleName,
          url: r.url, cat: { label: r.cat.label, color: r.cat.color, key: r.cat.key },
          reqType: r.reqType, itemType: r.itemType,
        }));
        const manualPending = ctx.blockers.filter(b => !b.quick).length;
        localStorage.setItem('feuLastSweep', JSON.stringify({ at: Date.now(), unlocked, manualPending }));
        localStorage.removeItem('feuDashCache');
      } catch {}

      console.log(`%c[Sweep] ${result.cycles} cycles · ${result.totalWalked} walked · ${result.totalDone} marked · ${result.totalFailed} failed · ${result.stopsAtHeavy.length} heavy stops · stop=${result.stopReason || 'normal'}.`, 'color:#7ee787;font-weight:bold');
      window.FEULastSweep = result;
    };
  };

  window.FEUSweep.ui = {
    mountPanel,
    refreshPanelFromCourses,
    openReplyPanel, openDetailsPanel,
    wireReplyButtons, wireDetailsButtons,
    openAiSettings, wireRescanButton, wireSweepRun,
    toast,
  };
})();
