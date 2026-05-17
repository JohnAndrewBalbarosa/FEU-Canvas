// Canvas Auto-Next — fully automated module walker.
// Injects once, then auto-clicks the next-page button across every navigation
// until it hits a blocker (quiz, discussion, submission, locked module) or
// reaches the end of the course. Resumes across page loads using sessionStorage
// (per-tab), so closing the tab stops it cleanly.
//
// Usage: open Canvas (any content page or /courses/{id}/modules), F12 → Console
// → paste this → Enter. A small overlay appears in the top-right with Pause/Stop.

(() => {
  const FLAG = 'feuAutonextRunning';
  const REASON = 'feuAutonextReason';

  if (window.__feuAutonextInstalled) return;
  window.__feuAutonextInstalled = true;

  const DELAY = 4500;
  const JITTER = 1500;

  const SEL = {
    next: [
      'a.module-sequencing-button--next',
      '.module-sequence-footer-button--next a',
      '#module_navigation_next a',
      'a.module-sequence-footer-button--next',
      'a[rel="next"]',
    ],
    quiz: ['#submit_quiz_form', '.quiz-header', '#take_quiz_link', '.take_quiz_button'],
    discussion: ['.discussion-reply-action', '#discussion_topic'],
    assignment: ['#assignment_show', '.submit_assignment_link'],
    completionReq: '.completion_requirement',
    completionCheck: '.completion_requirement .icon-check, .completion_requirement .ig-icon-check',
  };

  const $ = (sels) => {
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  };

  const beep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.value = 0.08;
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 220);
    } catch (e) {}
  };

  const isRunning = () => sessionStorage.getItem(FLAG) === '1';
  const setRunning = (v) => v ? sessionStorage.setItem(FLAG, '1') : sessionStorage.removeItem(FLAG);
  const setReason = (msg) => msg ? sessionStorage.setItem(REASON, msg) : sessionStorage.removeItem(REASON);

  // ---------- Overlay ----------
  let ui = null;
  let countdownTimer = null;
  let tickTimer = null;
  let nextAt = 0;

  const buildOverlay = () => {
    document.getElementById('feu-autonext-ui')?.remove();
    const el = document.createElement('div');
    el.id = 'feu-autonext-ui';
    el.style.cssText = `
      position:fixed;top:14px;right:14px;z-index:999999;
      background:#0f1419;color:#e6edf3;border:1px solid #30363d;border-radius:999px;
      box-shadow:0 8px 24px rgba(0,0,0,.45);
      font:600 12px/1 ui-sans-serif,system-ui,sans-serif;
      padding:8px 12px;display:flex;align-items:center;gap:10px;
    `;
    el.innerHTML = `
      <span id="fa-dot" style="width:8px;height:8px;border-radius:50%;background:#7ee787;display:inline-block;"></span>
      <span id="fa-status" style="white-space:nowrap;">starting…</span>
      <button id="fa-pause" style="background:#1f6feb;color:white;border:none;border-radius:999px;padding:4px 10px;cursor:pointer;font:inherit;">Pause</button>
      <button id="fa-stop" style="background:transparent;color:#ff6b6b;border:1px solid #ff6b6b55;border-radius:999px;padding:4px 10px;cursor:pointer;font:inherit;">Stop</button>
    `;
    document.body.appendChild(el);
    el.querySelector('#fa-pause').onclick = () => isRunning() ? pause('paused by you') : resume();
    el.querySelector('#fa-stop').onclick = () => stop('stopped by you');
    return el;
  };

  const ensureUI = () => {
    if (!ui || !document.body.contains(ui)) ui = buildOverlay();
    return ui;
  };

  const setStatus = (txt, color = '#7ee787') => {
    const el = ensureUI();
    el.querySelector('#fa-dot').style.background = color;
    el.querySelector('#fa-status').textContent = txt;
    el.querySelector('#fa-pause').textContent = isRunning() ? 'Pause' : 'Resume';
  };

  const startCountdown = () => {
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      if (!isRunning()) return;
      const remaining = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
      setStatus(`▶ running · next in ${remaining}s`, '#7ee787');
    }, 250);
  };

  // ---------- Blocker / prereq detection ----------
  const detectBlocker = () => {
    if ($(SEL.quiz)) return 'quiz';
    if ($(SEL.discussion)) return 'discussion';
    if ($(SEL.assignment)) return 'assignment';
    const req = document.querySelector(SEL.completionReq);
    if (req && /must submit|must score|must contribute/i.test(req.innerText || '') && !document.querySelector(SEL.completionCheck)) {
      return 'completion requirement';
    }
    return null;
  };

  const findModuleJumpTarget = () => {
    if (!/\/modules\b/.test(location.pathname)) return null;
    const modules = document.querySelectorAll('.context_module:not(.locked_module)');
    for (const mod of modules) {
      const items = mod.querySelectorAll('.context_module_item');
      for (const item of items) {
        if (item.querySelector('.completion_requirement .icon-check, .completion_requirement .ig-icon-check')) continue;
        const link = item.querySelector('a.title.item_link, a.ig-title.title');
        if (link?.href) return link;
      }
    }
    return null;
  };

  const findLockedSiblingPrereq = () => {
    // Try the sidebar / context modules if visible
    const next = document.querySelector('.context_module.locked_module');
    if (!next) return null;
    const txt = (next.querySelector('.prerequisites_list, .prerequisites_message')?.innerText || '').trim();
    return txt || 'next module is locked';
  };

  // ---------- Tick ----------
  const tick = () => {
    if (!isRunning()) return;

    const blocker = detectBlocker();
    if (blocker) {
      pause(`⏸ paused at ${blocker}`);
      return;
    }

    // Modules-index auto-jump
    const jumpLink = findModuleJumpTarget();
    if (jumpLink) {
      setStatus(`→ entering module item`, '#79c0ff');
      jumpLink.click();
      return; // page will navigate; sessionStorage flag stays set
    }

    const nextBtn = $(SEL.next);
    if (!nextBtn) {
      const prereq = findLockedSiblingPrereq();
      if (prereq) {
        pause(`🔒 ${prereq.slice(0, 80)}`);
      } else {
        stop('✓ end of sequence');
      }
      return;
    }

    const title = document.title.replace(/^.*?:\s*/, '').slice(0, 60);
    setStatus(`→ ${title}`, '#79c0ff');
    nextBtn.click();
    // Page nav will happen; if SPA-style and no nav, schedule another tick
    nextAt = Date.now() + DELAY + Math.random() * JITTER;
    clearTimeout(tickTimer);
    tickTimer = setTimeout(tick, DELAY + Math.random() * JITTER);
    startCountdown();
  };

  const scheduleFirstTick = () => {
    nextAt = Date.now() + DELAY;
    clearTimeout(tickTimer);
    tickTimer = setTimeout(tick, DELAY);
    startCountdown();
  };

  // ---------- Lifecycle ----------
  const start = () => {
    setRunning(true);
    setReason('');
    ensureUI();
    setStatus('▶ running', '#7ee787');
    scheduleFirstTick();
  };

  const resume = () => {
    setReason('');
    setRunning(true);
    setStatus('▶ resumed', '#7ee787');
    scheduleFirstTick();
  };

  const pause = (reason) => {
    setRunning(false);
    setReason(reason);
    clearTimeout(tickTimer);
    clearInterval(countdownTimer);
    setStatus(reason, '#ffb84d');
    beep();
  };

  const stop = (reason) => {
    setRunning(false);
    setReason('');
    clearTimeout(tickTimer);
    clearInterval(countdownTimer);
    setStatus(reason, '#8b949e');
    beep();
    setTimeout(() => { ui?.remove(); }, 2500);
  };

  // ---------- Boot ----------
  // If resuming from a previous page (sessionStorage still set), continue.
  // If fresh inject (flag not set), auto-start.
  const boot = () => {
    if (isRunning()) {
      ensureUI();
      setStatus('▶ resumed', '#7ee787');
      // Give the page a moment to settle before next click
      nextAt = Date.now() + 1500;
      clearTimeout(tickTimer);
      tickTimer = setTimeout(tick, 1500);
      startCountdown();
    } else {
      start();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.FEUAutoNext = { start, pause: () => pause('paused by you'), resume, stop: () => stop('stopped by you') };
})();
