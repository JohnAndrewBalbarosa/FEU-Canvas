// Canvas Auto-Sweep — unified blockers view + bulk unlock + categorization.
// Scans all favorited courses, categorizes every blocker, auto-completes only
// must_view + must_mark_done. Saves a sweep result to localStorage so the
// dashboard can show "recently unlocked" banner.

(async () => {
  const BASE = location.origin;
  const SWEEP_KEY = 'feuLastSweep';
  const AI_KEY = 'feuAIConfig';

  // ============================================================
  // AI Middleman — unified protocol: AI.generate({system, user, maxTokens}) → text
  // To add a vendor: implement a function in PROVIDERS that takes
  // ({ apiKey, model, system, user, maxTokens }) and returns text.
  // ============================================================
  const PROVIDERS = {
    openai: async ({ apiKey, model, system, user, maxTokens }) => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() ?? '';
    },
    anthropic: async ({ apiKey, model, system, user, maxTokens }) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model, system,
          messages: [{ role: 'user', content: user }],
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return data.content?.[0]?.text?.trim() ?? '';
    },
    gemini: async ({ apiKey, model, system, user, maxTokens }) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    },
    groq: async ({ apiKey, model, system, user, maxTokens }) => {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() ?? '';
    },
  };

  const PROVIDER_META = {
    openai:    { label: 'OpenAI',    placeholder: 'gpt-4o-mini', keyHint: 'sk-...' },
    anthropic: { label: 'Anthropic', placeholder: 'claude-3-5-haiku-latest', keyHint: 'sk-ant-...' },
    gemini:    { label: 'Gemini',    placeholder: 'gemini-2.0-flash', keyHint: 'AIza...' },
    groq:      { label: 'Groq',      placeholder: 'llama-3.3-70b-versatile', keyHint: 'gsk_...' },
  };

  const AI = {
    getConfig() {
      try { return JSON.parse(localStorage.getItem(AI_KEY) || '{}'); } catch { return {}; }
    },
    setConfig(cfg) { localStorage.setItem(AI_KEY, JSON.stringify(cfg)); },
    clearConfig() { localStorage.removeItem(AI_KEY); },
    isConfigured() {
      const c = this.getConfig();
      return !!(c.provider && c.apiKey && c.model);
    },
    async generate({ system, user, maxTokens = 400 }) {
      const cfg = this.getConfig();
      if (!cfg.provider || !cfg.apiKey || !cfg.model) {
        throw new Error('AI not configured. Click ⚙️ AI in the header.');
      }
      const handler = PROVIDERS[cfg.provider];
      if (!handler) throw new Error(`Unknown provider: ${cfg.provider}`);
      console.log(`[AI] → ${cfg.provider}/${cfg.model} (${user.length} chars in)`);
      const out = await handler({ apiKey: cfg.apiKey, model: cfg.model, system, user, maxTokens });
      console.log(`[AI] ← ${out.length} chars out`);
      return out;
    },
  };
  // ============================================================

  // ---------- helpers ----------
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

  const csrf = () => {
    // Try cookie first (URL-decoded), then meta tag, then form input
    const cookieMatch = document.cookie.match(/_csrf_token=([^;]+)/);
    if (cookieMatch) return decodeURIComponent(cookieMatch[1]);
    const meta = document.querySelector('meta[name="csrf-token"]')?.content;
    if (meta) return meta;
    const input = document.querySelector('input[name="authenticity_token"]')?.value;
    if (input) return input;
    return '';
  };

  // Tiny delay to avoid burst-triggering 403/429
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const limit = (n) => {
    let active = 0; const q = [];
    const next = () => { if (q.length && active < n) { active++; q.shift()().finally(() => { active--; next(); }); } };
    return (fn) => new Promise((res, rej) => { q.push(() => fn().then(res, rej)); next(); });
  };
  const cap = limit(3);

  const TYPE_LABEL = {
    must_view: 'View', must_mark_done: 'Mark Done', must_contribute: 'Reply',
    must_submit: 'Submit', min_score: 'Score',
  };
  const QUICK_TYPES = new Set(['must_view', 'must_mark_done']);

  // Draft generator for must_contribute (discussion) items
  const buildDraft = (title, courseName) => {
    const topic = (title || '').replace(/^\s*(end of module|discussion[:\s-]*)/i, '').trim() || 'this module';
    const variants = [
      `My main takeaway from ${topic} is how it connects what we covered earlier with the actual practice. The material made me rethink a few assumptions, especially around the parts I had only surface-level understanding of before. I'll try to apply this in the next activity.`,
      `What stood out to me in ${topic} is how it reframes the problem from a different angle than I expected. Before this, I had only thought about it one way, but the readings made the bigger picture clearer. I want to read further on this in the next module.`,
      `From ${topic}, the most useful idea for me was how the concepts work together rather than as isolated steps. I appreciated the structure of the discussion and it pushed me to think about how I'd handle a similar situation outside of class.`,
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  };

  const CAT = {
    SOCIAL:     { key: 'SOCIAL',     label: 'Social',     color: '#a371f7' },
    REFLECTION: { key: 'REFLECTION', label: 'Reflection', color: '#79c0ff' },
    FORMATIVE:  { key: 'FORMATIVE',  label: 'Formative',  color: '#7ee787' },
    SUMMATIVE:  { key: 'SUMMATIVE',  label: 'Summative',  color: '#ff6b6b' },
    ACTIVITY:   { key: 'ACTIVITY',   label: 'Activity',   color: '#ffb84d' },
    READING:    { key: 'READING',    label: 'Reading',    color: '#8b949e' },
  };
  const categorize = ({ name, itemType, type, points }) => {
    const t = (name || '').toLowerCase();
    if (/fellow\s*itammaraw|introduce yourself|introduction discussion|getting to know|\bintro\b/i.test(t)) return CAT.SOCIAL;
    if (/end of module|wrap.?up|reflection|what.+(learn|takeaway)|module recap|conclusion/i.test(t)) return CAT.REFLECTION;
    if (/\bsa\s*\d|summative|major exam|prelim|midterm|\bfinal(s|\s*exam|\s*assessment)?\b|\bexam\b/i.test(t)) return CAT.SUMMATIVE;
    if (/\bfa\s*\d|formative|practice|self.?check|checkup|drill|quiz\s*\d/i.test(t)) return CAT.FORMATIVE;
    if (itemType === 'Quiz') return points && points >= 50 ? CAT.SUMMATIVE : CAT.FORMATIVE;
    if (itemType === 'Assignment') return points && points >= 50 ? CAT.SUMMATIVE : CAT.ACTIVITY;
    if (itemType === 'Discussion' || type === 'must_contribute') return CAT.REFLECTION;
    if (itemType === 'Page' || itemType === 'File' || type === 'must_view') return CAT.READING;
    return CAT.ACTIVITY;
  };
  const chip = (cat) => `<span style="background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}55;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">${cat.label}</span>`;

  // ---------- panel ----------
  document.getElementById('feu-sweep')?.remove();
  const panel = document.createElement('div');
  panel.id = 'feu-sweep';
  panel.style.cssText = `
    position:fixed;top:16px;right:16px;width:560px;max-height:88vh;overflow:auto;
    background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:10px;
    box-shadow:0 12px 40px rgba(0,0,0,.5);font-family:ui-sans-serif,system-ui,sans-serif;
    z-index:999999;padding:14px 16px;font-size:13px;line-height:1.4;
  `;
  panel.innerHTML = `<div id="sw-root">Loading… scanning favorited courses…</div>`;
  document.body.appendChild(panel);
  const root = () => panel.querySelector('#sw-root');

  // ---------- 1. Favorited courses ----------
  let favs = await apiList('/api/v1/users/self/favorites/courses');
  if (!favs.length) {
    const cards = await apiList('/api/v1/dashboard/dashboard_cards');
    favs = cards.map(c => ({ id: c.id, name: c.shortName || c.originalName || c.courseCode }));
  }
  const courses = favs.map(c => ({ id: c.id, name: c.name || c.shortName || c.course_code }));
  if (!courses.length) { root().innerHTML = '<div style="color:#ff6b6b;">No favorited courses.</div>'; return; }

  // ---------- 2. Scan modules in parallel ----------
  root().innerHTML = `Scanning ${courses.length} courses…`;
  const scans = await Promise.all(courses.map(c =>
    apiList(`/api/v1/courses/${c.id}/modules?include[]=items&include[]=content_details`)
      .catch(() => [])
      .then(m => ({ course: c, modules: m }))
  ));

  const blockers = [];
  const moduleStates = {}; // { 'courseName||moduleName': state }
  for (const { course, modules } of scans) {
    for (const mod of modules) {
      if (mod.state === 'completed') continue;
      const stateKey = `${course.name}||${mod.name}`;
      moduleStates[stateKey] = mod.state || 'unlocked';
      const moduleLocked = mod.state === 'locked';
      for (const item of (mod.items || [])) {
        const req = item.completion_requirement;
        if (!req || req.completed) continue;
        const points = item.content_details?.points_possible ?? null;
        const cat = categorize({ name: item.title, itemType: item.type, type: req.type, points });
        blockers.push({
          courseId: course.id, courseName: course.name,
          moduleId: mod.id, moduleName: mod.name, modulePosition: mod.position ?? 999,
          moduleState: mod.state || 'unlocked',
          moduleLocked,
          itemPosition: item.position ?? 999,
          itemId: item.id, title: item.title, itemType: item.type,
          contentId: item.content_id ?? null, // for discussions = topic_id
          reqType: req.type, url: item.html_url, points, cat,
          quick: QUICK_TYPES.has(req.type) && !moduleLocked,
        });
      }
    }
  }

  // Module state emoji + label
  const modBadge = (state) => {
    if (state === 'locked')    return { emoji: '🔒', color: '#ff6b6b', label: 'locked' };
    if (state === 'started')   return { emoji: '⏳', color: '#ffb84d', label: 'in progress' };
    if (state === 'unlocked')  return { emoji: '🔓', color: '#7ee787', label: 'unlocked' };
    return { emoji: '·', color: '#8b949e', label: state || 'open' };
  };

  // Item state emoji
  const itemBadge = (b) => {
    if (b.moduleLocked) return { emoji: '🔒', color: '#ff6b6b', label: 'prereq-locked' };
    if (b.quick)        return { emoji: '🔓', color: '#7ee787', label: 'auto-unlockable' };
    return                       { emoji: '🟡', color: '#ffb84d', label: 'needs you' };
  };

  // ---------- 3. Bucket ----------
  const quickQueue = blockers.filter(b => b.quick);
  const manualList = blockers.filter(b => !b.quick);

  const byCategory = {};
  for (const b of blockers) (byCategory[b.cat.key] ??= { cat: b.cat, items: [] }).items.push(b);

  // ---------- 4. Render preview ----------
  const renderItem = (b) => {
    const isReplyable = (b.reqType === 'must_contribute' || b.itemType === 'Discussion') && b.contentId && !b.moduleLocked;
    const badge = itemBadge(b);
    const itemKey = `${b.courseId}-${b.itemId}`;
    return `
    <div id="sw-item-${itemKey}" style="border-left:3px solid ${b.cat.color};padding:5px 10px;margin:3px 0;background:#161b22;border-radius:0 6px 6px 0;${b.moduleLocked ? 'opacity:.65;' : ''}">
      <div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start;">
        <span style="flex:1;display:flex;gap:6px;align-items:flex-start;">
          <span title="${badge.label}" style="font-size:12px;flex:0 0 auto;">${badge.emoji}</span>
          <a href="${b.url}" target="_blank" style="color:#79c0ff;text-decoration:none;font-size:12px;">${b.title}</a>
        </span>
        ${chip(b.cat)}
      </div>
      <div style="font-size:10.5px;margin-top:2px;display:flex;justify-content:space-between;align-items:center;opacity:.85;">
        <span>${b.courseName} · ${b.moduleName}</span>
        <span style="display:flex;gap:6px;align-items:center;">
          ${isReplyable ? `<button class="sw-reply-toggle" data-key="${itemKey}" data-course-id="${b.courseId}" data-topic-id="${b.contentId}" data-title="${b.title.replace(/"/g, '&quot;')}" style="background:#1f6feb;color:white;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:10px;font-weight:600;">💬 Reply ↓</button>` : ''}
          <span style="color:${badge.color};">${TYPE_LABEL[b.reqType] || b.reqType}${b.points ? ` · ${b.points} pts` : ''}</span>
        </span>
      </div>
      ${isReplyable ? `<div class="sw-reply-panel" data-key="${itemKey}" style="display:none;margin-top:8px;padding:10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;"></div>` : ''}
    </div>`;
  };

  const catBreakdown = Object.values(byCategory)
    .sort((a, b) => b.items.length - a.items.length)
    .map(({ cat, items }) => `<span style="background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}55;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;">${cat.label} ${items.length}</span>`)
    .join(' ');

  // ---------- DOM walker (when on /modules page) ----------
  // Notify-only: read-only DOM scan of the current Modules page so the user
  // can see prereq text + open all click-ready (non-submit/non-quiz) items
  // in new tabs. Submissions, quizzes, discussions are NEVER auto-clicked.
  const onModulesPage = /\/courses\/\d+\/modules\b/.test(location.pathname)
    && !!document.querySelector('#context_modules');

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
        return {
          title: stripText(link) || stripText(item.querySelector('.ig-title')) || '(untitled)',
          href: link?.href || null,
          complete, heavy, requirement: reqText,
        };
      });
      return { name, locked, completed, started, prereqText, items };
    });
  };

  let domModules = [];
  let domOpenable = [];
  if (onModulesPage) {
    await expandCollapsedDOM();
    domModules = scanDOMModules();
    domOpenable = [];
    for (const m of domModules) {
      if (m.locked) continue;
      for (const it of m.items) {
        if (!it.href || it.complete || it.heavy) continue;
        domOpenable.push(it);
      }
    }
  }

  const walkerHtml = !onModulesPage ? '' : (() => {
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
  })();

  root().innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <strong style="font-size:15px;">🪄 Auto-Sweep</strong>
      <div style="display:flex;gap:4px;">
        <button id="sw-autonext" title="Headless autonext — auto-clicks Next across pages, stops at quizzes/discussions/submissions/locked modules" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11px;">
          ⏭ Autonext <span id="sw-an-dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${sessionStorage.getItem('feuAutonext') === '1' ? '#7ee787' : '#8b949e'};margin-left:2px;"></span>
        </button>
        <button id="sw-ai-settings" title="AI settings" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11px;">
          ⚙️ AI <span id="sw-ai-dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${AI.isConfigured() ? '#7ee787' : '#8b949e'};margin-left:2px;"></span>
        </button>
        <button id="sw-close" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:2px 8px;cursor:pointer;">×</button>
      </div>
    </div>
    <div id="sw-ai-panel" style="display:none;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px;margin-bottom:10px;"></div>
    <div style="font-size:11px;opacity:.7;margin-bottom:10px;">${courses.length} favorited courses · ${blockers.length} total blockers</div>

    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">${catBreakdown}</div>

    ${walkerHtml}

    <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:600;color:#7ee787;">Quick unlocks: ${quickQueue.length}</div>
      <div style="font-size:11px;opacity:.75;margin-top:2px;">Will auto-complete <code style="background:#161b22;padding:1px 4px;border-radius:3px;">must_view</code> + <code style="background:#161b22;padding:1px 4px;border-radius:3px;">must_mark_done</code> only. Never submits assignments or takes quizzes.</div>
      <div style="font-size:13px;font-weight:600;color:#ffb84d;margin-top:8px;">Manual needed: ${manualList.length}</div>
      <div style="font-size:11px;opacity:.75;margin-top:2px;">Discussions, submissions, quizzes — listed below for you to handle.</div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <button id="sw-run" ${quickQueue.length ? '' : 'disabled'} style="flex:1;background:${quickQueue.length ? '#1f6feb' : '#30363d'};color:white;border:none;border-radius:6px;padding:8px;cursor:${quickQueue.length ? 'pointer' : 'not-allowed'};font-weight:600;">
        Run sweep — unlock ${quickQueue.length}
      </button>
      <button id="sw-skip" style="background:transparent;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:8px 14px;cursor:pointer;">View only</button>
    </div>

    ${(() => {
      // Group: course → module → items
      const byCourse = {};
      for (const b of blockers) {
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
              m.items.sort((a, b) => a.itemPosition - b.itemPosition);
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
    })()}
  `;

  panel.querySelector('#sw-close').onclick = () => panel.remove();
  panel.querySelector('#sw-skip').onclick = () => panel.remove();

  // ----- Headless autonext toggle -----
  const anBtn = panel.querySelector('#sw-autonext');
  const anDot = panel.querySelector('#sw-an-dot');
  const refreshAnDot = () => {
    anDot.style.background = sessionStorage.getItem('feuAutonext') === '1' ? '#7ee787' : '#8b949e';
  };
  anBtn.onclick = () => {
    if (sessionStorage.getItem('feuAutonext') === '1') {
      sessionStorage.removeItem('feuAutonext');
      toast('Autonext stopped.', '#ffb84d');
    } else {
      sessionStorage.setItem('feuAutonext', '1');
      toast('Autonext started — will stop at quizzes, discussions, submissions, or locked modules.', '#7ee787');
      // Kick the runner immediately on this page so the user sees motion.
      setTimeout(() => {
        const next = document.querySelector('a.module-sequencing-button--next, .module-sequence-footer-button--next a, #module_navigation_next a, a[rel="next"]');
        if (next) next.click();
      }, 400);
    }
    refreshAnDot();
  };

  // Walker "open in tabs" wiring
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

  // ----- AI settings panel -----
  const aiPanel = panel.querySelector('#sw-ai-panel');
  const aiDot = panel.querySelector('#sw-ai-dot');
  const renderAIPanel = () => {
    const cfg = AI.getConfig();
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
      const cfg = {
        provider: providerSel.value,
        model: modelInput.value.trim(),
        apiKey: keyInput.value.trim(),
      };
      if (!cfg.model || !cfg.apiKey) {
        status.textContent = 'Both model and API key required.';
        status.style.color = '#ff6b6b';
        return;
      }
      AI.setConfig(cfg);
      aiDot.style.background = '#7ee787';
      status.textContent = '✓ Saved.';
      status.style.color = '#7ee787';
      setTimeout(() => { aiPanel.style.display = 'none'; }, 600);
    };
    aiPanel.querySelector('#sw-ai-clear').onclick = () => {
      if (confirm('Clear stored AI config?')) {
        AI.clearConfig();
        aiDot.style.background = '#8b949e';
        renderAIPanel();
        status.textContent = 'Cleared.';
      }
    };
    aiPanel.querySelector('#sw-ai-cancel').onclick = () => { aiPanel.style.display = 'none'; };
  };
  panel.querySelector('#sw-ai-settings').onclick = () => {
    if (aiPanel.style.display === 'none') {
      renderAIPanel();
      aiPanel.style.display = 'block';
    } else {
      aiPanel.style.display = 'none';
    }
  };

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

  // Reply panel — fetches the discussion prompt, lets user type + review + submit
  const openReplyPanel = async (toggleBtn) => {
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

    // Fetch the discussion prompt
    let promptText = '(could not load prompt)';
    try {
      const res = await fetch(`${BASE}/api/v1/courses/${courseId}/discussion_topics/${topicId}`, {
        credentials: 'include', headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        promptText = stripHtml(data.message).slice(0, 800);
      }
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
      if (AI.isConfigured()) {
        btn.disabled = true;
        btn.textContent = '⏳ Generating…';
        statusEl.textContent = '';
        try {
          const system = "You are helping a Filipino college student write an authentic 'end of module' reflection for an online discussion in Canvas. Output 3 to 4 sentences in first-person English. Reference one specific concept from the prompt. Keep it natural and student-like — no formal academic phrasing, no bullet points, no headings. Do not include a salutation or signature.";
          const userMsg = `Discussion title: ${title}\n\nDiscussion prompt:\n${promptText}\n\nWrite a brief reflection.`;
          const ai = await AI.generate({ system, user: userMsg, maxTokens: 400 });
          textarea.value = ai;
          textarea.focus();
          statusEl.textContent = '✨ AI draft generated. Edit it to match your own thinking before posting.';
          statusEl.style.color = '#ffb84d';
        } catch (e) {
          statusEl.textContent = `AI error: ${e.message}. Falling back to template.`;
          statusEl.style.color = '#ff6b6b';
          textarea.value = buildDraft(title, '');
        } finally {
          btn.disabled = false;
          btn.textContent = originalLabel;
        }
      } else {
        textarea.value = buildDraft(title, '');
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
        const token = csrf();
        const res = await fetch(`${BASE}/api/v1/courses/${courseId}/discussion_topics/${topicId}/entries`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'X-CSRF-Token': token,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({ message }),
        });
        if (res.ok) {
          statusEl.textContent = '✅ Posted. Refresh Auto-Sweep to update status.';
          statusEl.style.color = '#7ee787';
          submitBtn.textContent = '✓ Posted';
          submitBtn.style.background = '#143d2b';
          // Visually mark the item
          const itemDiv = document.getElementById(`sw-item-${key}`);
          if (itemDiv) itemDiv.style.opacity = '.5';
          toast('Reply posted.');
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
  panel.querySelectorAll('.sw-reply-toggle').forEach(btn => {
    btn.onclick = (e) => { e.preventDefault(); openReplyPanel(btn); };
  });

  // ---------- 5. Run sweep ----------
  if (!quickQueue.length) return;

  panel.querySelector('#sw-run').onclick = async () => {
    const btn = panel.querySelector('#sw-run');
    btn.disabled = true; btn.textContent = 'Running…';
    btn.style.background = '#30363d'; btn.style.cursor = 'not-allowed';

    const token = csrf();
    const results = [];
    let done = 0, failed = 0;

    const logBox = document.createElement('div');
    logBox.style.cssText = 'margin-top:10px;font-size:11px;font-family:ui-monospace,monospace;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px;max-height:240px;overflow:auto;';
    logBox.innerHTML = '<div id="sw-prog" style="font-weight:600;">Starting…</div><div id="sw-log"></div>';
    panel.appendChild(logBox);
    const setProg = (t) => { logBox.querySelector('#sw-prog').textContent = t; };
    const log = (msg, color) => {
      const d = document.createElement('div');
      d.style.color = color; d.textContent = msg;
      logBox.querySelector('#sw-log').appendChild(d);
      logBox.scrollTop = logBox.scrollHeight;
    };

    await Promise.all(quickQueue.map(item => cap(async () => {
      try {
        await sleep(200 + Math.random() * 300); // stagger to avoid burst throttling
        const path = item.reqType === 'must_view'
          ? `/api/v1/courses/${item.courseId}/modules/${item.moduleId}/items/${item.itemId}/mark_read`
          : `/api/v1/courses/${item.courseId}/modules/${item.moduleId}/items/${item.itemId}/done`;
        const method = item.reqType === 'must_view' ? 'POST' : 'PUT';
        const res = await fetch(BASE + path, {
          method,
          credentials: 'include',
          headers: {
            'X-CSRF-Token': token,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        });
        if (res.ok) {
          done++;
          log(`✓ ${item.title.slice(0, 70)}`, '#7ee787');
          results.push({ ...item, ok: true });
        } else {
          failed++;
          log(`✗ ${item.title.slice(0, 70)} (${res.status})`, '#ff6b6b');
          results.push({ ...item, ok: false, status: res.status });
        }
      } catch (e) {
        failed++;
        log(`✗ ${item.title.slice(0, 70)} (${e.message})`, '#ff6b6b');
        results.push({ ...item, ok: false, error: e.message });
      }
      setProg(`${done + failed} / ${quickQueue.length} · ${done} ok · ${failed} failed`);
    })));

    setProg(`Sweep done. ${done} unlocked · ${failed} failed.`);
    btn.textContent = `✓ Unlocked ${done}`;
    btn.style.background = '#143d2b';

    // Save sweep result so dashboard can show "recently unlocked" banner
    const unlocked = results.filter(r => r.ok).map(r => ({
      title: r.title, courseName: r.courseName, moduleName: r.moduleName,
      url: r.url, cat: { label: r.cat.label, color: r.cat.color, key: r.cat.key },
      reqType: r.reqType, itemType: r.itemType,
    }));
    try {
      localStorage.setItem(SWEEP_KEY, JSON.stringify({ at: Date.now(), unlocked, manualPending: manualList.length }));
      localStorage.removeItem('feuDashCache'); // force dashboard refetch
    } catch {}

    console.log(`%c[Sweep] Unlocked ${done}, ${manualList.length} still need manual handling.`, 'color:#7ee787;font-weight:bold');
    window.FEULastSweep = { unlocked, manual: manualList };
  };
})();
