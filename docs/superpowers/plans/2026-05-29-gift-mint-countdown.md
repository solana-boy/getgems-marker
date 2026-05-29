# Gift Mint Countdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small clock button to every offchain Telegram-gift card/marker that, on click, fetches `tgGiftInfo.mintAt` and shows a countdown (e.g. `3d 5h`) inside the button.

**Architecture:** `content.js` renders the button next to the existing marketplace marker for cards where `nftData[address].kind === 'OffchainNft'`. On click it asks `injected.js` (page context) to fetch `mintAt` via a short `nft(address:)` GraphQL query; the result is cached in memory and the countdown is recomputed locally on the existing 2-second refresh tick.

**Tech Stack:** Plain JavaScript (MV3 content script + injected page script), CSS, no bundler. Verification via `node --check`, an ephemeral `node:assert` script for the pure formatter, and manual Chrome testing (this repo has no test suite per `AGENTS.md`).

**Spec:** `docs/superpowers/specs/2026-05-29-gift-mint-countdown-design.md`

---

## File Structure

- `clock.svg` — **new** static asset, the clock icon (loaded as `<img>` like `getgems.svg`/`fragment.svg`).
- `manifest.json` — **modify**, register `clock.svg` in `web_accessible_resources`.
- `styles.css` — **modify**, add `.gift-mint-countdown` button styling.
- `injected.js` — **modify**, handle a fetch request and call `nft(address:)` for `tgGiftInfo`.
- `content.js` — **modify**, all UI/state: cache, formatter, button render/sync, message handling, refresh wiring.

Verification commands (run from repo root `C:/Users/sudde/PycharmProjects/getgems-marker`):
- `node --check content.js` / `node --check injected.js` → no output, exit 0 on success.

---

## Task 1: Clock asset + manifest registration

**Files:**
- Create: `clock.svg`
- Modify: `manifest.json` (web_accessible_resources resources array)

- [ ] **Step 1: Create `clock.svg`**

Create `clock.svg` with exactly this content (monochrome stroke matches the button text color, since an `<img>` does not inherit CSS `currentColor`):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
```

- [ ] **Step 2: Register the asset in `manifest.json`**

Find this block (inside `web_accessible_resources[0].resources`):

```json
        "gift-satellite-embed.js"
      ],
```

Replace it with:

```json
        "gift-satellite-embed.js",
        "clock.svg"
      ],
```

- [ ] **Step 3: Verify `manifest.json` is still valid JSON**

Run: `node -e 'JSON.parse(require("fs").readFileSync("manifest.json","utf8"));console.log("manifest ok")'`
Expected: `manifest ok`

- [ ] **Step 4: Commit**

```bash
git add clock.svg manifest.json
git commit -m "feat(gift-mint): add clock icon asset and register in manifest" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Countdown button styles

**Files:**
- Modify: `styles.css` (append at end of file)

- [ ] **Step 1: Append the button styles**

Append to the end of `styles.css`:

```css
.gift-mint-countdown {
  appearance: none !important;
  min-width: 24px !important;
  height: 24px !important;
  padding: 0 7px !important;
  border: 0 !important;
  border-radius: 999px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 3px !important;
  background: rgba(15, 23, 42, 0.82) !important;
  color: #e2e8f0 !important;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35) !important;
  cursor: pointer !important;
  pointer-events: auto !important;
  flex-shrink: 0 !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  line-height: 1 !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
}

.gift-mint-countdown:hover {
  transform: scale(1.05) !important;
  transition: transform 0.15s ease !important;
}

.gift-mint-countdown[data-state='resolved'] {
  cursor: default !important;
}

.gift-mint-countdown__icon {
  width: 12px !important;
  height: 12px !important;
  display: block !important;
  pointer-events: none !important;
}
```

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "feat(gift-mint): add countdown button styles" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Fetch `mintAt` in `injected.js`

**Files:**
- Modify: `injected.js` (add `fetchGiftMintInfo` after `fetchSingleNftData`; add a message branch in the existing `window.addEventListener('message', ...)`)

