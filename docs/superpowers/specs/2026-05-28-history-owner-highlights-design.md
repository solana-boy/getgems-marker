# History Owner Highlights — Design

## Goal

В строках истории продаж коллекции на Getgems подсвечивать те записи, которые относятся к нашим кошелькам:

- **зелёный** — мы продали (`oldOwnerUser.id` ∈ наши)
- **красный** — мы купили (`newOwnerUser.id` ∈ наши)
- **фиолетовый** — оба случая (внутренний перевод между нашими кошельками)

«Наши» = `currentUserId` (Getgems ID залогиненного аккаунта) ∪ `additionalOwnerIds` (список, сохранённый в попапе расширения предыдущей фичей — см. [spec 2026-05-28-additional-owner-ids-design.md](2026-05-28-additional-owner-ids-design.md)).

## Non-goals

- Не делаем запросов в Toncenter — все нужные ID есть в GraphQL ответе `historyCollectionNftItems`.
- Не различаем «с основного» vs «с дополнительного» — единая зелёная подсветка.
- Не добавляем title/tooltip на строке.
- Не подсвечиваем строки активности вне коллекционной истории (профили пользователей, главная активность и пр.).
- Не добавляем новые каналы передачи данных между injected.js и content.js — переиспользуем существующий `GETGEMS_MARKER_HISTORY_DATA`.

## Источник данных

GraphQL `historyCollectionNftItems` уже возвращает в каждой записи `typeData`:

```json
{
  "type": "sold",
  "oldOwner": "UQ...",
  "newOwner": "UQ...",
  "oldOwnerUser": { "id": "10251255", ... },
  "newOwnerUser": { "id": "10908699", ... },
  "price": "5000000000",
  "currency": "TON"
}
```

`oldOwnerUser.id` и `newOwnerUser.id` — те же Getgems user IDs, что используются в существующей логике подсветки карточек (`info.ownerId === currentUserId` в `content.js:1295`).

Может отсутствовать, если у одной из сторон нет Getgems-профиля (`oldOwnerUser` / `newOwnerUser` могут быть `null`). В таком случае соответствующая часть проверки пропускается — подсветки нет.

## Изменения в `injected.js`

В функции `processHistoryCollectionResponse` (~ строка 715), при формировании `nextEntry`, добавить две строки:

```js
const typeData = item?.typeData;

if (typeof typeData?.oldOwnerUser?.id === 'string') {
  nextEntry.oldOwnerId = typeData.oldOwnerUser.id;
}

if (typeof typeData?.newOwnerUser?.id === 'string') {
  nextEntry.newOwnerId = typeData.newOwnerUser.id;
}
```

Поля попадают в `historyMarketplaceData[hash]` и далее в `content.js` через существующий `postHistoryData()` → `GETGEMS_MARKER_HISTORY_DATA`.

## Изменения в `content.js`

### Новый хелпер `resolveHistoryOwnerRole`

Размещается рядом с другими history-хелперами (около строки 251–325, после `getSaleHistoryMarkerTitle`):

```js
function resolveHistoryOwnerRole(info) {
  if (!info) return 'none';

  const isMine = (ownerId) =>
    Boolean(ownerId && (
      (currentUserId && ownerId === currentUserId) ||
      additionalOwnerIds.has(ownerId)
    ));

  const sold = isMine(info.oldOwnerId);
  const bought = isMine(info.newOwnerId);

  if (sold && bought) return 'both';
  if (sold) return 'sold-by-me';
  if (bought) return 'bought-by-me';
  return 'none';
}
```

### Расширение `updateActivitySaleMarkers`

Внутри `rows.forEach` (~ строки 364–373), после существующих `syncActivitySaleMarker` / `syncActivitySaleOfferBadge`, добавить:

```js
const role = resolveHistoryOwnerRole(historySaleData[hash]);
row.classList.toggle('history-row--sold-by-me', role === 'sold-by-me');
row.classList.toggle('history-row--bought-by-me', role === 'bought-by-me');
row.classList.toggle('history-row--both-sides', role === 'both');
```

`classList.toggle` с булевым вторым аргументом сам убирает класс, если роль изменилась. На каждом проходе ровно один класс активен (или ни одного).

### Расширение существующих обработчиков

Чтобы подсветка истории обновлялась при изменении `additional_owner_ids`, к двум существующим местам, где уже вызывается `updateMarkers()` + `updateMarketplaceFloorSummary()` (`chrome.storage.onChanged` listener и `GETGEMS_MARKER_REAPPLY_OWNER_MARKERS` ветка) добавить третий вызов:

```js
updateActivitySaleMarkers();
```

То есть:

