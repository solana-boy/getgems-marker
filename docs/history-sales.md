# Sale History Markers

## Goal
Annotate `Sale` rows on Getgems collection activity pages such as:

- `https://getgems.io/collection/{collectionAddress}#activity`

Each sold row should show one of:

- Getgems logo
- Fragment logo
- unknown marker

Some Getgems sales should also show an additional `offer` badge.

## Source Data

### GraphQL history feed
The first source is Getgems GraphQL:

- operation: `historyCollectionNftItems`
- relevant rows: `typeData.type === "sold"`

This data is intercepted in [`injected.js`](../injected.js).

Normalization rules from GraphQL:

- `offchain === true` -> mark immediately as `marketplace: "getgems"`
- `offchain === false` -> keep the hash and resolve marketplace from Toncenter
- initial history payload includes metadata such as `hash`, `time`, `nftName`, `offchain`, and default `saleType: "sale"`

### Toncenter transaction lookup
For non-offchain rows, [`background.js`](../background.js) requests:

- `https://toncenter.com/api/v3/transactions?hash={tx_hash}`

Request behavior:

- `Accept: application/json`
- `x-api-key: <rotating decrypted key>`
- retry with short delay on non-OK responses or empty transaction arrays

## Marketplace Detection Rules
The worker returns a normalized object:

```js
{
  hash,
  marketplace,
  saleType,
  offchain: false
}
```

Current detection logic:

- Fragment sale:
  - any outgoing message with `decoded_opcode === "auction_fill_up"`
  - result: `marketplace: "fragment", saleType: "sale"`
- Getgems offer sale:
  - outgoing `text_comment` with comment `Profit`
  - plus an outgoing `nft_transfer`
  - result: `marketplace: "getgems", saleType: "offer"`
- Regular Getgems sale:
  - incoming message has `decoded_opcode === "nft_transfer"`
  - result: `marketplace: "getgems", saleType: "sale"`
- Fallback:
  - result: `marketplace: "unknown", saleType: "sale"`

The Fragment and Getgems checks were taken from the Python reference logic in `getgems_history_main.py` and adapted to the extension runtime.

## UI Behavior
Activity markers are rendered in [`content.js`](../content.js) and styled in [`styles.css`](../styles.css).

Per sale row:

- main marketplace marker is attached near the `Sale` label
- `getgems` and `fragment` use inline logo assets
- unknown uses a text fallback
- `getgems` + `saleType === "offer"` also adds a small `offer` badge

Titles currently shown:

- `Sale via Getgems`
- `Sale via Getgems (offchain)`
- `Sale via Getgems offer`
- `Sale via Fragment`
- `Sale marketplace is unknown`

## Messaging Between Contexts

### Page -> content
- `GETGEMS_MARKER_HISTORY_DATA`

### Content -> background
- `GETGEMS_MARKER_LOOKUP_HISTORY_MARKETPLACES`

Payload:

```js
{
  type: 'GETGEMS_MARKER_LOOKUP_HISTORY_MARKETPLACES',
  hashes: ['txhash1', 'txhash2']
}
```

### Popup -> background
- `GETGEMS_MARKER_VALIDATE_API_PASSWORD`

### Popup -> content
- `GETGEMS_MARKER_RETRY_HISTORY_LOOKUPS`

This retry path exists so the user can save `api_password` and immediately re-run unresolved history lookups without waiting for the next background polling cycle.

## Secrets and Decryption
Toncenter keys are stored in encrypted form in [`background.js`](../background.js) as `ENCRYPTED_API_KEYS_TONCENTER`.

Flow:

1. User opens extension popup.
2. User saves `api_password`.
3. `popup.js` stores it in `chrome.storage.local`.
4. `background.js` reads it and attempts Fernet decryption.
5. If successful, decrypted keys are cached in memory and used round-robin for Toncenter requests.

If `api_password` changes, the worker clears:

- decrypted-key cache
- lookup cache
- in-flight lookup map
- round-robin key index

## Failure Modes
- No `api_password` saved:
  - history lookups cannot use Toncenter
  - offchain sales still resolve as Getgems
- Wrong `api_password`:
  - popup validation fails
  - worker cannot decrypt Toncenter keys
- Service worker startup failure:
  - history lookups fail completely
  - listing markers can still continue to work because they do not depend on Toncenter
- Toncenter rate limiting or temporary failure:
  - the worker retries with rotated keys
  - final fallback is `unknown`
