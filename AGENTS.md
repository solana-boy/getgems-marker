# Repository Guidelines

## Project Structure & Module Organization
This repository is a Manifest V3 Chrome extension for `getgems.io` with a mostly flat root layout.

- Core runtime files:
  - [`manifest.json`](./manifest.json)
  - [`content.js`](./content.js)
  - [`injected.js`](./injected.js)
  - [`background.js`](./background.js)
  - [`styles.css`](./styles.css)
- Popup files:
  - [`index.html`](./index.html)
  - [`popup.js`](./popup.js)
  - [`popup.css`](./popup.css)
- Static assets live in the root:
  - `getgems.svg`
  - `fragment.svg`
  - `icon*.png`
- Long-form project documentation lives in [`docs/`](./docs/):
  - [`docs/architecture.md`](./docs/architecture.md)
  - [`docs/history-sales.md`](./docs/history-sales.md)
  - [`docs/debugging.md`](./docs/debugging.md)

Debug artifacts such as `getgems.io.har`, saved HTML pages, and exploratory folders are for local investigation only and should not be committed as product assets.

## Runtime Overview
The extension has four main execution contexts.

- `content.js` runs on `https://getgems.io/*`, injects `injected.js`, listens for page data, updates DOM markers, and requests history lookups from the extension background worker.
- `injected.js` runs in the page context, intercepts Getgems GraphQL responses, extracts listing data and `historyCollectionNftItems`, then posts normalized payloads back to `content.js`.
- `background.js` is the MV3 service worker. It performs secure Toncenter lookups for sale history, rotates API keys, decrypts those keys with Fernet using the stored `api_password`, and returns marketplace classification results.
- `popup.js` + `index.html` provide the extension popup used to save and clear `api_password` in `chrome.storage.local`.

For architecture and flow details, use the documents in [`docs/`](./docs/).

## Build, Test, and Development Commands
There is no build step or package manager in this project.

- `node --check content.js`
- `node --check injected.js`
- `node --check background.js`
- `node --check popup.js`
- `chrome://extensions` -> enable Developer Mode -> `Load unpacked` -> select this repository root
- After code changes, reload the unpacked extension and verify behavior on relevant Getgems collection and item pages

## Coding Style & Naming Conventions
Use plain JavaScript and CSS with 2-space indentation. Keep the current IIFE-based structure and avoid introducing bundlers or framework-specific patterns. Prefer `camelCase` for variables and functions, and descriptive CSS class names following the existing `marketplace-*` / BEM-like style. Keep files ASCII unless a file already requires otherwise.

Favor targeted DOM mutations over full rerenders. The current UI logic depends on periodic refreshes, mutation observers, and incremental badge updates; preserve that bias unless there is a concrete reason to refactor it.

## Testing Guidelines
No automated test suite exists yet. Minimum verification for any change:

- run the relevant `node --check ...` commands for changed JavaScript files
- reload the extension in Chrome
- test both listing markers and history markers on Getgems pages that exercise the change
- if popup or history lookup logic changed, verify popup save/clear flow and service worker behavior
- if UI changed, confirm marker placement, sticky floor panel behavior, exact-price rendering, and activity-row badges

## Commit & Pull Request Guidelines
Recent history uses short, direct subjects such as `fixes + my floor`, `up version 1.4.0`, and `floor block, ...00001 fix, other coins fix`. Follow the same style: concise, imperative, and focused on one change.

PRs should include:

- a short description of the behavioral change
- affected pages and flows
- manual verification steps
- screenshots when UI or marker placement changes

## Security & Configuration Tips
Keep `manifest.json` permissions minimal. `https://toncenter.com/*` is currently required for on-chain sale history classification; do not add more hosts without a concrete need. Do not commit plaintext Toncenter API keys, user-provided `api_password`, or other secrets. Treat HAR files, saved HTML snapshots, and captured marketplace data as debug material rather than maintained source files.
