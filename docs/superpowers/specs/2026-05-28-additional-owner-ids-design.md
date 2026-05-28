# Additional Owner IDs — Design

## Goal

Расширить логику зелёной подсветки карточек NFT в расширении `getgems-marker`. Сейчас подсвечиваются только карточки, чей `owner.id` совпадает с `currentUserId` залогиненного аккаунта Getgems (см. `content.js:1295`). Нужно добавить возможность вручную указать список **дополнительных Getgems user IDs** в попапе расширения и подсвечивать карточки этих владельцев другим оттенком.

## Non-goals

- Не вводим работу с TON-адресами и не резолвим адрес→ownerId. Пользователь сам копирует Getgems user IDs.
- Не валидируем формат ID (любая непустая строка после `trim` принимается).
- Не добавляем разные цвета для разных дополнительных кошельков — все одного оттенка.
- Не добавляем отдельные строки в Listing floors. Существующая строка `mine` расширяется на все «свои» кошельки.

## Storage

Новый ключ в `chrome.storage.local`:

- **Key:** `additional_owner_ids`
- **Value:** `string[]` — массив Getgems user IDs. Дедуплицированный, без пустых строк.

Лежит рядом с существующим `api_password`. Очистка списка удаляет ключ.

## UI (popup)

### `index.html`

Под существующей формой `api-password-form` добавляется второй блок:

- Заголовок `Additional owner IDs`.
- Короткое описание: например, `Highlight cards owned by these Getgems user IDs in a secondary color.`
- `<textarea id="additional-owner-ids">`, моноширинная, 6–8 строк, `spellcheck="false"`, `autocomplete="off"`, `placeholder="One Getgems user ID per line"`.
- Кнопки Save / Clear по тем же классам, что и у формы пароля.
- `<p id="additional-owner-ids-status" class="popup__status" role="status" aria-live="polite">` для отображения статуса.

### `popup.js`

Логика по аналогии с блоком `api_password`:

1. На загрузке: `chrome.storage.local.get({ additional_owner_ids: [] })` → подставляем в textarea как `value.join('\n')`.
2. Save: парсим `textarea.value`:
   - `split('\n')`
   - `map(s => s.trim())`
   - `filter(Boolean)`
   - дедуп через `Array.from(new Set(...))`
3. Записываем через `chrome.storage.local.set({ additional_owner_ids: ... })`.
4. Шлём активной вкладке Getgems сообщение `GETGEMS_MARKER_REAPPLY_OWNER_MARKERS` (триггер немедленного перерендера; страховка на случай задержки `storage.onChanged`).
5. Clear: `chrome.storage.local.remove('additional_owner_ids')` + очистка textarea.
6. Статус в `popup-status` стиле: `"Saved N additional owner IDs."`, `"Cleared additional owner IDs."`, и пр.

### `popup.css`

Если новый блок визуально требует разделителя/отступа — добавить минимум стилей. По возможности переиспользуем существующие классы `popup__*`.

## Content script (`content.js`)

### Состояние

```js
let additionalOwnerIds = new Set();
```

### Инициализация

Внутри `init()` (или сразу после объявления `currentUserId`):

```js
chrome.storage.local.get({ additional_owner_ids: [] }, (items) => {
  additionalOwnerIds = new Set(Array.isArray(items.additional_owner_ids) ? items.additional_owner_ids : []);
  updateMarkers();
  updateMarketplaceFloorSummary();
});
```

### Слушатель изменений storage

```js
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.additional_owner_ids) return;
  const next = changes.additional_owner_ids.newValue;
  additionalOwnerIds = new Set(Array.isArray(next) ? next : []);
  updateMarkers();
  updateMarketplaceFloorSummary();
});
```

### Сообщение от попапа

В существующий слушатель `chrome.runtime.onMessage` (строки 40–51) добавляется ветка:

```js
if (message?.type === 'GETGEMS_MARKER_REAPPLY_OWNER_MARKERS') {
  updateMarkers();
  updateMarketplaceFloorSummary();
  return undefined;
}
```

### `updateMarkers()` (строка 1279)

Замена блока вокруг строки 1295:

```js
const ownerId = info.ownerId || null;
const isOwn = Boolean(currentUserId && ownerId && ownerId === currentUserId);
const isAdditional = Boolean(!isOwn && ownerId && additionalOwnerIds.has(ownerId));

container.classList.toggle('own-nft-item', isOwn);
container.classList.toggle('own-nft-item--additional', isAdditional);
```

Приоритет за `isOwn` — основной кошелёк никогда не получает «дополнительную» подсветку.

### `computeMarketplaceFloors()` (строка 1054)

Предикат для floor `mine` расширяется:

```js
const ownerId = listing.ownerId || null;
const belongsToUser =
  (currentUserId && ownerId && ownerId === currentUserId) ||
  (ownerId && additionalOwnerIds.has(ownerId));

if (belongsToUser) {
  updateFloor('mine', listing, priceNano);
}
```

Подпись `mine` и визуальный стиль строки в Listing floors не меняются.

## Styles (`styles.css`)

Существующее правило `.own-nft-item` (строки 155–158) сохраняется без изменений. Добавляется:

```css
.own-nft-item--additional {
  box-shadow:
    0 0 8px 2px rgba(20, 184, 166, 0.35),
    0 0 20px 4px rgba(20, 184, 166, 0.15) !important;
  border-radius: 12px !important;
}
```

Бирюзовый/циан выбран как визуально близкий к зелёному, но явно отличимый.

## Data flow

```
popup Save
  └─ chrome.storage.local.set({ additional_owner_ids })
  │    └─ chrome.storage.onChanged → content.js → updateMarkers + floor summary
  └─ chrome.tabs.sendMessage(active, { type: 'GETGEMS_MARKER_REAPPLY_OWNER_MARKERS' })
       └─ content.js → updateMarkers + floor summary

content.js init
  └─ chrome.storage.local.get('additional_owner_ids')
       └─ additionalOwnerIds = new Set(...)
       └─ updateMarkers (если nftData уже накоплен)
```

## Testing (manual)

Поскольку проект — расширение без юнит-тестов:

1. Загрузить расширение, открыть коллекцию Getgems.
2. Сохранить пустую textarea → подсвечен только основной кошелёк (зелёный).
3. Сохранить 1 чужой Getgems ID → карточки этого владельца получают бирюзовую рамку, прочие — без неё.
4. Сохранить свой же ID в textarea → карточка остаётся зелёной (без двойной подсветки).
5. Сохранить несколько ID (с пустыми строками, пробелами, дубликатами) → после Save в storage лежит дедуп без пустых.
6. Listing floors → строка `mine` = минимальная цена среди всех «своих» (основной + дополнительные).
7. Clear → бирюзовая подсветка пропадает после автоматического перерендера.
8. Перезагрузить вкладку Getgems → значения подтягиваются из storage без повторного Save.

## Files touched

- `index.html` — новый блок formы
- `popup.js` — логика чтения/записи/очистки
- `popup.css` — минимум стилей при необходимости
- `content.js` — состояние, слушатели, ветки в `updateMarkers` и `computeMarketplaceFloors`
- `styles.css` — `.own-nft-item--additional`
- (опционально) `docs/architecture.md` — обновление раздела Storage and Secrets
