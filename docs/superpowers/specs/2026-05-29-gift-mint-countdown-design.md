# Gift Mint Countdown — Design

## Goal

Для offchain-подарков (Telegram gifts) на Getgems показывать рядом с маркером маркетплейса маленькую кнопку с иконкой часов. По клику расширение запрашивает детали подарка, достаёт `tgGiftInfo.mintAt` и показывает внутри кнопки обратный отсчёт до этой даты с точностью до часа — например `3d 5h`.

`mintAt` — это unix-время (секунды), момент, когда подарок становится mintable (можно вывести на блокчейн). Видно в ответе `getNftByAddress` (см. `graphql.txt`):

```json
"tgGiftInfo": { "mintAvailable": false, "mintAt": 1780998832, "__typename": "TgGiftInfo" }
```

## Non-goals

- Не показываем кнопку для on-chain NFT и для не-offchain листингов — только `kind === 'OffchainNft'`.
- Не делаем автозапрос `mintAt` для всех карточек — только по клику пользователя (on-demand).
- Не используем persisted-запрос с `sha256Hash` из `graphql.txt` — шлём свой короткий query (см. ниже).
- Не показываем минуты/секунды — точность до часа.
- Не делаем спиннер загрузки, тултип и force-refresh (минималистичные состояния, см. ниже).
- Не трогаем Toncenter / `background.js` — данные берём из GraphQL Getgems в контексте страницы.

## Обнаружение offchain-подарков

Поле уже доступно: `injected.js` сохраняет `entry.kind = item.kind` (`buildNftDataEntry`, ~строка 290), и для `OffchainNft` ставит `marketplace = 'getgems'`. В `content.js` это лежит в `nftData[address].kind`.

Условие показа кнопки: `nftData[address].kind === 'OffchainNft'`. **Без** проверки на продажу — кнопка появляется на всех offchain-подарках (гриды коллекций/профилей и страница NFT).

## Размещение

- **Карточки** (`.NftItemContainer`): в тот же top-left контейнер, что и маркер маркетплейса, через `ensureCardControlsContainer(container)` (`content.js`, ~строка 1266). Кнопка встаёт рядом с логотипом Getgems (контейнер уже `display:flex; gap:4px`).
- **Страница NFT**: внутри `.marketplace-marker-item-container` (создаётся в `addMarkerToItemPage`, ~строка 1421).
- Элемент: `<button class="gift-mint-countdown" type="button" data-address="…">`. Размер 24px в высоту — как `.marketplace-marker` и `.one-nano-ton-tail-marker`.

## Состояния кнопки (минимализм)

| Состояние | Что показываем | Интерактивность |
|-----------|----------------|-----------------|
| `idle` (до клика) | иконка часов (`clock.svg`) | клик → запрос |
| запрос «в полёте» | то же (иконка часов, без спиннера) | повторные клики игнорируются |
| успех, дата в будущем | `3d 5h` / `5h` / `<1h` | не реагирует (resolved) |
| минт доступен (`mintAt ≤ now` или `mintAvailable=true`) | `now` | не реагирует (resolved) |
| ошибка / нет `mintAt` | возврат к иконке часов | клик пробует снова |

«Resolved» (успешно получили число) — кнопка только отображает значение и на повторный клик не реагирует (force-refresh нет, по договорённости). Ошибка/отсутствие `mintAt` **не** кэшируются как финал — кнопка возвращается в `idle`, следующий клик повторяет запрос.

## Формат отсчёта

