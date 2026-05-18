// 🚀 Unlock Modules — entry orchestrator.
//
// This file is intentionally tiny. Reading it should give you the full
// mental model of the tool in 30 seconds:
//
//   1. fetch favorited courses
//   2. scan blockers (with state map for prereq-change polling)
//   3. mount the panel
//   4. wire the buttons
//
// Each step delegates to one of the modules in tools/sweep/:
//
//   canvas-api.js — HTTP transport (pure infra)
//   policy.js     — academic-policy layer (the file the SCHOOL edits)
//   ai-client.js  — multi-provider AI for discussion drafts
//   engine.js     — sweep mechanics (walker, cycle loop, resume cache)
//   ui.js         — DOM panel + event handlers
//
// See sweep/README.md for the architecture map.

(async () => {
  const { engine, ui } = window.FEUSweep || {};
  if (!engine || !ui) {
    console.error('[Sweep] modules not loaded. Check popup.js FILE_MAP order.');
    return;
  }

  // 1. Discover favorited courses.
  const courses = await engine.scanFavoritedCourses();
  if (!courses.length) {
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;top:16px;right:16px;background:#0f1419;color:#ff6b6b;border:1px solid #30363d;border-radius:10px;padding:12px 16px;z-index:999999;font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px;';
    tmp.textContent = 'No favorited courses. Star your current-term subjects on the Canvas dashboard first.';
    document.body.appendChild(tmp);
    setTimeout(() => tmp.remove(), 5000);
    return;
  }

  // 2. Initial scan: blockers + module state map (used later for prereq polling).
  const { blockers, moduleStateMap } = await engine.scanInitialBlockers(courses);
  const courseById = new Map(courses.map(c => [c.id, c]));

  // 3. Mount the panel (UI side knows nothing about the engine).
  const panel = await ui.mountPanel({ courses, blockers, moduleStateMap });

  // 4. Wire interactive surfaces. ctx is the shared mutable bag both UI and
  //    engine read/write to.
  const ctx = { courses, courseById, blockers, moduleStateMap };
  ui.wireReplyButtons(panel, ctx);
  ui.wireDetailsButtons(panel);
  ui.openAiSettings(panel);
  ui.wireRescanButton(panel, ctx);
  ui.wireSweepRun(panel, ctx);
})();
