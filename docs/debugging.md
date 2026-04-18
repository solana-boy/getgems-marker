# Debugging

## Local Run
1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Use `Load unpacked` and select the repository root.
4. Open a Getgems collection or item page.

After each code change:

- click `Reload` on the extension card
- refresh the Getgems tab

## Syntax Checks
Run the syntax checks for every edited JavaScript file:

```powershell
node --check content.js
node --check injected.js
node --check background.js
node --check popup.js
```

## Typical Manual Verification

### Listing and item markers
Check:

- collection cards show marketplace markers
- item pages show the expected marker
- floor summary still updates correctly
- exact-price handling still works for TON values

### Activity history markers
Open a page like:

- `https://getgems.io/collection/{collectionAddress}#activity`

Check:

- `Sale` rows receive the expected logo
- offchain sales resolve without Toncenter
- known Fragment rows show Fragment
- Getgems offer rows show Getgems plus `offer`

## Popup and Fernet Key
Open the extension popup and verify:

- saved `api_password` is prefilled when reopening the popup
- `Save` shows success when the Fernet key is correct
- `Clear` removes the stored value

Expected success text is similar to:

- `api_password saved. Toncenter keys loaded: 10.`

## Service Worker Debugging

### Important MV3 behavior
`Service worker (inactive)` in `chrome://extensions` is normal. The worker only wakes up when an event occurs.

It should wake on events such as:

- popup save
- `chrome.runtime.sendMessage(...)` from `content.js`
- storage changes

### How to inspect the worker
1. Open `chrome://extensions`.
2. Find the extension card.
3. Click `service worker` or `Inspect views`.
4. Keep DevTools open while reproducing the issue.

Use:

- `Console` for runtime exceptions
- `Network` for Toncenter requests

In `Network`, filter by:

- `toncenter`
- `Fetch/XHR`

### How to inspect saved popup data
In the service worker DevTools console:

```js
chrome.storage.local.get('api_password', console.log)
```

## Common Failure Patterns

### History markers do not appear, listing markers still work
Likely causes:

- service worker failed to register
- `api_password` is missing or wrong
- Toncenter requests are failing
- content/background messaging failed

This split is expected because listing markers come from Getgems GraphQL interception, while history markers also depend on `background.js`.

### `Service worker registration failed. Status code: 15`
This indicates a startup error in `background.js`. Check:

- `chrome://extensions` -> `Errors`
- service worker DevTools `Console`

One example already hit in this project was a startup `ReferenceError` caused by referencing `API_KEYS_TONCENTER` after the code had been migrated to `ENCRYPTED_API_KEYS_TONCENTER`.

### Popup saves but history still does not refresh
Check:

- popup status text after `Save`
- service worker `Console`
- service worker `Network` for Toncenter
- page DevTools `Console` for content-script errors

### Toncenter requests are not visible in the page tab
This is expected. They are executed by `background.js`, not by the Getgems page or `content.js`.

Inspect them in the service worker DevTools instead.
