# Architecture

## Purpose
`getgems-marker` is a Manifest V3 Chrome extension that annotates Getgems pages with marketplace information. It currently covers two broad flows:

- listing and item page markers
- collection activity history markers for `Sale` events

The extension runs entirely in the browser and combines page-context GraphQL interception with extension-context Toncenter lookups.

## Main Files
- [`manifest.json`](../manifest.json): MV3 entrypoint, permissions, content script, popup, service worker.
- [`content.js`](../content.js): DOM integration layer. Injects page script, listens for normalized data, renders badges, schedules refreshes, and requests missing history lookups from the background worker.
- [`injected.js`](../injected.js): Page-context fetch interceptor. Reads Getgems GraphQL traffic and extracts listing data, item data, current user ID, and collection activity history.
- [`background.js`](../background.js): Secure Toncenter lookup worker. Decrypts API keys, rotates them across requests, classifies transactions, and responds to content-script lookup batches.
- [`index.html`](../index.html), [`popup.js`](../popup.js), [`popup.css`](../popup.css): Popup UI for storing `api_password` in `chrome.storage.local`.
- [`styles.css`](../styles.css): Shared badge, floor summary, and activity marker styling.

## Execution Contexts

### Page context: `injected.js`
This script is injected by `content.js` into the actual Getgems page. It wraps `window.fetch`, inspects GraphQL responses, and posts normalized messages back through `window.postMessage`.

Main message types emitted from page context:

- `GETGEMS_MARKER_NFT_DATA`
- `GETGEMS_MARKER_HISTORY_DATA`
- `GETGEMS_MARKER_CURRENT_USER`

Why this exists:

- Getgems GraphQL responses are easier to read from page context than from the extension sandbox.
- The page already has access to request metadata and GraphQL payloads that would otherwise need duplicated requests.

### Content script: `content.js`
This is the UI orchestration layer.

Responsibilities:

- inject `injected.js`
- keep in-memory caches for NFT data and sale history data
- render collection-card markers and item-page markers
- maintain floor summary state for virtualized pages
- parse activity rows, extract transaction hashes from `tonviewer.com/transaction/...` links, and insert history badges
- request missing history lookups from the background worker
- react to popup-triggered retries via `GETGEMS_MARKER_RETRY_HISTORY_LOOKUPS`

### Service worker: `background.js`
This worker owns all Toncenter traffic and secret handling.

Responsibilities:

- read `api_password` from `chrome.storage.local`
- decrypt `ENCRYPTED_API_KEYS_TONCENTER` with Fernet
- rotate `x-api-key` headers across requests
- fetch `https://toncenter.com/api/v3/transactions?hash=...`
- classify the transaction as `getgems`, `fragment`, or `unknown`
- distinguish plain Getgems sales from Getgems `offer` sales
- cache lookup results and deduplicate concurrent requests

Main message types handled by the worker:

- `GETGEMS_MARKER_VALIDATE_API_PASSWORD`
- `GETGEMS_MARKER_LOOKUP_HISTORY_MARKETPLACES`

### Popup: `index.html` + `popup.js`
The popup is intentionally small and only manages the Fernet key used to decrypt Toncenter API keys.

Responsibilities:

- load previously saved `api_password`
- prefill the input on reopen
- save or clear `api_password` in `chrome.storage.local`
- validate decryption by pinging the service worker
- trigger the active Getgems tab to retry unresolved history lookups

## Data Flows

### Listing and item markers
1. `content.js` injects `injected.js`.
2. `injected.js` intercepts Getgems GraphQL responses and extracts NFT sale data.
3. `injected.js` posts normalized NFT payloads with `GETGEMS_MARKER_NFT_DATA`.
4. `content.js` stores the data and updates collection cards, item pages, and floor summary UI.

### Sale history markers
1. Getgems loads `historyCollectionNftItems`.
2. `injected.js` extracts rows where `typeData.type === "sold"`.
3. If `offchain === true`, the row is immediately tagged as `getgems`.
4. Other rows are forwarded to `content.js` without final marketplace classification.
5. `content.js` extracts transaction hashes from activity-row Tonviewer links.
6. Missing hashes are sent to `background.js` with `GETGEMS_MARKER_LOOKUP_HISTORY_MARKETPLACES`.
7. `background.js` fetches Toncenter transaction data and classifies the marketplace.
8. `content.js` merges the response and updates inline history badges.

## Storage and Secrets
- `api_password` is stored in `chrome.storage.local`.
- Toncenter API keys are not stored in plaintext in source anymore; `background.js` contains encrypted Fernet tokens in `ENCRYPTED_API_KEYS_TONCENTER`.
- The service worker decrypts keys lazily and clears related caches when `api_password` changes.

## Permissions
Current key permissions in [`manifest.json`](../manifest.json):

- `storage`: store `api_password`
- `activeTab`: notify the currently open Getgems tab after popup save
- `https://getgems.io/*`: page integration
- `https://toncenter.com/*`: on-chain history lookup

## Known Operational Characteristics
- `Service worker (inactive)` in `chrome://extensions` is normal for MV3. The worker sleeps between events.
- History markers depend on both page data and background lookups. Listing markers may still work even if history markers fail.
- The project currently uses mutation observers plus periodic refreshes instead of a framework-level page lifecycle.