- [ ] **Step 1: Add `fetchGiftMintInfo`**

In `injected.js`, find the end of `fetchSingleNftData` — the closing lines:

```js
    } catch (e) {
      console.error('[Getgems Marker] Error fetching single NFT data:', e);
    }
  }
```

Immediately **after** that closing `}` (before `function processHistoryCollectionResponse(...)`), insert:

```js
  // Fetch tgGiftInfo.mintAt for a single offchain gift (on-demand, by user click)
  async function fetchGiftMintInfo(address) {
    if (!address) return;

    try {
      const query = `
        query getNftByAddress($address: String!) {
          nft(address: $address) {
            __typename
            address
            kind
            tgGiftInfo { mintAvailable mintAt }
          }
        }
      `;

      const headers = capturedHeaders
        ? { ...capturedHeaders, 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json' };

      const response = await originalFetch('https://getgems.io/graphql/', {
        method: 'POST',
        headers: headers,
        credentials: 'include',
        body: JSON.stringify({
          operationName: 'getNftByAddress',
          query: query,
          variables: { address: address }
        })
      });

      const data = await response.json();
      const info = data?.data?.nft?.tgGiftInfo || null;

      window.postMessage({
        type: 'GETGEMS_MARKER_GIFT_MINT_DATA',
        address: address,
        mintAt: typeof info?.mintAt === 'number' ? info.mintAt : null,
        mintAvailable: Boolean(info?.mintAvailable)
      }, '*');
    } catch (e) {
      console.error('[Getgems Marker] Error fetching gift mint info:', e);
      window.postMessage({
        type: 'GETGEMS_MARKER_GIFT_MINT_DATA',
        address: address,
        error: true
      }, '*');
    }
  }
```

- [ ] **Step 2: Add the request message branch**

Find this block in `injected.js`:

```js
    if (event.data?.type === 'GETGEMS_MARKER_EXTRACT_PAGE_DATA') {
      console.log('[Getgems Marker] Extracting data from page...');
      extractPageData();
    }
  });
```

Replace it with:

```js
    if (event.data?.type === 'GETGEMS_MARKER_EXTRACT_PAGE_DATA') {
      console.log('[Getgems Marker] Extracting data from page...');
      extractPageData();
    }

    if (event.data?.type === 'GETGEMS_MARKER_REQUEST_GIFT_MINT') {
      fetchGiftMintInfo(event.data.address);
    }
  });
```

- [ ] **Step 3: Verify syntax**

Run: `node --check injected.js`
Expected: no output (exit 0)

- [ ] **Step 4: Commit**

```bash
git add injected.js
git commit -m "feat(gift-mint): fetch tgGiftInfo.mintAt in injected script" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Countdown formatter (`content.js`)

**Files:**
- Modify: `content.js` (insert `formatMintCountdown` after `updateGiftSatelliteLauncher`, i.e. after the closing `}` on line ~1008, before `function hasOneNanoTonTail`)
- Temp: `tmp-format-check.mjs` (created and deleted within this task)

- [ ] **Step 1: Write the verification first (temp `node:assert` script)**

Create `tmp-format-check.mjs` at repo root:

```js
import assert from 'node:assert';

