# Repository Guidelines

## Project Structure & Module Organization
This repository is a Manifest V3 Chrome extension with a flat root layout. Core runtime files are [`manifest.json`](./manifest.json), [`content.js`](./content.js), [`injected.js`](./injected.js), and [`styles.css`](./styles.css). Static assets such as marketplace badges and extension icons live in the root (`getgems.svg`, `fragment.svg`, `icon*.png`). Documentation is minimal and also root-level (`README.md`, `PRIVACY.md`). Debug artifacts like `getgems.io.har` are for local investigation only and should not be committed.

## Build, Test, and Development Commands
There is no build step or package manager in this project.

- `node --check content.js` validates content script syntax.
- `node --check injected.js` validates injected page script syntax.
- `chrome://extensions` -> enable Developer Mode -> `Load unpacked` -> select this repository root to run locally.
- After code changes, reload the unpacked extension and verify behavior on `https://getgems.io/` collection and item pages.

## Coding Style & Naming Conventions
Use plain JavaScript and CSS with 2-space indentation. Keep the current IIFE-based structure and avoid introducing bundlers or framework-specific patterns. Prefer `camelCase` for variables/functions (`updateMarketplaceFloorSummary`) and descriptive class names with the existing BEM-like CSS style (`marketplace-floor-summary__row`). Keep files ASCII unless an existing file already requires otherwise. Favor small DOM updates over full rerenders to avoid repeated asset fetches.

## Testing Guidelines
No automated test suite exists yet. Minimum verification for any change:

- run `node --check content.js` and `node --check injected.js`
- reload the extension in Chrome
- test both collection pages and item pages on Getgems
- if UI changed, confirm marker placement, sticky floor panel behavior, and exact-price rendering

## Commit & Pull Request Guidelines
Recent history uses short, direct subjects such as `fixes + my floor`, `up version 1.4.0`, and `floor block, ...00001 fix, other coins fix`. Follow the same style: concise, imperative, and focused on one change. PRs should include a short description, affected pages/flows, manual verification steps, and screenshots when UI or marker placement changes.

## Security & Configuration Tips
Keep `manifest.json` permissions minimal and scoped to `https://getgems.io/*`. Do not add remote code, extra hosts, or broad permissions without a concrete need. Treat HAR files and captured marketplace data as debugging material, not long-term source files.
