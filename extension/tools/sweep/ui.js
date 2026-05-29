// UI helpers for the unified dashboard's "Unlock Modules" section.
//
// Depends on: window.FEUSweep.{api, policy, ai, engine}.
//
// The dashboard owns the panel container and renders the sweep section IDs
// (#sw-ai-settings, #sw-ai-dot, #sw-ai-panel, #sw-cat-breakdown,
//  #sw-header-summary, #sw-quick-count, #sw-manual-count, #sw-rescan,
//  #sw-run, #sw-blockers, optional #sw-walker-host). These helpers wire
// buttons and refresh content within that container.
//
// Public surface (window.FEUSweep.ui):
//   buildCatBreakdownHtml, buildBlockersListHtml
//   refreshPanelFromCourses(panel, courseIds, ctx)
//   wireReplyButtons(root, ctx) / wireDetailsButtons(root)
//   openAiSettings(panel) / wireRescanButton(panel, ctx) / wireSweepRun(panel, ctx)
//   mountModulesWalker(panel) — optional, only call on /modules pages
//   toast(msg, color)

(() => {
  window.FEUSweep = window.FEUSweep || {};
  const { api, policy, ai, engine, settings } = window.FEUSweep;
  if (!api || !policy || !ai || !engine || !settings) {
    console.error('[Sweep ui] requires canvas-api.js, policy.js, settings.js, ai-client.js, engine.js loaded first');
    return;
  }
  const { BASE, sleep, csrf } = api;
  const { TYPE_LABEL, categorize, chip, formatDue, buildDraft } = policy;
  const { PROVIDER_META } = ai;
  const { MODE_LABEL, SCOPE_LABEL, MODE_DOT_COLOR } = settings;

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

  // -------- Optional modules-page walker (rendered into a host the dashboard provides) --------

  const mountModulesWalker = async (panel) => {
    const host = panel.querySelector('#sw-walker-host');
    if (!host) return;
    const onModulesPage = /\/courses\/\d+\/modules\b/.test(location.pathname)
      && !!document.querySelector('#context_modules');
    if (!onModulesPage) return;
    await expandCollapsedDOM();
    const domModules = scanDOMModules();
    let domOpenable = [];
    for (const m of domModules) {
      if (m.locked) continue;
      for (const it of m.items) {
        if (!it.href || it.complete || it.heavy) continue;
        domOpenable.push(it);
      }
    }
    host.innerHTML = buildWalkerHtml(domModules, domOpenable);
    const walkOpenBtn = host.querySelector('#sw-walk-open');
    if (!walkOpenBtn) return;
    const OPEN_CHUNK = 25;
    walkOpenBtn.onclick = () => {
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
  };

  // -------- Settings panel (Discussion replies + AI provider) --------

  const SECTION_TITLE_CSS = 'font-size:11px;font-weight:700;color:#79c0ff;letter-spacing:.5px;text-transform:uppercase;margin:0 0 6px;';
  const FIELD_LABEL_CSS  = 'display:block;font-size:11px;color:#c9d1d9;margin:8px 0 4px;';
  const HINT_CSS         = 'font-size:10.5px;opacity:.6;margin-top:3px;line-height:1.4;';
  const INPUT_CSS        = 'width:100%;background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:6px 8px;font:inherit;font-size:12px;box-sizing:border-box;';

  const refreshSettingsBadge = (panel) => {
    const cfg = settings.get();
    const dot = panel.querySelector('#sw-settings-dot');
    const label = panel.querySelector('#sw-settings-mode');
    if (dot) dot.style.background = MODE_DOT_COLOR[cfg.mode] || '#8b949e';
    if (label) label.textContent = MODE_LABEL[cfg.mode]?.split(' ')[0] || cfg.mode;
  };

  const openSettings = (panel) => {
    const settingsPanel = panel.querySelector('#sw-settings-panel');
    let vendorPrefs = { ...settings.vendor.DEFAULTS };
    let vendorReady = false;

    settings.vendor.getPrefs()
      .then((p) => { vendorPrefs = p; vendorReady = true; })
      .catch((e) => console.warn('[FEU] vendor prefs load failed', e));

    const render = () => {
      const reply = settings.get();
      const aiCfg = ai.getConfig();
      const provider = aiCfg.provider || 'openai';
      const meta = PROVIDER_META[provider];
      const aiReady = ai.isConfigured();
      const aiNeeded = reply.mode === 'ai' || reply.mode === 'auto';
      const aiWarn = aiNeeded && !aiReady
        ? `<div style="margin-top:6px;padding:6px 8px;background:#3d3414;border:1px solid #6e5a22;border-radius:5px;color:#ffb84d;font-size:11px;">⚠ AI provider not configured — set one below or switch mode to Template / Manual.</div>`
        : '';

      settingsPanel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <h4 style="${SECTION_TITLE_CSS}margin:0;">💬 Discussion reply</h4>
          <button id="sw-set-close" title="Close settings" style="background:transparent;border:none;color:#8b949e;cursor:pointer;font-size:16px;line-height:1;padding:0 4px;">×</button>
        </div>
        <div style="${HINT_CSS}margin-bottom:6px;">Controls how the extension fills in (and optionally batch-posts) discussion replies surfaced by the sweep.</div>

        <label style="${FIELD_LABEL_CSS}">Mode</label>
        <select id="sw-set-mode" style="${INPUT_CSS}">
          ${Object.entries(MODE_LABEL).map(([k, v]) => `<option value="${k}" ${reply.mode === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <div style="${HINT_CSS}">
          <b>Manual</b> — type your own. <b>Template</b> — drops the text below into the box.
          <b>AI</b> — generates a reflection with your configured provider.
          <b>Auto</b> — AI for reflection-style topics, template for everything else.
        </div>

        <label style="${FIELD_LABEL_CSS}">Scope</label>
        <select id="sw-set-scope" style="${INPUT_CSS}">
          ${Object.entries(SCOPE_LABEL).map(([k, v]) => `<option value="${k}" ${reply.scope === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <div style="${HINT_CSS}">Which discussion blockers the mode above applies to.</div>

        <label style="${FIELD_LABEL_CSS}">Template text</label>
        <textarea id="sw-set-template" rows="2" placeholder="." style="${INPUT_CSS}resize:vertical;min-height:36px;">${(reply.template || '').replace(/</g, '&lt;')}</textarea>
        <div style="${HINT_CSS}">Used in Template / Auto mode. A single "." works for teachers who only require <i>any</i> reply to unlock the next module.</div>

        <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:11.5px;cursor:pointer;">
            <input id="sw-set-autofill" type="checkbox" ${reply.autoFill ? 'checked' : ''} style="margin:0;">
            Auto-fill the textarea when I open a reply panel
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:11.5px;cursor:pointer;">
            <input id="sw-set-allowshort" type="checkbox" ${reply.allowShort ? 'checked' : ''} style="margin:0;">
            Allow short replies (skip the 30-character minimum)
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:11.5px;cursor:pointer;color:#ffb84d;">
            <input id="sw-set-batch" type="checkbox" ${reply.autoPostBatch ? 'checked' : ''} style="margin:0;">
            Enable "Post to all matching" batch button <span style="opacity:.7;">(posts without per-item review)</span>
          </label>
        </div>

        <hr style="border:none;border-top:1px solid #30363d;margin:14px 0 10px;">

        <h4 style="${SECTION_TITLE_CSS}">⚙ AI provider <span id="sw-ai-state" style="font-weight:400;color:${aiReady ? '#7ee787' : '#8b949e'};letter-spacing:0;text-transform:none;">${aiReady ? `· ${provider}/${aiCfg.model}` : '· not configured'}</span></h4>
        ${aiWarn}
        <label style="${FIELD_LABEL_CSS}">Provider</label>
        <select id="sw-ai-provider" style="${INPUT_CSS}">
          ${Object.entries(PROVIDER_META).map(([key, m]) => `<option value="${key}" ${provider === key ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
        <label style="${FIELD_LABEL_CSS}">Model</label>
        <input id="sw-ai-model" type="text" value="${aiCfg.model || ''}" placeholder="${meta.placeholder}" style="${INPUT_CSS}">
        <label style="${FIELD_LABEL_CSS}">API key</label>
        <input id="sw-ai-key" type="password" value="${aiCfg.apiKey || ''}" placeholder="${meta.keyHint}" style="${INPUT_CSS}">
        <div style="${HINT_CSS}">Stored only in this browser's localStorage. Calls go directly from your browser to the provider — never to FEU.</div>

        <hr style="border:none;border-top:1px solid #30363d;margin:14px 0 10px;">

        <h4 style="${SECTION_TITLE_CSS}">🧩 Bundled extensions</h4>
        <div style="${HINT_CSS}margin-bottom:8px;">Toggle the third-party helpers that ship inside FEU Canvas Suite. Defaults: both on. Re-registers content scripts immediately.</div>
        <label style="display:flex;align-items:flex-start;gap:8px;font-size:11.5px;cursor:pointer;padding:6px 0;">
          <input id="sw-set-aa" type="checkbox" ${vendorPrefs.alwaysActiveEnabled ? 'checked' : ''} style="margin:2px 0 0;">
          <span style="flex:1;">
            <span style="font-weight:600;">Always-Active Window</span>
            <span style="${HINT_CSS}display:block;">Keeps Canvas tabs visually "active" — prevents quizzes and videos from pausing when you switch tabs. Auto-on for <code style="background:#161b22;padding:1px 4px;border-radius:3px;">*.instructure.com</code> and <code style="background:#161b22;padding:1px 4px;border-radius:3px;">*.edu</code>.</span>
          </span>
        </label>
        <label style="display:flex;align-items:flex-start;gap:8px;font-size:11.5px;cursor:pointer;padding:6px 0;">
          <input id="sw-set-qf" type="checkbox" ${vendorPrefs.quizFetchEnabled ? 'checked' : ''} style="margin:2px 0 0;">
          <span style="flex:1;">
            <span style="font-weight:600;">Canvas Quiz Fetch</span>
            <span style="${HINT_CSS}display:block;">Captures and organizes quiz questions on Canvas quiz pages. Adds the QuizFetch overlay when you open a quiz.</span>
          </span>
        </label>
        ${vendorReady ? '' : '<div style="font-size:10.5px;color:#ffb84d;margin-top:4px;">⏳ Loading current toggle state from the extension bridge…</div>'}

        <div style="display:flex;gap:6px;margin-top:14px;">
          <button id="sw-set-save" style="flex:1;background:#1f6feb;color:white;border:none;border-radius:6px;padding:7px;cursor:pointer;font-size:12px;font-weight:600;">Save settings</button>
          <button id="sw-set-reset" style="background:transparent;border:1px solid #6e2222;color:#ff6b6b;border-radius:6px;padding:7px 10px;cursor:pointer;font-size:11px;">Reset reply</button>
          <button id="sw-ai-clear" style="background:transparent;border:1px solid #6e2222;color:#ff6b6b;border-radius:6px;padding:7px 10px;cursor:pointer;font-size:11px;">Clear AI</button>
        </div>
        <div id="sw-set-status" style="font-size:10.5px;margin-top:8px;min-height:13px;opacity:.85;"></div>
      `;

      const $ = (sel) => settingsPanel.querySelector(sel);
      const status = $('#sw-set-status');
      const providerSel = $('#sw-ai-provider');
      const modelInput = $('#sw-ai-model');
      const keyInput = $('#sw-ai-key');

      providerSel.onchange = () => {
        const m = PROVIDER_META[providerSel.value];
        modelInput.placeholder = m.placeholder;
        keyInput.placeholder = m.keyHint;
      };
      $('#sw-set-close').onclick = () => { settingsPanel.style.display = 'none'; };

      const wireVendorToggle = (id, key, label) => {
        const cb = $(id);
        if (!cb) return;
        cb.addEventListener('change', async () => {
          cb.disabled = true;
          try {
            vendorPrefs = await settings.vendor.setPref(key, cb.checked);
            status.textContent = `✓ ${label} ${cb.checked ? 'enabled' : 'disabled'} — content scripts re-registered. Reload Canvas tabs to apply.`;
            status.style.color = cb.checked ? '#7ee787' : '#ffb84d';
          } catch (e) {
            cb.checked = !cb.checked;
            status.textContent = `Failed to update ${label}: ${e.message}`;
            status.style.color = '#ff6b6b';
          } finally {
            cb.disabled = false;
          }
        });
      };
      wireVendorToggle('#sw-set-aa', 'alwaysActiveEnabled', 'Always-Active');
      wireVendorToggle('#sw-set-qf', 'quizFetchEnabled', 'Canvas Quiz Fetch');

      $('#sw-set-save').onclick = () => {
        settings.set({
          mode: $('#sw-set-mode').value,
          scope: $('#sw-set-scope').value,
          template: $('#sw-set-template').value,
          autoFill: $('#sw-set-autofill').checked,
          allowShort: $('#sw-set-allowshort').checked,
          autoPostBatch: $('#sw-set-batch').checked,
        });
        const aiPatch = {
          provider: providerSel.value,
          model: modelInput.value.trim(),
          apiKey: keyInput.value.trim(),
        };
        if (aiPatch.model && aiPatch.apiKey) ai.setConfig(aiPatch);

        refreshSettingsBadge(panel);
        const batchBtn = panel.querySelector('#sw-batch-post');
        if (batchBtn) batchBtn.style.display = settings.get().autoPostBatch ? '' : 'none';

        status.textContent = '✓ Saved.';
        status.style.color = '#7ee787';
        setTimeout(() => { settingsPanel.style.display = 'none'; }, 700);
      };

      $('#sw-set-reset').onclick = () => {
        if (!confirm('Reset discussion-reply settings to defaults?')) return;
        settings.reset();
        refreshSettingsBadge(panel);
        render();
        status.textContent = 'Reply settings reset.';
        status.style.color = '#ffb84d';
      };

      $('#sw-ai-clear').onclick = () => {
        if (!confirm('Clear the stored AI provider, model, and API key?')) return;
        ai.clearConfig();
        render();
        status.textContent = 'AI provider cleared.';
        status.style.color = '#ffb84d';
      };
    };

    panel.querySelector('#sw-settings-btn').onclick = async () => {
      if (settingsPanel.style.display !== 'none') {
        settingsPanel.style.display = 'none';
        return;
      }
      // Refresh vendor prefs from chrome.storage every open so toggles
      // always reflect what background.js actually has registered.
      try {
        vendorPrefs = await settings.vendor.getPrefs();
        vendorReady = true;
      } catch (e) {
        console.warn('[FEU] vendor prefs fetch failed', e);
      }
      render();
      settingsPanel.style.display = 'block';
    };

    // Live re-render if another tab changed the toggles.
    settings.vendor.onChange((next) => {
      vendorPrefs = next;
      if (settingsPanel.style.display !== 'none') render();
    });
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

    const plan = settings.planFill({ title });
    const replyCfg = settings.get();
    const planBadge = {
      ai:       { text: '✨ AI mode — click "Generate draft" to fill', color: '#a371f7' },
      template: { text: `📋 Template mode — pre-filled with your saved template`, color: '#ffb84d' },
      manual:   { text: '✍ Manual mode — write your own reply', color: '#8b949e' },
    }[plan.source];

    panelEl.innerHTML = `
      <div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Discussion prompt</div>
      <div style="font-size:11.5px;line-height:1.45;background:#161b22;padding:8px 10px;border-radius:6px;max-height:160px;overflow:auto;margin-bottom:10px;color:#c9d1d9;">${promptText || '(no prompt text)'}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:8px;">
        <span style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;">Your reply</span>
        <span style="font-size:10px;color:${planBadge.color};opacity:.9;">${planBadge.text}</span>
      </div>
      <textarea class="sw-reply-text" placeholder="Read the prompt above, then write your own reflection…" style="width:100%;min-height:100px;background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px;font:inherit;font-size:12px;line-height:1.45;resize:vertical;box-sizing:border-box;"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap;">
        <button class="sw-gen-draft" style="background:transparent;border:1px solid #30363d;color:#8b949e;border-radius:5px;padding:5px 10px;cursor:pointer;font-size:11px;">✨ Generate AI draft</button>
        <button class="sw-fill-template" style="background:transparent;border:1px solid #30363d;color:#8b949e;border-radius:5px;padding:5px 10px;cursor:pointer;font-size:11px;">📋 Use template</button>
        <button class="sw-submit" style="background:#1f6feb;color:white;border:none;border-radius:5px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:600;margin-left:auto;">Post reply</button>
      </div>
      <div class="sw-reply-status" style="font-size:10.5px;margin-top:6px;min-height:13px;opacity:.8;"></div>
    `;

    const textarea = panelEl.querySelector('.sw-reply-text');
    const statusEl = panelEl.querySelector('.sw-reply-status');

    // Apply auto-fill based on settings.
    if (plan.source === 'template' && plan.text != null) {
      textarea.value = plan.text;
      statusEl.textContent = `Template inserted. Edit before posting if you want.`;
      statusEl.style.color = '#ffb84d';
    } else if (plan.source === 'ai' && replyCfg.autoFill && ai.isConfigured()) {
      // Kick off generation in the background — user can still edit/cancel.
      statusEl.textContent = '⏳ Generating AI draft…';
      statusEl.style.color = '#a371f7';
      const sys = "You are helping a Filipino college student write an authentic 'end of module' reflection for an online discussion in Canvas. Output 3 to 4 sentences in first-person English. Reference one specific concept from the prompt. Keep it natural and student-like — no formal academic phrasing, no bullet points, no headings. Do not include a salutation or signature.";
      const usr = `Discussion title: ${title}\n\nDiscussion prompt:\n${promptText}\n\nWrite a brief reflection.`;
      ai.generate({ system: sys, user: usr, maxTokens: 400 })
        .then((out) => {
          if (!textarea.value) textarea.value = out;
          statusEl.textContent = '✨ AI draft inserted. Edit to match your voice before posting.';
          statusEl.style.color = '#a371f7';
        })
        .catch((e) => {
          statusEl.textContent = `AI error: ${e.message}. You can still type manually or use the template.`;
          statusEl.style.color = '#ff6b6b';
        });
    }
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

    panelEl.querySelector('.sw-fill-template').onclick = () => {
      const tpl = settings.get().template || '.';
      textarea.value = tpl;
      textarea.focus();
      statusEl.textContent = 'Template inserted.';
      statusEl.style.color = '#ffb84d';
    };

    panelEl.querySelector('.sw-submit').onclick = async () => {
      const message = textarea.value.trim();
      const cfgNow = settings.get();
      const minOk = cfgNow.allowShort || message.length >= 30;
      if (!message) {
        statusEl.textContent = 'Reply is empty.';
        statusEl.style.color = '#ff6b6b';
        return;
      }
      if (!minOk) {
        statusEl.textContent = 'Reply seems too short (min 30 chars). Enable "Allow short replies" in ⚙ Settings to bypass.';
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

  // -------- Batch post (Template / AI for every matching discussion blocker) --------

  const postSingleReply = async ({ courseId, topicId, message }) => {
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
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`${res.status}: ${errText.slice(0, 120)}`);
    }
    return true;
  };

  const fetchDiscussionPrompt = async ({ courseId, topicId }) => {
    try {
      const res = await fetch(`${BASE}/api/v1/courses/${courseId}/discussion_topics/${topicId}`, {
        credentials: 'include', headers: { Accept: 'application/json' },
      });
      if (!res.ok) return '';
      const data = await res.json();
      return stripHtml(data.message).slice(0, 800);
    } catch { return ''; }
  };

  const buildPlannedReplies = async (blockers) => {
    const cfg = settings.get();
    const out = [];
    for (const b of blockers) {
      const replyable = (b.reqType === 'must_contribute' || b.itemType === 'Discussion')
        && b.contentId && !b.moduleLocked;
      if (!replyable) continue;
      const plan = settings.planFill({ title: b.title });
      if (plan.source === 'manual') continue;
      out.push({ b, plan, cfg });
    }
    return out;
  };

  const wireBatchPostButton = (panel, ctx) => {
    const btn = panel.querySelector('#sw-batch-post');
    if (!btn) return;
    if (!settings.get().autoPostBatch) { btn.style.display = 'none'; return; }
    btn.style.display = '';

    btn.onclick = async () => {
      const targets = await buildPlannedReplies(ctx.blockers);
      if (!targets.length) {
        toast('No discussion blockers match your current Mode + Scope.', '#ffb84d');
        return;
      }
      const cfg = settings.get();
      const aiCount = targets.filter(t => t.plan.source === 'ai').length;
      const tplCount = targets.length - aiCount;
      const ok = confirm(
        `Post to ${targets.length} discussion${targets.length === 1 ? '' : 's'} right now?\n` +
        `  • ${tplCount} via template (${(cfg.template || '.').slice(0, 30)})\n` +
        `  • ${aiCount} via AI-generated draft\n\n` +
        `This will hit Canvas immediately and cannot be undone from here.`
      );
      if (!ok) return;

      const logBox = document.createElement('div');
      logBox.style.cssText = 'margin-top:8px;font-size:10.5px;font-family:ui-monospace,monospace;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px;max-height:240px;overflow:auto;line-height:1.5;';
      btn.parentElement.appendChild(logBox);
      const log = (msg, color) => {
        const d = document.createElement('div');
        d.style.color = color || '#8b949e';
        d.textContent = msg;
        logBox.appendChild(d);
        logBox.scrollTop = logBox.scrollHeight;
      };

      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = `Posting 0 / ${targets.length}…`;
      let ok2 = 0, fail = 0;
      const affectedCourses = new Set();

      for (let i = 0; i < targets.length; i++) {
        const { b, plan } = targets[i];
        btn.textContent = `Posting ${i + 1} / ${targets.length}…`;
        try {
          let message;
          if (plan.source === 'template') {
            message = plan.text || cfg.template || '.';
          } else {
            // AI
            if (!ai.isConfigured()) throw new Error('AI not configured');
            const prompt = await fetchDiscussionPrompt({ courseId: b.courseId, topicId: b.contentId });
            const sys = "You are helping a Filipino college student write an authentic 'end of module' reflection for an online discussion in Canvas. Output 3 to 4 sentences in first-person English. Reference one specific concept from the prompt. Keep it natural and student-like — no formal academic phrasing, no bullet points, no headings. Do not include a salutation or signature.";
            const usr = `Discussion title: ${b.title}\n\nDiscussion prompt:\n${prompt}\n\nWrite a brief reflection.`;
            message = await ai.generate({ system: sys, user: usr, maxTokens: 400 });
          }
          await postSingleReply({ courseId: b.courseId, topicId: b.contentId, message });
          ok2++;
          affectedCourses.add(b.courseId);
          log(`✓ ${b.courseName} · ${b.title}  [${plan.source}]`, '#7ee787');
        } catch (e) {
          fail++;
          log(`✗ ${b.courseName} · ${b.title}  — ${e.message}`, '#ff6b6b');
        }
        await sleep(400);
      }

      btn.textContent = `✓ Posted ${ok2}${fail ? ` · ${fail} failed` : ''}`;
      btn.style.background = fail ? '#3d3414' : '#143d2b';
      toast(`Batch reply: ${ok2} posted${fail ? ` · ${fail} failed` : ''}.`, fail ? '#ffb84d' : '#7ee787');

      // Refresh the affected courses so unlocked items disappear.
      if (affectedCourses.size && ctx) {
        try {
          await sleep(1200);
          await refreshPanelFromCourses(panel, [...affectedCourses], ctx);
          log(`↻ Rescanned ${affectedCourses.size} course(s)`, '#79c0ff');
        } catch (e) {
          log(`Rescan failed: ${e.message}`, '#ffb84d');
        }
      }

      setTimeout(() => { btn.disabled = false; btn.textContent = orig; btn.style.background = ''; }, 4000);
    };
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
    buildCatBreakdownHtml, buildBlockersListHtml,
    refreshPanelFromCourses,
    openReplyPanel, openDetailsPanel,
    wireReplyButtons, wireDetailsButtons,
    openSettings, refreshSettingsBadge,
    wireBatchPostButton,
    wireRescanButton, wireSweepRun,
    mountModulesWalker,
    toast,
    // Backwards-compat for older dashboards expecting the AI-only entry point.
    openAiSettings: openSettings,
  };
})();