```js
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

## Запрос (`injected.js`, контекст страницы)

Запрос идёт из контекста страницы (там перехваченные заголовки и куки). Используем поле `alphaNftItemByAddress(address:)` своим коротким query — **без** persisted-хэша, чтобы не зависеть от обновлений фронта.

Важно (грабли): у сайта есть persisted-операция `getNftByAddress`, и в её ответе ключ `data.nft` — это **алиас**. Реального поля `nft` в схеме нет (`Cannot query field "nft" on type "Query"`). Настоящее поле — `alphaNftItemByAddress` (его использует и сам фронт Getgems в своих JS-бандлах, и существующий `fetchSingleNftData`), оно возвращает `NftItem` с `tgGiftInfo` и принимает спец-адреса вида `EQf_tg_gift_______…`.

### Слушатель сообщения

В существующий `window.addEventListener('message', …)` (~строки 369–381) добавить:

```js
if (event.data?.type === 'GETGEMS_MARKER_REQUEST_GIFT_MINT') {
  fetchGiftMintInfo(event.data.address);
}
```

### Новая функция

```js
async function fetchGiftMintInfo(address) {
  if (!address) return;

  try {
    const query = `
      query getGiftMintInfo($address: String!) {
        alphaNftItemByAddress(address: $address) {
          __typename
          address
          kind
          tgGiftInfo { mintAvailable mintAt }
        }
      }
    `;

    const headers = buildGraphqlHeaders(capturedHeaders);  // exactly one Content-Type

    const response = await originalFetch('https://getgems.io/graphql/', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        operationName: 'getGiftMintInfo',
        query,
        variables: { address }
      })
    });

    const data = await response.json();
    const info = data?.data?.alphaNftItemByAddress?.tgGiftInfo || null;

    window.postMessage({
      type: 'GETGEMS_MARKER_GIFT_MINT_DATA',
      address,
      mintAt: typeof info?.mintAt === 'number' ? info.mintAt : null,
      mintAvailable: Boolean(info?.mintAvailable)
    }, '*');
  } catch (e) {
    console.error('[Getgems Marker] Error fetching gift mint info:', e);
    window.postMessage({
      type: 'GETGEMS_MARKER_GIFT_MINT_DATA',
      address,
      error: true
    }, '*');
  }
}
```

## Кэш и инвалидация

`mintAt` — фиксированная метка времени, она не «тикает»; отсчёт пересчитывается локально от `Date.now()`. Поэтому перезапрашивать значение не нужно.

- **Хранение:** `let giftMintData = {};` в памяти `content.js`, ключ — адрес, значение — `{ mintAt, mintAvailable }`. Кэшируются **только успехи** (`typeof mintAt === 'number'`).
- **Дедуп запросов:** `const pendingGiftMintRequests = new Set();` — адреса с запросом «в полёте». Снимается при получении ответа (успех/ошибка/нет данных).
- **Время жизни:** на сессию вкладки. Сбрасывается при жёсткой перезагрузке (F5) и закрытии вкладки (новый content-script стартует с пустым кэшем). **Переживает** SPA-навигацию Getgems, скролл/виртуализацию, обновления `nftData`, мутации DOM.
- **TTL нет.** Значение неизменно; протухание бессмысленно.
- **Бонус виртуализации:** если карточка перерисовалась, а адрес уже в `giftMintData` — отсчёт показывается сразу, без повторного клика и запроса.

## Изменения в `content.js`

### Состояние (рядом с другими переменными, ~строки 8–28)

```js
let giftMintData = {};
const pendingGiftMintRequests = new Set();
```

### Обработка ответа

В существующий `window.addEventListener('message', …)` (~строки 82–115) добавить ветку:

```js
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

В ветку `GETGEMS_MARKER_NFT_DATA` (~строки 91–98) добавить вызов `updateGiftMintButtons();` (чтобы кнопки появлялись, как только пришли данные).

### Рендер кнопок

Иконка часов — bundled asset `clock.svg`, как `getgems.svg` / `fragment.svg` (через `<img>` + `chrome.runtime.getURL`). `innerHTML` не используем; дети меняем через `textContent` (только текст) и `replaceChildren` (элемент). Это совпадает с конвенцией кодовой базы (нигде нет `innerHTML`) и снимает любой риск XSS.

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
  if (giftMintData[address]) return;               // resolved — ничего не делаем
  if (pendingGiftMintRequests.has(address)) return; // уже в полёте

  pendingGiftMintRequests.add(address);
  window.postMessage({ type: 'GETGEMS_MARKER_REQUEST_GIFT_MINT', address }, '*');
}

