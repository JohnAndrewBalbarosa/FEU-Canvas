// Sweep engine — pure module mechanics, no DOM.
//
// Depends on: window.FEUSweep.api, window.FEUSweep.policy.
//
// Public surface:
//   scanFavoritedCourses()                  → [{id, name}]
//   scanInitialBlockers(courses)            → { blockers[], moduleStateMap }
//   apiModulesToBlockers(course, modules)   → blockers[]
//   refreshBlockersForCourses(courseIds, courseById, current, moduleStateMap)
//                                           → fresh blockers[]
//   resumeCache.{read, write, clear}        → localStorage shim
//   runUnlockModules({...}, callbacks)      → orchestrator (cycle loop)
//
// runUnlockModules takes a callback bag so the UI can subscribe to log
// lines, progress text, and final summaries — the engine never touches
// the DOM directly. This is the seam that makes the engine swappable.

(() => {
  window.FEUSweep = window.FEUSweep || {};
  const { api, policy } = window.FEUSweep;
  if (!api || !policy) {
    console.error('[Sweep engine] requires canvas-api.js and policy.js loaded first');
    return;
  }
  const { BASE, apiList, apiListFresh, csrf, sleep, limit } = api;
  const { QUICK_TYPES, HEAVY_TYPES, categorize } = policy;

  // -------- Course / blocker discovery --------

  const scanFavoritedCourses = async () => {
    let favs = await apiList('/api/v1/users/self/favorites/courses');
    if (!favs.length) {
      const cards = await apiList('/api/v1/dashboard/dashboard_cards');
      favs = cards.map(c => ({ id: c.id, name: c.shortName || c.originalName || c.courseCode }));
    }
    return favs.map(c => ({ id: c.id, name: c.name || c.shortName || c.course_code }));
  };

  // Pure: Canvas API modules[] → blockers[] in our enriched shape.
  // Used both by the initial scan and by per-course rescans/refresh.
  const apiModulesToBlockers = (course, modules) => {
    const out = [];
    for (const mod of modules) {
      if (mod.state === 'completed') continue;
      const moduleLocked = mod.state === 'locked';
      for (const item of (mod.items || [])) {
        const req = item.completion_requirement;
        if (!req || req.completed) continue;
        const cd = item.content_details || {};
        const points = cd.points_possible ?? null;
        const cat = categorize({ name: item.title, itemType: item.type, type: req.type, points });
        out.push({
          courseId: course.id, courseName: course.name,
          moduleId: mod.id, moduleName: mod.name, modulePosition: mod.position ?? 999,
          moduleState: mod.state || 'unlocked',
          moduleLocked,
          itemPosition: item.position ?? 999,
          itemId: item.id, title: item.title, itemType: item.type,
          contentId: item.content_id ?? null,
          reqType: req.type, url: item.html_url, points, cat,
          quick: QUICK_TYPES.has(req.type) && !moduleLocked,
          dueAt: cd.due_at || null,
          unlockAt: cd.unlock_at || null,
          lockAt: cd.lock_at || null,
          lockedForUser: cd.locked_for_user || false,
        });
      }
    }
    return out;
  };

  // First scan: pulls every favorited course's modules, returns blockers and
  // seeds the moduleStateMap for later state-change polling.
  const scanInitialBlockers = async (courses) => {
    const scans = await Promise.all(courses.map(c =>
      apiList(`/api/v1/courses/${c.id}/modules?include[]=items&include[]=content_details`)
        .catch(() => [])
        .then(modules => ({ course: c, modules }))
    ));
    const blockers = [];
    const moduleStateMap = new Map();
    for (const { course, modules } of scans) {
      for (const mod of modules) {
        moduleStateMap.set(`${course.id}-${mod.id}`, mod.state || 'unlocked');
      }
      blockers.push(...apiModulesToBlockers(course, modules));
    }
    return { blockers, moduleStateMap };
  };

  // Refresh a subset of courses with fresh (cache-bypass) fetch. Merges in
  // any untouched-course blockers from `current` so callers can replace
  // their blockers array atomically.
  const refreshBlockersForCourses = async (courseIds, courseById, current, moduleStateMap) => {
    const scans = await Promise.all([...courseIds].map(id => {
      const course = courseById.get(id);
      if (!course) return Promise.resolve(null);
      return apiListFresh(`/api/v1/courses/${id}/modules?include[]=items&include[]=content_details`)
        .catch(() => [])
        .then(modules => ({ course, modules }));
    }));
    const touchedIds = new Set(courseIds);
    const fresh = [];
    for (const scan of scans) {
      if (!scan) continue;
      const { course, modules } = scan;
      for (const mod of modules) {
        moduleStateMap.set(`${course.id}-${mod.id}`, mod.state || 'unlocked');
      }
      fresh.push(...apiModulesToBlockers(course, modules));
    }
    for (const b of current) {
      if (!touchedIds.has(b.courseId)) fresh.push(b);
    }
    return fresh;
  };

  // -------- Resume cache (per-course "last module I made progress on") --------

  const RESUME_KEY = 'feuSweepResume';
  const resumeCache = {
    read() {
      try { return JSON.parse(localStorage.getItem(RESUME_KEY) || '{}'); }
      catch { return {}; }
    },
    write(obj) {
      try { localStorage.setItem(RESUME_KEY, JSON.stringify(obj)); } catch {}
    },
    clear() {
      try { localStorage.removeItem(RESUME_KEY); } catch {}
    },
  };

  // -------- The unlock-modules cycle (the big one) --------

  /**
   * Run the module-parallel sequential walker until cascade drains.
   *
   * @param {object} input
   * @param {Array} input.courses                    - all favorited courses
   * @param {Map}   input.courseById                 - id → course
   * @param {Map}   input.moduleStateMap             - mutates as state evolves
   * @param {object} callbacks
   * @param {function(string, string)} callbacks.log   - (msg, hexColor) → void
   * @param {function(string)}         callbacks.setProgress
   * @param {function(Array<string>)}  callbacks.refreshPanel - rescan course ids
   *
   * @returns {Promise<{cycles, totalWalked, totalDone, totalFailed,
   *                    stopsAtHeavy, stopsSkipped, allResults, stopReason}>}
   */
  const runUnlockModules = async (input, callbacks) => {
    const { courses, courseById, moduleStateMap, targetCourseIds } = input;
    const { log, setProgress, refreshPanel } = callbacks;
    // Optional scoping: when targetCourseIds is provided, only walk those
    // courses. Used e.g. after a discussion-reply post to cascade just
    // that course without touching siblings.
    const targetSet = targetCourseIds ? new Set(targetCourseIds) : null;
    const coursesToScan = targetSet ? courses.filter(c => targetSet.has(c.id)) : courses;

    const token = csrf();
    const MAX_CYCLES = 8;
    const MODULE_CONCURRENCY = 8;
    const moduleCap = limit(MODULE_CONCURRENCY);

    const allResults = [];
    const attempted = new Set();
    const stopsAtHeavy = [];
    const stopsSkipped = [];
    let cycle = 0, totalWalked = 0, totalDone = 0, totalFailed = 0;
    let stopReason = null;
    const resume = resumeCache.read();

    const markItem = async (courseId, moduleId, item) => {
      const req = item.completion_requirement;
      const type = req?.type;
      const path = type === 'must_mark_done'
        ? `/api/v1/courses/${courseId}/modules/${moduleId}/items/${item.id}/done`
        : `/api/v1/courses/${courseId}/modules/${moduleId}/items/${item.id}/mark_read`;
      const method = type === 'must_mark_done' ? 'PUT' : 'POST';
      try {
        const res = await fetch(BASE + path, {
          method, credentials: 'include',
          headers: {
            'X-CSRF-Token': token,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        });
        return { ok: res.ok, status: res.status };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    };

    const walkModule = async (course, mod) => {
      let walked = 0, marked = 0, failed = 0, stop = null, firstAttempt = true;
      for (const item of (mod.items || [])) {
        const req = item.completion_requirement;
        if (req?.completed) continue;
        if (req && HEAVY_TYPES.has(req.type)) {
          stop = { item, reason: req.type };
          break;
        }
        walked++; totalWalked++;
        attempted.add(`${course.id}-${item.id}`);
        const r = await markItem(course.id, mod.id, item);
        if (r.ok) {
          marked++; totalDone++;
          allResults.push({
            courseId: course.id, courseName: course.name,
            moduleId: mod.id, moduleName: mod.name,
            itemId: item.id, title: item.title, itemType: item.type,
            reqType: req?.type, url: item.html_url,
            cat: categorize({ name: item.title, itemType: item.type, type: req?.type, points: item.content_details?.points_possible }),
            ok: true,
          });
        } else if (firstAttempt && (r.status === 401 || r.status === 403)) {
          stop = { item, reason: 'first-item-locked' };
          walked--; totalWalked--;
          break;
        } else {
          failed++; totalFailed++;
        }
        firstAttempt = false;
        await sleep(120 + Math.random() * 120);
      }
      if (stop) {
        if (stop.reason === 'first-item-locked') {
          stopsSkipped.push({ course: course.name, module: mod.name, item: stop.item.title, url: stop.item.html_url });
        } else {
          stopsAtHeavy.push({ course: course.name, module: mod.name, item: stop.item.title, reason: stop.reason, url: stop.item.html_url });
        }
      }
      if (marked > 0) {
        resume[course.id] = mod.id;
        resumeCache.write(resume);
      }
      return { course, mod, walked, marked, failed, stop };
    };

    const scanUnlockedIncompleteModules = async () => {
      const scans = await Promise.all(coursesToScan.map(c =>
        apiListFresh(`/api/v1/courses/${c.id}/modules?include[]=items&include[]=content_details`)
          .catch(() => [])
          .then(modules => ({ course: c, modules }))
      ));
      const out = [];
      for (const { course, modules } of scans) {
        for (const mod of modules) {
          if (mod.state === 'completed') continue;
          if (mod.state === 'locked') continue;
          const hasWorkable = (mod.items || []).some(it => {
            const req = it.completion_requirement;
            if (req?.completed) return false;
            if (req && HEAVY_TYPES.has(req.type)) return false;
            return true;
          });
          if (!hasWorkable) continue;
          out.push({ course, mod });
          moduleStateMap.set(`${course.id}-${mod.id}`, mod.state || 'unlocked');
        }
      }
      // Resume cache priority: cached "last module I made progress on" goes first per course.
      out.sort((a, b) => {
        const aResume = resume[a.course.id] === a.mod.id ? 0 : 1;
        const bResume = resume[b.course.id] === b.mod.id ? 0 : 1;
        if (aResume !== bResume) return aResume - bResume;
        if (a.course.name !== b.course.name) return a.course.name.localeCompare(b.course.name);
        return (a.mod.position ?? 999) - (b.mod.position ?? 999);
      });
      return out;
    };

    const waitForStateChange = async (courseIds) => {
      const TICKS = 6, TICK_MS = 1000;
      let last = [];
      for (let i = 0; i < TICKS; i++) {
        await sleep(TICK_MS);
        const scans = await Promise.all([...courseIds].map(id => {
          const course = courseById.get(id);
          if (!course) return Promise.resolve(null);
          return apiListFresh(`/api/v1/courses/${id}/modules?include[]=items&include[]=content_details`)
            .catch(() => [])
            .then(modules => ({ course, modules }));
        }));
        let stateFlipped = false;
        const fresh = [];
        for (const scan of scans) {
          if (!scan) continue;
          const { course, modules } = scan;
          for (const mod of modules) {
            const key = `${course.id}-${mod.id}`;
            const prev = moduleStateMap.get(key);
            const now = mod.state || 'unlocked';
            if (prev === 'locked' && now !== 'locked') stateFlipped = true;
            moduleStateMap.set(key, now);
            if (now === 'completed' || now === 'locked') continue;
            for (const item of (mod.items || [])) {
              const req = item.completion_requirement;
              if (!req || req.completed) continue;
              if (!QUICK_TYPES.has(req.type)) continue;
              if (attempted.has(`${course.id}-${item.id}`)) continue;
              fresh.push({ courseId: course.id, courseName: course.name, moduleId: mod.id, moduleName: mod.name, itemId: item.id, title: item.title, itemType: item.type, reqType: req.type, url: item.html_url, points: item.content_details?.points_possible });
            }
          }
        }
        last = fresh;
        if (fresh.length || stateFlipped) {
          log(`Canvas recomputed after ${i + 1}s (${fresh.length} new quick · ${stateFlipped ? 'module flipped' : 'no flip'}).`, '#8b949e');
          return fresh;
        }
      }
      log(`No state change after ${TICKS}s — cascade exhausted.`, '#8b949e');
      return last;
    };

    while (cycle < MAX_CYCLES) {
      cycle++;
      const targets = await scanUnlockedIncompleteModules();
      if (!targets.length) {
        log(`✓ No more unlocked-incomplete modules. Cascade fully drained.`, '#7ee787');
        stopReason = 'drained';
        break;
      }
      log(`══ Cycle ${cycle}: ${targets.length} unlocked module(s) to walk (parallel × ${MODULE_CONCURRENCY}) ══`, '#a371f7');

      let cycleMarked = 0, cycleFailed = 0, cycleStops = 0;
      const affectedCourses = new Set();
      await Promise.all(targets.map(({ course, mod }) => moduleCap(async () => {
        affectedCourses.add(course.id);
        const r = await walkModule(course, mod);
        cycleMarked += r.marked;
        cycleFailed += r.failed;
        if (r.stop) cycleStops++;
        let stopLabel = ' ✓', lineColor = '#7ee787';
        if (r.stop) {
          if (r.stop.reason === 'first-item-locked') {
            stopLabel = ` ⊘ skipped (item 1 sub-locked: ${r.stop.item.title.slice(0, 50)})`;
            lineColor = '#8b949e';
          } else {
            const heavyMap = { must_submit: 'submission', min_score: 'quiz', must_contribute: 'discussion' };
            stopLabel = ` ⏸ stops at ${heavyMap[r.stop.reason] || r.stop.reason}`;
            lineColor = '#ffb84d';
          }
        }
        log(`  ${course.name} · ${mod.name}: marked ${r.marked}/${r.walked}${r.failed ? ` · ${r.failed} fail` : ''}${stopLabel}`, lineColor);
        setProgress(`Cycle ${cycle} · ${cycleMarked} marked · ${cycleFailed} failed · ${cycleStops} stopped at heavy`);
      })));

      log(`Cycle ${cycle} done: ${cycleMarked} marked across ${targets.length} module(s). Waiting for Canvas to recompute prereqs…`, '#8b949e');
      await waitForStateChange(affectedCourses);
    }

    if (cycle >= MAX_CYCLES) {
      log(`Hit MAX_CYCLES (${MAX_CYCLES}). Click ↻ Rescan + Run again if more items appear.`, '#ffb84d');
      stopReason = stopReason || 'max-cycles';
    }

    // Dedupe + emit final summary lines through the log callback.
    if (stopsAtHeavy.length) {
      log(`── ${stopsAtHeavy.length} module(s) stopped at items needing you: ──`, '#ffb84d');
      const seen = new Set();
      for (const s of stopsAtHeavy) {
        const key = `${s.course}|${s.item}`;
        if (seen.has(key)) continue; seen.add(key);
        log(`  ${s.course} · ${s.module}: ${s.item} (${s.reason})`, '#ffb84d');
      }
    }
    if (stopsSkipped.length) {
      log(`── ${stopsSkipped.length} module(s) skipped (item-level prereq from earlier module): ──`, '#8b949e');
      const seen = new Set();
      for (const s of stopsSkipped) {
        const key = `${s.course}|${s.item}`;
        if (seen.has(key)) continue; seen.add(key);
        log(`  ${s.course} · ${s.module}: ${s.item}`, '#8b949e');
      }
    }
    log(`Refreshing panel from fresh server state…`, '#8b949e');
    try {
      await refreshPanel(coursesToScan.map(c => c.id));
      log(`✓ Panel refreshed.`, '#7ee787');
    } catch (e) {
      log(`Panel refresh failed: ${e.message}`, '#ff6b6b');
    }
    setProgress(`Done after ${cycle} cycle${cycle === 1 ? '' : 's'}. ${totalDone} marked · ${totalFailed} failed · ${stopsAtHeavy.length} stops.`);
    return { cycles: cycle, totalWalked, totalDone, totalFailed, stopsAtHeavy, stopsSkipped, allResults, stopReason };
  };

  window.FEUSweep.engine = {
    scanFavoritedCourses,
    scanInitialBlockers,
    apiModulesToBlockers,
    refreshBlockersForCourses,
    resumeCache,
    runUnlockModules,
  };
})();
