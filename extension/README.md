# FEU Canvas Helper — Chrome Extension

Three on-demand tools for FEU Canvas, packaged as a Manifest V3 Chrome extension.

## Install (unpacked)

1. Open Chrome → `chrome://extensions/`
2. Toggle **Developer mode** ON (top right).
3. Click **Load unpacked**.
4. Select this `extension/` folder.
5. Pin the icon to the toolbar (puzzle piece → 📌).

> No icon shows? The manifest references `icon.png` but the file is optional. Chrome will use a default icon if it's missing. To add one, drop any 128x128 PNG named `icon.png` into this folder and reload the extension.

## Use

1. Log in to `feu.instructure.com` in any tab.
2. Click the extension icon.
3. Pick a tool:
   - **📋 Pending Dashboard** — overlay of all pending work from your favorited courses (works on any Canvas page).
   - **🔓 Module Blockers** — list of incomplete completion requirements gating the current course (open the course first).
   - **⏭️ Auto-Next + Draft** — inside a module item: press `N` to auto-click Next, `P` pause, `S` stop, `D` to draft a reflection reply (does NOT submit — you review & post).

## What it does NOT do

- No password handling, no token storage, no MFA bypass.
- No auto-submitting of assignments, quizzes, or discussion posts.
- Read-only API calls + UI helpers. Anything that gets posted requires you to click the real Canvas button.

## Updating the tools

If you edit `extension/tools/*.js`, reload the extension at `chrome://extensions/` (click the 🔄 icon on the extension card) for changes to take effect.