function formatMintCountdown(mintAt, mintAvailable) {
  const diffMs = mintAt * 1000 - Date.now();
  if (mintAvailable || diffMs <= 0) return 'now';

  const totalHours = Math.floor(diffMs / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  return '<1h';
}

const now = Date.now();
const SEC = 1000;
// Build a mintAt (unix seconds) `ms` from now; +60s buffers absorb sub-second floor drift.
const at = (ms) => Math.floor((now + ms) / 1000);

assert.strictEqual(formatMintCountdown(at(0), true), 'now');                              // mintAvailable
assert.strictEqual(formatMintCountdown(at(-3600 * SEC), false), 'now');                   // date in the past
assert.strictEqual(formatMintCountdown(at(((3 * 24 + 5) * 3600 + 60) * SEC), false), '3d 5h');
assert.strictEqual(formatMintCountdown(at((5 * 3600 + 60) * SEC), false), '5h');          // < 1 day
assert.strictEqual(formatMintCountdown(at(30 * 60 * SEC), false), '<1h');                 // < 1 hour
console.log('formatMintCountdown OK');
```

- [ ] **Step 2: Run it to confirm the algorithm is correct**

Run: `node tmp-format-check.mjs`
Expected: `formatMintCountdown OK`

(If it throws an `AssertionError`, the algorithm is wrong — fix the function body before copying it into `content.js`.)

- [ ] **Step 3: Add `formatMintCountdown` to `content.js`**

Find the end of `updateGiftSatelliteLauncher`:

```js
    button.dataset.context = isReady ? 'ready' : 'partial';
    button.title = isReady
      ? `Gift Satellite prefill: ${context.collectionName} / ${context.modelName}`
      : 'Open Gift Satellite. If the model is not detected automatically, the page will still open.';
  }