function renderGiftMintButton(button, address) {
  const cached = giftMintData[address];
  const nextRender = cached
    ? formatMintCountdown(cached.mintAt, cached.mintAvailable)
    : '__clock__';

  if (button.dataset.render === nextRender) return; // без лишних мутаций DOM
  button.dataset.render = nextRender;

  if (cached) {
    button.dataset.state = 'resolved';
    button.textContent = nextRender;                   // безопасно: только текст
  } else {
    button.dataset.state = 'idle';
    button.replaceChildren(createGiftMintClockIcon()); // без innerHTML
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

### Привязка к циклам обновления

Добавить `updateGiftMintButtons();` в:

- `refreshUi` (debounced, ~строка 131) — **после** `updateItemPageMarker()`, чтобы `.marketplace-marker-item-container` уже существовал на первом проходе страницы NFT.
- `setInterval(…, 2000)` (~строка 149), также после `updateItemPageMarker()` — здесь же обеспечивает «живой» пересчёт отсчёта (резолв-кнопки обновляют текст при смене значения, остальные пропускаются guard'ом `dataset.render`).

На карточках одного тика задержки нет (`ensureCardControlsContainer` создаёт хост сам). На странице NFT, если хост ещё не готов, кнопка появится на следующем тике — это допустимо.

## Изменения в `injected.js`

- В `window.addEventListener('message', …)` (~строки 369–381) — ветка `GETGEMS_MARKER_REQUEST_GIFT_MINT`.
- Новая функция `fetchGiftMintInfo(address)` (см. выше).

## Asset + manifest

Новый файл `clock.svg` в корне (рядом с `getgems.svg` / `fragment.svg`). Монохром, цвет под текст кнопки (как `<img>` не наследует `currentColor`):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
```

В `manifest.json` добавить `clock.svg` в `web_accessible_resources[0].resources` (туда же, где уже перечислены `getgems.svg`, `fragment.svg`) — иначе `<img src=chrome.runtime.getURL('clock.svg')>` не загрузится в DOM страницы.

## CSS (`styles.css`)

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

## Поток данных

```
клик по .gift-mint-countdown (content.js)
  └─ pendingGiftMintRequests.add(address)
  └─ postMessage GETGEMS_MARKER_REQUEST_GIFT_MINT { address }
       └─ injected.js fetchGiftMintInfo(address)
            └─ POST graphql/ (alphaNftItemByAddress(address:){ tgGiftInfo{ mintAt mintAvailable } })
                 └─ postMessage GETGEMS_MARKER_GIFT_MINT_DATA { address, mintAt, mintAvailable | error }
                      └─ content.js: giftMintData[address] = {…} (только успех)
                           └─ updateGiftMintButtons → renderGiftMintButton (показывает "3d 5h" / "now")

setInterval 2s / MutationObserver (content.js)
  └─ updateGiftMintButtons
       ├─ создаёт кнопку на offchain-карточках (idle = часы)
       └─ пересчитывает текст resolved-кнопок от Date.now()
```

## Message types (новые)

- `GETGEMS_MARKER_REQUEST_GIFT_MINT` — content.js → injected.js, `{ address }`.
- `GETGEMS_MARKER_GIFT_MINT_DATA` — injected.js → content.js, `{ address, mintAt, mintAvailable }` или `{ address, error: true }`.

## Тестирование (ручное)

`node --check content.js`, `node --check injected.js`, затем reload расширения.

1. Открыть коллекцию TG-подарков (например Chill Flames) → на offchain-карточках рядом с маркером Getgems появляется кнопка с часами.
2. Клик по часам → через момент внутри кнопки появляется отсчёт `Xd Yh` (или `Yh` / `<1h`).
3. Свериться с реальным `mintAt`: открыть тот же подарок, проверить запрос `getNftByAddress` в DevTools → `tgGiftInfo.mintAt`.
4. Подарок, у которого минт уже доступен (`mintAvailable=true` или дата в прошлом) → кнопка показывает `now`.
5. Скролл вниз и обратно (виртуализация) → ранее раскрытая карточка сразу показывает число без повторного клика.
6. Страница NFT offchain-подарка (`/nft/…` или `/collection/…/…`) → кнопка рядом с item-маркером работает так же.
7. On-chain NFT / Fragment-листинги → кнопки нет.
8. Перезагрузка вкладки (F5) → кэш пуст, кнопки снова в состоянии `idle` (часы).
9. (Сеть оффлайн) клик → кнопка остаётся часами; повторный клик при восстановлении сети успешно подгружает отсчёт.

## Failure Modes

- **`capturedHeaders === null`** (клик до первого GraphQL-запроса страницы) → fallback на минимальные заголовки + `credentials:'include'`. На практике к моменту рендера карточек заголовки уже перехвачены.
- **Сервер отверг запрос (`GRAPHQL_VALIDATION_FAILED` / `BAD_REQUEST`)** → кнопка останется часами. Уже учтённые грабли: (1) поле называется `alphaNftItemByAddress`, а не `nft` (последнее — алиас в persisted-доке сайта); (2) ровно один заголовок `Content-Type` (см. `buildGraphqlHeaders`). План B на будущие поломки: взять свежий `persistedQuery.sha256Hash` из реальных запросов фронта и слать persisted-форму.
- **Нет `tgGiftInfo` / `mintAt = null`** в ответе → `GETGEMS_MARKER_GIFT_MINT_DATA` с `mintAt: null`, в кэш не пишем, кнопка возвращается в `idle`.
- **Двойной клик** → второй клик отсекается через `pendingGiftMintRequests`.
- **Клик по кнопке не должен открывать карточку** → `preventDefault()` + `stopPropagation()` в `onGiftMintButtonClick`.

## Files touched

- `injected.js` — ветка `GETGEMS_MARKER_REQUEST_GIFT_MINT` + функция `fetchGiftMintInfo`.
- `content.js` — состояние `giftMintData` / `pendingGiftMintRequests`, обработчик `GETGEMS_MARKER_GIFT_MINT_DATA`, функции `formatMintCountdown` / `createGiftMintClockIcon` / `renderGiftMintButton` / `syncGiftMintButton` / `updateGiftMintButtons` / `removeGiftMintButton` / `onGiftMintButtonClick`, привязка к `refreshUi` + `setInterval` + ветке `GETGEMS_MARKER_NFT_DATA`.
- `styles.css` — `.gift-mint-countdown` (+ `__icon`, состояния).
- `clock.svg` — новый asset (иконка часов).
- `manifest.json` — `clock.svg` в `web_accessible_resources`.
- (опционально) `docs/architecture.md` — новые message types и поток.
