// ============================================================
// ⭐ POLICY LAYER — the file the school's future devs edit.
// ============================================================
//
// This file isolates everything that depends on how the school configures
// Canvas. The rest of the codebase (canvas-api, engine, ui, ai-client) is
// stable infrastructure; THIS file is where academic policy lives.
//
// EDIT THIS FILE WHEN:
//
//   1. Canvas adds a new completion_requirement.type. Decide:
//        - Auto-completable from the API (like must_view)?  → add to QUICK_TYPES
//        - Must be done by the student themselves (quiz/submit/post)? → add to HEAVY_TYPES
//      Optionally add a friendlier label in TYPE_LABEL.
//      The engine will pick it up automatically.
//
//   2. The school introduces a new item-naming convention (e.g. "PA-" prefix
//      for "performance assessment"). Add a regex branch to categorize().
//
//   3. You want to add or remove a category (e.g. drop READING, add PROJECT).
//      Add an entry to CAT with a hex color, then update categorize() to
//      detect it.
//
//   4. A previously-quick gate becomes heavy because policy tightened
//      (or vice-versa). Move the type between QUICK_TYPES and HEAVY_TYPES.
//
// The engine.js code treats:
//   - QUICK_TYPES → "we can auto-complete via Canvas API (mark_read / done)"
//   - HEAVY_TYPES → "stop here, surface the item to the student, they handle it"
//   - Neither    → "no formal requirement; ping mark_read anyway so Canvas
//                   tracks the item as viewed (no 403, just an idempotent ping)"
//
// Exports onto window.FEUSweep.policy.

(() => {
  window.FEUSweep = window.FEUSweep || {};

  // Completion requirement types that the sweep can auto-complete via API.
  // Add to this set when a new auto-completable gate appears (rare).
  const QUICK_TYPES = new Set([
    'must_view',       // student must view a page/file — POST .../mark_read
    'must_mark_done', // student must click a "Done" button — PUT .../done
  ]);

  // Completion requirement types where the sweep STOPS and asks the student
  // to handle the item manually. Add to this set if policy tightens (e.g.
  // a new "must_attend" type for proctored synchronous sessions).
  const HEAVY_TYPES = new Set([
    'must_submit',      // submit a file / text / URL to an assignment
    'min_score',        // pass a quiz with a minimum score
    'must_contribute',  // post to a discussion thread
  ]);

  // Friendlier label rendered in the UI chip for each type.
  // Falls back to the raw API string if a type is missing here.
  const TYPE_LABEL = {
    must_view: 'View',
    must_mark_done: 'Mark Done',
    must_contribute: 'Reply',
    must_submit: 'Submit',
    min_score: 'Score',
  };

  // Categories used for the visual grouping chips ("Social 12 · Reflection 8 …").
  // Add a new category by defining { key, label, color } and updating categorize().
  const CAT = {
    SOCIAL:     { key: 'SOCIAL',     label: 'Social',     color: '#a371f7' },
    REFLECTION: { key: 'REFLECTION', label: 'Reflection', color: '#79c0ff' },
    FORMATIVE:  { key: 'FORMATIVE',  label: 'Formative',  color: '#7ee787' },
    SUMMATIVE:  { key: 'SUMMATIVE',  label: 'Summative',  color: '#ff6b6b' },
    ACTIVITY:   { key: 'ACTIVITY',   label: 'Activity',   color: '#ffb84d' },
    READING:    { key: 'READING',    label: 'Reading',    color: '#8b949e' },
  };

  // Decide which category a blocker belongs to.
  // Regex patterns are intentionally permissive to absorb the school's
  // naming conventions ("FA1", "SA 2", "M5-DISCUSSION", etc.).
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

  // Render a small inline chip for a category.
  const chip = (cat) =>
    `<span style="background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}55;` +
    `padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">${cat.label}</span>`;

  // Format a due_at ISO string into { text, color, sortKey }.
  // Color encodes urgency: red overdue/today, orange tomorrow/week, green further out.
  // sortKey is ms-from-epoch (or MAX_SAFE_INTEGER for no-due so they sort last).
  const formatDue = (iso) => {
    if (!iso) return { text: 'no due date', color: '#8b949e', sortKey: Number.MAX_SAFE_INTEGER };
    const d = new Date(iso), now = new Date(), ms = d - now;
    const days = Math.round(ms / 86400000);
    const dateStr = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (ms < 0) return { text: `${dateStr} · ${Math.abs(days)}d OVERDUE`, color: '#ff6b6b', sortKey: d.getTime() };
    if (days === 0) return { text: `${dateStr} · TODAY`, color: '#ff6b6b', sortKey: d.getTime() };
    if (days === 1) return { text: `${dateStr} · tomorrow`, color: '#ffb84d', sortKey: d.getTime() };
    if (days <= 7) return { text: `${dateStr} · in ${days}d`, color: '#ffb84d', sortKey: d.getTime() };
    return { text: `${dateStr} · in ${days}d`, color: '#7ee787', sortKey: d.getTime() };
  };

  // Fallback discussion draft used when no AI provider is configured.
  // Edit the variants if the school provides their own reflection template.
  const buildDraft = (title) => {
    const topic = (title || '').replace(/^\s*(end of module|discussion[:\s-]*)/i, '').trim() || 'this module';
    const variants = [
      `My main takeaway from ${topic} is how it connects what we covered earlier with the actual practice. The material made me rethink a few assumptions, especially around the parts I had only surface-level understanding of before. I'll try to apply this in the next activity.`,
      `What stood out to me in ${topic} is how it reframes the problem from a different angle than I expected. Before this, I had only thought about it one way, but the readings made the bigger picture clearer. I want to read further on this in the next module.`,
      `From ${topic}, the most useful idea for me was how the concepts work together rather than as isolated steps. I appreciated the structure of the discussion and it pushed me to think about how I'd handle a similar situation outside of class.`,
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  };

  window.FEUSweep.policy = {
    QUICK_TYPES, HEAVY_TYPES, TYPE_LABEL, CAT,
    categorize, chip, formatDue, buildDraft,
  };
})();