```

Immediately **after** that closing `}` (before `function hasOneNanoTonTail(info) {`), insert:

```js
  // --- Gift mint countdown ---------------------------------------------------

  function formatMintCountdown(mintAt, mintAvailable) {
    const diffMs = mintAt * 1000 - Date.now();
    if (mintAvailable || diffMs <= 0) return 'now';

    const totalHours = Math.floor(diffMs / 3600000);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h`;
    return '<1h';
  }
```

- [ ] **Step 4: Verify syntax**

Run: `node --check content.js`
Expected: no output (exit 0)

- [ ] **Step 5: Delete the temp verification file**

Run: `rm -f tmp-format-check.mjs` (PowerShell: `Remove-Item tmp-format-check.mjs`)

- [ ] **Step 6: Commit**

```bash
git add content.js
git commit -m "feat(gift-mint): add mint countdown formatter" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: State + button rendering (`content.js`)

**Files:**
- Modify: `content.js` (add two state variables near the top; add the button helpers right after `formatMintCountdown`)

- [ ] **Step 1: Add state variables**

Find this line near the top of the IIFE:

```js
  let historyLookupBatchInFlight = false;
```

Immediately **after** it, insert:

```js

  // Gift mint countdown: cache of successfully fetched { mintAt, mintAvailable } by address.
  let giftMintData = {};
  // Addresses with a mint lookup currently in flight (dedupe + ignore repeat clicks).
  const pendingGiftMintRequests = new Set();
```

- [ ] **Step 2: Add the button helpers**

Find the `formatMintCountdown` function added in Task 4 and its closing `}`:

```js
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h`;
    return '<1h';
  }
```

Immediately **after** that closing `}`, insert:

```js

  function createGiftMintClockIcon() {
    const icon = document.createElement('img');
    icon.className = 'gift-mint-countdown__icon';
    icon.src = chrome.runtime.getURL('clock.svg');
    icon.alt = '';
    return icon;
  }

  function onGiftMintButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const address = button.dataset.address;
    if (!address) return;
    if (giftMintData[address]) return;                 // resolved — do nothing
    if (pendingGiftMintRequests.has(address)) return;  // request already in flight

    pendingGiftMintRequests.add(address);
    window.postMessage({ type: 'GETGEMS_MARKER_REQUEST_GIFT_MINT', address }, '*');
  }

  function renderGiftMintButton(button, address) {
    const cached = giftMintData[address];
    const nextRender = cached
      ? formatMintCountdown(cached.mintAt, cached.mintAvailable)
      : '__clock__';

    if (button.dataset.render === nextRender) return;  // avoid needless DOM mutations
    button.dataset.render = nextRender;

    if (cached) {
      button.dataset.state = 'resolved';
      button.textContent = nextRender;                     // safe: text only
    } else {
      button.dataset.state = 'idle';
      button.replaceChildren(createGiftMintClockIcon());   // no innerHTML
    }
  }

  function syncGiftMintButton(host, address) {
    let button = host.querySelector('.gift-mint-countdown');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'gift-mint-countdown';
      button.dataset.address = address;
      button.addEventListener('click', onGiftMintButtonClick);
      host.appendChild(button);
    } else if (button.dataset.address !== address) {
      // DOM node reused for a different NFT (virtualized list) — rebind + force re-render.
      button.dataset.address = address;
      button.dataset.render = '';
    }
    renderGiftMintButton(button, address);
  }

  function removeGiftMintButton(scope) {
    scope.querySelector?.('.gift-mint-countdown')?.remove();
  }

  function updateGiftMintButtons() {
    if (Object.keys(nftData).length === 0) return;

    document.querySelectorAll('.NftItemContainer').forEach((container) => {
      const address = extractNftAddress(container);
      const info = address ? nftData[address] : null;

      if (!info || info.kind !== 'OffchainNft') {
        removeGiftMintButton(container);
        return;
      }

      syncGiftMintButton(ensureCardControlsContainer(container), address);
    });

    const itemAddress = extractCurrentItemPageAddress();
    const itemInfo = itemAddress ? nftData[itemAddress] : null;
    const itemHost = document.querySelector('.marketplace-marker-item-container');

    if (itemInfo && itemInfo.kind === 'OffchainNft' && itemHost) {
      syncGiftMintButton(itemHost, itemAddress);
    }
  }
```

- [ ] **Step 3: Verify syntax**

Run: `node --check content.js`
Expected: no output (exit 0)

- [ ] **Step 4: Commit**

```bash
git add content.js
git commit -m "feat(gift-mint): render mint countdown buttons on offchain cards" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Wire messaging + refresh loops (`content.js`)

**Files:**
- Modify: `content.js` (handle `GETGEMS_MARKER_GIFT_MINT_DATA`; trigger from `GETGEMS_MARKER_NFT_DATA`; call `updateGiftMintButtons()` from `refreshUi` and `setInterval`)

- [ ] **Step 1: Handle the response message + trigger on NFT data**

Find this block:

```js
    if (event.data?.type === 'GETGEMS_MARKER_NFT_DATA') {
      console.log('[Getgems Marker] Received NFT data via postMessage:', Object.keys(event.data.data).length, 'items');
      nftData = event.data.data;
      updateMarkers();
      updateItemPageMarker();
      updateGiftSatelliteLauncher();
      updateMarketplaceFloorSummary();
    }
```

Replace it with:

```js
    if (event.data?.type === 'GETGEMS_MARKER_NFT_DATA') {
      console.log('[Getgems Marker] Received NFT data via postMessage:', Object.keys(event.data.data).length, 'items');
      nftData = event.data.data;
      updateMarkers();
      updateItemPageMarker();
      updateGiftSatelliteLauncher();
      updateGiftMintButtons();
      updateMarketplaceFloorSummary();
    }

    if (event.data?.type === 'GETGEMS_MARKER_GIFT_MINT_DATA') {
      const { address, mintAt, mintAvailable, error } = event.data;
      if (address) {
        pendingGiftMintRequests.delete(address);
        if (!error && typeof mintAt === 'number') {
          giftMintData[address] = { mintAt, mintAvailable: Boolean(mintAvailable) };
        }
      }
      updateGiftMintButtons();
    }
```

- [ ] **Step 2: Call from `refreshUi` (after `updateItemPageMarker`)**

Find:

```js
    const refreshUi = debounce(() => {
      updateMarkers();
      updateItemPageMarker();
      updateGiftSatelliteLauncher();
      updateMarketplaceFloorSummary();
      updateActivitySaleMarkers();
      requestMissingActivityHistoryLookups();
    }, 300);
```

Replace it with:

```js
    const refreshUi = debounce(() => {
      updateMarkers();
      updateItemPageMarker();
      updateGiftMintButtons();
      updateGiftSatelliteLauncher();
      updateMarketplaceFloorSummary();
      updateActivitySaleMarkers();
      requestMissingActivityHistoryLookups();
    }, 300);
```

- [ ] **Step 3: Call from the 2-second `setInterval` (after `updateItemPageMarker`)**

Find:

```js
    setInterval(() => {
      updateMarkers();
      updateItemPageMarker();
      updateGiftSatelliteLauncher();
      updateMarketplaceFloorSummary();
      updateActivitySaleMarkers();
      requestMissingActivityHistoryLookups();
    }, 2000);
```

Replace it with:

```js
    setInterval(() => {
      updateMarkers();
      updateItemPageMarker();
      updateGiftMintButtons();
      updateGiftSatelliteLauncher();
      updateMarketplaceFloorSummary();
      updateActivitySaleMarkers();
      requestMissingActivityHistoryLookups();
    }, 2000);
```

- [ ] **Step 4: Verify syntax**

Run: `node --check content.js`
Expected: no output (exit 0)

- [ ] **Step 5: Commit**

```bash
git add content.js
git commit -m "feat(gift-mint): wire mint countdown messaging and refresh" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Manual end-to-end verification

**Files:** none (manual). Reload the unpacked extension in `chrome://extensions` first.

- [ ] **Step 1: Card grid — button appears**

Open a TG-gift collection (e.g. Chill Flames). On each offchain card, a clock button appears next to the Getgems marker (top-left). On-chain NFTs / Fragment listings show **no** clock button.

- [ ] **Step 2: Click → countdown**

Click a clock button. Within a moment it shows `Xd Yh` (or `Yh` / `<1h`). Cross-check against the real value: in DevTools → Network, find the `getNftByAddress` request and confirm `data.nft.tgGiftInfo.mintAt` matches the displayed countdown.

- [ ] **Step 3: Mint already available**

On a gift whose `mintAvailable` is `true` (or `mintAt` is in the past), the button shows `now`.

- [ ] **Step 4: Virtualization persistence**

Scroll the resolved card out of view and back. It immediately shows the countdown again (no second click, no second request — check Network).

- [ ] **Step 5: Item page**

Open an offchain gift page (`/nft/...` or `/collection/.../...`). The clock button appears next to the "Listed on Getgems" marker and behaves identically.

- [ ] **Step 6: Reload resets cache**

Press F5. Buttons return to the clock icon (cache is empty after a hard reload).

- [ ] **Step 7: Error retry**

With DevTools offline throttling on, click a fresh clock → it stays a clock (no crash). Turn the network back on and click again → countdown loads.

- [ ] **Step 8 (optional): Document the new flow**

Add the two new message types (`GETGEMS_MARKER_REQUEST_GIFT_MINT`, `GETGEMS_MARKER_GIFT_MINT_DATA`) and the on-demand mint-fetch flow to `docs/architecture.md`, then:

```bash
git add docs/architecture.md
git commit -m "docs: document gift mint countdown flow" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Spec coverage map

- Offchain-only gating (`kind === 'OffchainNft'`), all offchain regardless of sale → Task 5 (`updateGiftMintButtons`).
- Surfaces: card grids + item page → Task 5 (`.NftItemContainer` loop + `.marketplace-marker-item-container`).
- On-demand fetch via short `nft(address:)` query, no persisted hash → Task 3.
- Minimal states (clock / `Xd Yh` / `now` / error→clock, no spinner/tooltip/force-refresh) → Tasks 4 + 5 (`formatMintCountdown`, `renderGiftMintButton`).
- Session cache, no TTL, successes only, survives SPA nav + virtualization → Task 5 (`giftMintData`) + Task 6 (loop wiring).
- Dedupe / ignore repeat clicks → Task 5 (`pendingGiftMintRequests`).
- `clock.svg` as `<img>`, no `innerHTML`; manifest registration → Tasks 1 + 5.
- New message types → Tasks 3 + 6.
- Styling consistent with existing badges → Task 2.
