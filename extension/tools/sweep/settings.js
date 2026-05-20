// Discussion-reply settings store.
//
// One place that owns "how should the extension fill in a discussion reply?":
//   - mode:     'manual' | 'template' | 'ai' | 'auto'
//   - scope:    'all' | 'reflection' | 'off'
//   - template: text to drop in template mode (default ".")
//   - allowShort: bypass the 30-char minimum check
//   - autoFill: pre-fill the textarea when the reply panel opens
//   - autoPostBatch: enable the "Post to all matching" batch button
//
// `auto` mode = AI for reflection-y discussions (end of module, etc.),
// template for everything else. Lets students leave AI on without spending
// tokens on throwaway "intro yourself" prereq threads.
//
// Exports onto window.FEUSweep.settings.

(() => {
  window.FEUSweep = window.FEUSweep || {};
  const KEY = 'feuReplySettings';

  const DEFAULTS = Object.freeze({
    mode: 'manual',
    scope: 'reflection',
    template: '.',
    allowShort: true,
    autoFill: true,
    autoPostBatch: false,
  });

  const MODE_LABEL = {
    manual:   'Manual',
    template: 'Template',
    ai:       'AI',
    auto:     'Auto (AI for reflections, template for others)',
  };

  const SCOPE_LABEL = {
    all:        'All discussion blockers',
    reflection: 'Reflection-style only (end of module, wrap-up, recap)',
    off:        'Off — never auto-fill',
  };

  const MODE_DOT_COLOR = {
    manual:   '#8b949e',
    template: '#ffb84d',
    ai:       '#a371f7',
    auto:     '#79c0ff',
  };

  const get = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { ...DEFAULTS, ...raw };
    } catch { return { ...DEFAULTS }; }
  };

  const set = (patch) => {
    const next = { ...get(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  };

  const reset = () => localStorage.removeItem(KEY);

  // Decide what to fill into the reply textarea for a given discussion.
  // Returns { source: 'ai'|'template'|'manual', text: string|null } where
  // text === null means "leave the box empty, let the user type".
  const planFill = ({ title }) => {
    const cfg = get();
    if (cfg.scope === 'off' || !cfg.autoFill) return { source: 'manual', text: null };

    const isReflection = /end of module|wrap.?up|reflection|what.+(learn|takeaway)|module recap|conclusion/i
      .test(title || '');

    if (cfg.scope === 'reflection' && !isReflection) return { source: 'manual', text: null };

    if (cfg.mode === 'manual') return { source: 'manual', text: null };
    if (cfg.mode === 'template') return { source: 'template', text: cfg.template };
    if (cfg.mode === 'ai')      return { source: 'ai', text: null };
    // auto
    if (isReflection) return { source: 'ai', text: null };
    return { source: 'template', text: cfg.template };
  };

  window.FEUSweep.settings = {
    DEFAULTS, MODE_LABEL, SCOPE_LABEL, MODE_DOT_COLOR,
    get, set, reset, planFill,
  };
})();
