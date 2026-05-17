// Headless autonext runner. Registered as a content_script in manifest.json so
// it loads on every Canvas page. Does nothing unless sessionStorage.feuAutonext
// === '1' (set by the Auto-Sweep panel's toggle). When active, it clicks the
// in-content "Next" button on a delay, auto-jumps from /modules into the first
// click-ready item, and clears the flag (stopping itself) the moment it sees a
// blocker — quiz, discussion, submission requirement, or a locked next module.
// No UI, no keybindings, no audio. Status goes to console only.

(() => {
  const FLAG = 'feuAutonext';
  if (sessionStorage.getItem(FLAG) !== '1') return;
  if (window.__feuAutonextRunning) return;
  window.__feuAutonextRunning = true;

  const DELAY = 4500;
  const JITTER = 1500;
  const SETTLE_MS = 1200;

  const NEXT_SEL = [
    'a.module-sequencing-button--next',
    '.module-sequence-footer-button--next a',
    '#module_navigation_next a',
    'a.module-sequence-footer-button--next',
    'a[rel="next"]',
  ];
  const QUIZ = ['#submit_quiz_form', '.quiz-header', '#take_quiz_link', '.take_quiz_button'];
  const DISCUSSION = ['.discussion-reply-action', '#discussion_topic'];
  const ASSIGNMENT = ['#assignment_show', '.submit_assignment_link'];
  const COMP_REQ = '.completion_requirement';
  const COMP_CHECK = '.completion_requirement .icon-check, .completion_requirement .ig-icon-check';

  const $ = (sels) => {
    for (const s of sels) { const el = document.querySelector(s); if (el) return el; }
    return null;
  };

  const stop = (reason) => {
    sessionStorage.removeItem(FLAG);
    console.log(`%c[Autonext] stopped — ${reason}`, 'color:#ffb84d;font-weight:bold');
  };

  const detectBlocker = () => {
    if ($(QUIZ)) return 'quiz on this page';
    if ($(DISCUSSION)) return 'discussion on this page';
    if ($(ASSIGNMENT)) return 'assignment on this page';
    const req = document.querySelector(COMP_REQ);
    if (req && /must submit|must score|must contribute/i.test(req.innerText || '') && !document.querySelector(COMP_CHECK)) {
      return 'page requires submit/score/contribute';
    }
    return null;
  };

  const findModuleJumpTarget = () => {
    if (!/\/courses\/\d+\/modules\b/.test(location.pathname)) return null;
    const modules = document.querySelectorAll('.context_module:not(.locked_module)');
    for (const mod of modules) {
      for (const item of mod.querySelectorAll('.context_module_item')) {
        if (item.querySelector('.completion_requirement .icon-check, .completion_requirement .ig-icon-check')) continue;
        const link = item.querySelector('a.title.item_link, a.ig-title.title');
        if (link?.href) return link;
      }
    }
    return null;
  };

  const findLockedPrereq = () => {
    const locked = document.querySelector('.context_module.locked_module');
    if (!locked) return null;
    return (locked.querySelector('.prerequisites_list, .prerequisites_message')?.innerText || '').trim()
      || 'next module is locked';
  };

  const tick = () => {
    if (sessionStorage.getItem(FLAG) !== '1') return;

    const blocker = detectBlocker();
    if (blocker) { stop(blocker); return; }

    const jump = findModuleJumpTarget();
    if (jump) {
      console.log(`[Autonext] → entering ${jump.textContent.trim().slice(0, 60)}`);
      jump.click();
      return;
    }

    const nextBtn = $(NEXT_SEL);
    if (!nextBtn) {
      const prereq = findLockedPrereq();
      if (prereq) stop(`locked: ${prereq.slice(0, 100)}`);
      else stop('end of sequence');
      return;
    }

    const title = document.title.replace(/^.*?:\s*/, '').slice(0, 60);
    console.log(`[Autonext] → ${title}`);
    nextBtn.click();
  };

  // Wait for page to settle before first action on this navigation.
  setTimeout(tick, SETTLE_MS + Math.random() * JITTER);

  // If Canvas leaves us on the same URL (SPA-ish content swap, no nav),
  // schedule a follow-up tick.
  setTimeout(() => {
    if (sessionStorage.getItem(FLAG) === '1') tick();
  }, SETTLE_MS + DELAY + Math.random() * JITTER);
})();
