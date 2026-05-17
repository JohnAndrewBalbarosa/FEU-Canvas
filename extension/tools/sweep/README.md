# 🚀 Unlock Modules — architecture

This directory contains the modular pieces of the Unlock Modules tool
(formerly the one-file `auto-sweep.js`). Files load in this order:

```
canvas-api.js  →  policy.js  →  ai-client.js  →  engine.js  →  ui.js  →  ../auto-sweep.js
```

Each file is a small IIFE that hangs its exports on `window.FEUSweep.*`.
The entry orchestrator `../auto-sweep.js` (≈50 lines) wires them together.

## Layer map — what lives where

| File             | Layer           | Touches DOM? | What it knows about |
| ---------------- | --------------- | ------------ | ------------------- |
| `canvas-api.js`  | HTTP transport  | No           | HTTP, pagination, CSRF, concurrency |
| `policy.js`      | ⭐ Academic policy | No           | Completion-requirement types, category rules |
| `ai-client.js`   | External API    | No           | Multi-provider AI for discussion drafts |
| `engine.js`      | Domain logic    | No           | Modules, blockers, cycle loop, resume cache |
| `ui.js`          | Presentation    | **Yes**      | Panel HTML, buttons, reply / details / AI panels |
| `auto-sweep.js`  | Orchestrator    | Indirect     | Wires the layers above |

Rule of thumb: `ui.js` is the only file that touches the DOM. `engine.js`
talks to the engine through callbacks the UI provides — never the other
way around.

## ⭐ Editing `policy.js` — the file you'll touch most

Open `policy.js` when:

1. **The school adds a new completion gate.** Decide if it's
   auto-completable (add to `QUICK_TYPES`) or needs the student
   (add to `HEAVY_TYPES`). Optionally give it a friendlier UI label in
   `TYPE_LABEL`. The engine picks it up automatically.

2. **The school renames item conventions.** Update the regex branches in
   `categorize()`. Example: `\bFA\s*\d` matches "FA1", "FA 5". If the
   convention changes to `PA-1` for "performance assessment", add a new
   branch with a new color in `CAT`.

3. **You want to add or remove a category.** Add a `CAT.XYZ = {...}`
   entry, then teach `categorize()` how to detect it.

4. **Policy tightens or loosens.** If `must_view` items suddenly need
   manual confirmation, move it from `QUICK_TYPES` to `HEAVY_TYPES`.

No other file needs to change. The engine treats:
- `QUICK_TYPES` → auto-complete via Canvas API
- `HEAVY_TYPES` → stop and surface to the student
- Neither → polite `mark_read` ping (idempotent; no 403)

## How the engine works

`engine.runUnlockModules(input, callbacks)` runs cycles until the
prerequisite cascade drains:

1. Scan every favorited course's modules. Filter to unlocked + incomplete.
2. Walk those modules in parallel (up to 8 at a time). Within each module,
   walk items sequentially — Canvas requires that and 403s parallel
   writes within the same module.
3. Wait up to 6 s for Canvas to recompute prereqs after writes.
4. If new modules unlocked, run another cycle. Otherwise, stop.

The engine never touches the DOM. It calls back into `log(msg, color)`
and `setProgress(text)` provided by the UI, so the UI is free to render
those wherever it wants (currently a scrolling log box at the bottom
of the panel).

## Adding a new AI provider

`ai-client.js`:

```js
PROVIDERS.myprovider = async ({ apiKey, model, system, user, maxTokens }) => {
  // fetch the provider, return the response text string
};
PROVIDER_META.myprovider = { label: 'My Provider', placeholder: 'model-id', keyHint: 'sk-...' };
```

The settings dropdown picks it up automatically.

## Common pitfalls

- **Don't import from `engine.js` into `policy.js`.** Layers only know
  about layers below them.
- **Don't add HTML strings to `engine.js`.** That belongs in `ui.js`.
- **If the panel renders but Run Sweep doesn't work**, check the browser
  console for `[Sweep engine] requires canvas-api.js and policy.js loaded
  first` — that means `popup.js` `FILE_MAP` is loading files in the wrong
  order. The dependency direction is bottom-up in the table above.