- `chrome.storage.onChanged` (~ строки 71–77) → добавить `updateActivitySaleMarkers()`
- ветка `GETGEMS_MARKER_REAPPLY_OWNER_MARKERS` в runtime-listener (~ строки 53–58) → добавить `updateActivitySaleMarkers()` в callback `loadAdditionalOwnerIds`

## CSS (`styles.css`)

Три новых правила. Добавить после блока истории/маркеров (рядом со строкой 76, после `.marketplace-sale-marker--unknown`), либо в новый логический блок ниже:

```css
.history-row--sold-by-me {
  background: rgba(34, 197, 94, 0.12) !important;
  box-shadow: inset 3px 0 0 rgba(34, 197, 94, 0.85) !important;
}

.history-row--bought-by-me {
  background: rgba(239, 68, 68, 0.12) !important;
  box-shadow: inset 3px 0 0 rgba(239, 68, 68, 0.85) !important;
}

.history-row--both-sides {
  background: rgba(168, 85, 247, 0.12) !important;
  box-shadow: inset 3px 0 0 rgba(168, 85, 247, 0.85) !important;
}
```

Использован `!important` для перебивания собственных стилей Getgems на `.TableRow`.

Палитра:
- зелёный `rgba(34, 197, 94, …)` — совпадает с цветом `.own-nft-item` (консистентно).
- красный `rgba(239, 68, 68, …)` — стандартный «danger»-красный.
- фиолетовый `rgba(168, 85, 247, …)` — третий нейтральный, чётко отличим.

## Поток данных

```
injected.js processHistoryCollectionResponse
  ├─ extracts marketplace/offchain/saleType (existing)
  ├─ extracts oldOwnerUser.id, newOwnerUser.id (NEW)
  └─ upserts into historyMarketplaceData[hash]
       └─ postHistoryData → GETGEMS_MARKER_HISTORY_DATA
            └─ content.js merges into historySaleData
                 └─ updateActivitySaleMarkers
                      ├─ syncActivitySaleMarker (existing)
                      ├─ syncActivitySaleOfferBadge (existing)
                      └─ resolveHistoryOwnerRole + classList.toggle (NEW)

popup save additional_owner_ids
  └─ chrome.storage.onChanged
       ├─ updateMarkers (existing)
       ├─ updateMarketplaceFloorSummary (existing)
       └─ updateActivitySaleMarkers (NEW)

popup REAPPLY_OWNER_MARKERS
  └─ loadAdditionalOwnerIds → callback
       ├─ updateMarkers (existing)
       ├─ updateMarketplaceFloorSummary (existing)
       └─ updateActivitySaleMarkers (NEW)
```

## Тестирование (ручное)

1. Открыть `https://getgems.io/collection/<addr>?filter={"type":["sold"]}` для коллекции с продажами с/на ваш аккаунт.
2. Строка, где `oldOwnerUser.id === currentUserId` → зелёный фон + зелёная полоса слева, title и маркетплейс-маркер без изменений.
3. Строка, где `newOwnerUser.id === currentUserId` → красный фон + полоса.
4. В попапе сохранить дополнительный ID, который встречается в одной из строк как `oldOwnerUser.id` → строка немедленно получает зелёную подсветку (за счёт `storage.onChanged`).
5. Строка, где `oldOwnerUser.id === currentUserId` и `newOwnerUser.id ∈ additionalOwnerIds` (или наоборот) → фиолетовая подсветка.
6. Очистить дополнительные ID в попапе → фиолетовые строки становятся зелёными или красными (в зависимости от того, какая сторона совпадала с основным), либо подсветка пропадает.
7. Перезагрузить вкладку → подсветка появляется автоматически при загрузке истории.

## Failure Modes

- `oldOwnerUser` или `newOwnerUser` отсутствует в payload → соответствующая часть проверки пропускается, подсветка для этой стороны не применяется.
- В строке нет ссылки на tonviewer (значит нет хеша) → `historySaleData[hash]` недоступен → подсветка не применяется (то же поведение, что и у существующих маркетплейс-маркеров).
- Изменения `additionalOwnerIds` не дошли в content.js (теоретический race) → следующий проход `updateActivitySaleMarkers` (по MutationObserver или setInterval каждые 2 секунды) подхватит.

## Файлы

- `injected.js` — добавить 2 поля в `nextEntry` в `processHistoryCollectionResponse`
- `content.js` — функция `resolveHistoryOwnerRole`, расширение `updateActivitySaleMarkers`, добавление `updateActivitySaleMarkers()` в `storage.onChanged` и `REAPPLY_OWNER_MARKERS` callback
- `styles.css` — три правила `.history-row--*`
- (опционально) `docs/history-sales.md` — короткая заметка про новые поля и подсветку
