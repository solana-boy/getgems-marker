# History Owner Highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подсветить строки истории продаж коллекции на Getgems зелёным (продано с нашего кошелька), красным (куплено на наш) или фиолетовым (внутренний перевод), используя `oldOwnerUser.id`/`newOwnerUser.id` из существующего GraphQL ответа.

**Architecture:** `injected.js` уже перехватывает `historyCollectionNftItems` — расширяем извлечение записи двумя полями. `content.js` хранит данные истории под ключом hash; добавляем чистый хелпер для классификации и тоггл трёх классов на `.TableRow`. Подсветка пересчитывается, когда меняется список `additionalOwnerIds`, через уже существующие слушатели.

**Tech Stack:** Manifest V3 расширение, ванильный JS, без сборки. Тесты — ручная проверка в DevTools на реальных страницах коллекций.

**Источник:** [Spec 2026-05-28-history-owner-highlights-design.md](../specs/2026-05-28-history-owner-highlights-design.md)

---

## File Structure

- **Modify:** `injected.js` — расширить `processHistoryCollectionResponse` (около строки 715) двумя полями в `nextEntry`
- **Modify:** `content.js`
  - добавить функцию `resolveHistoryOwnerRole` рядом с другими history-хелперами
  - расширить `updateActivitySaleMarkers` (~ строка 360) тремя class-toggles
  - добавить вызов `updateActivitySaleMarkers()` в `storage.onChanged` listener (~ строки 71–77) и в `GETGEMS_MARKER_REAPPLY_OWNER_MARKERS` ветку (~ строки 52–58)
- **Modify:** `styles.css` — три CSS правила `.history-row--sold-by-me`, `.history-row--bought-by-me`, `.history-row--both-sides`

---

## Task 1: Извлечь oldOwnerId / newOwnerId из GraphQL ответа

**Files:**
- Modify: `C:\Users\sudde\PycharmProjects\getgems-marker\injected.js` — функция `processHistoryCollectionResponse` (около строки 709), цикл `historyItems.forEach` (около строки 715)

- [ ] **Step 1: Открыть `injected.js` и расширить `nextEntry`**

Найти блок (около строк 721–736):

```javascript
      const nextEntry = {
        offchain: Boolean(item.offchain),
        saleType: 'sale'
      };

      if (item?.nft?.name) {
        nextEntry.nftName = item.nft.name;
      }

      if (typeof item?.time === 'number') {
        nextEntry.time = item.time;
      }

      if (item.offchain) {
        nextEntry.marketplace = 'getgems';
      }
```

Заменить на:

```javascript
      const nextEntry = {
        offchain: Boolean(item.offchain),
        saleType: 'sale'
      };

      if (item?.nft?.name) {
        nextEntry.nftName = item.nft.name;
      }

      if (typeof item?.time === 'number') {
        nextEntry.time = item.time;
      }

      if (item.offchain) {
        nextEntry.marketplace = 'getgems';
      }

      const typeData = item?.typeData;

      if (typeof typeData?.oldOwnerUser?.id === 'string') {
        nextEntry.oldOwnerId = typeData.oldOwnerUser.id;
      }

      if (typeof typeData?.newOwnerUser?.id === 'string') {
        nextEntry.newOwnerId = typeData.newOwnerUser.id;
      }
```

- [ ] **Step 2: Проверить, что синтаксис валиден**

Запустить:
```
node --check injected.js
```

Ожидаемо: команда отрабатывает без вывода (нет ошибок).

- [ ] **Step 3: Коммит**

```
git add injected.js
git commit -m "feat(injected): expose history owner IDs in history data"
```

---

## Task 2: Подсветка строк истории по роли владельца

**Files:**
- Modify: `C:\Users\sudde\PycharmProjects\getgems-marker\content.js`
  - добавить функцию `resolveHistoryOwnerRole` сразу после `getSaleHistoryMarkerTitle` (около строки 292)
  - расширить `updateActivitySaleMarkers` (около строк 360–373)

- [ ] **Step 1: Добавить функцию `resolveHistoryOwnerRole`**

Найти конец функции `getSaleHistoryMarkerTitle` (около строки 292):

```javascript
    return 'Sale marketplace is unknown';
  }

  function syncActivitySaleOfferBadge(markerHost, hash, info) {
```

Вставить новую функцию между `}` и `function syncActivitySaleOfferBadge`:

```javascript
    return 'Sale marketplace is unknown';
  }

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

  function syncActivitySaleOfferBadge(markerHost, hash, info) {
```

- [ ] **Step 2: Расширить `updateActivitySaleMarkers`**

Найти функцию `updateActivitySaleMarkers` (около строки 360). Текущее тело forEach:

```javascript
    rows.forEach((row) => {
      if (!isSaleHistoryRow(row)) return;

      const hash = extractHistoryTransactionHash(row);
      const markerHost = getSaleHistoryMarkerHost(row);
      if (!hash || !markerHost) return;

      syncActivitySaleMarker(markerHost, hash, historySaleData[hash]);
      syncActivitySaleOfferBadge(markerHost, hash, historySaleData[hash]);
    });
```

Заменить на:

```javascript
    rows.forEach((row) => {
      if (!isSaleHistoryRow(row)) return;

      const hash = extractHistoryTransactionHash(row);
      const markerHost = getSaleHistoryMarkerHost(row);
      if (!hash || !markerHost) return;

      syncActivitySaleMarker(markerHost, hash, historySaleData[hash]);
      syncActivitySaleOfferBadge(markerHost, hash, historySaleData[hash]);

      const role = resolveHistoryOwnerRole(historySaleData[hash]);
      row.classList.toggle('history-row--sold-by-me', role === 'sold-by-me');
      row.classList.toggle('history-row--bought-by-me', role === 'bought-by-me');
      row.classList.toggle('history-row--both-sides', role === 'both');
    });
```

- [ ] **Step 3: Проверить синтаксис**

```
node --check content.js
```

Ожидаемо: без вывода.

- [ ] **Step 4: Коммит**

```
git add content.js
git commit -m "feat(content): highlight history rows by owner role"
```

---

## Task 3: Перерендерить историю при изменении `additionalOwnerIds`

**Files:**
- Modify: `C:\Users\sudde\PycharmProjects\getgems-marker\content.js`
  - вызов `updateActivitySaleMarkers()` в `GETGEMS_MARKER_REAPPLY_OWNER_MARKERS` callback (около строк 52–58)
  - вызов `updateActivitySaleMarkers()` в `chrome.storage.onChanged` listener (около строк 71–77)

- [ ] **Step 1: Добавить вызов в REAPPLY_OWNER_MARKERS callback**

Найти (около строк 52–58):

```javascript
    if (message?.type === 'GETGEMS_MARKER_REAPPLY_OWNER_MARKERS') {
      loadAdditionalOwnerIds(() => {
        updateMarkers();
        updateMarketplaceFloorSummary();
      });
      return undefined;
    }
```

Заменить на:

```javascript
    if (message?.type === 'GETGEMS_MARKER_REAPPLY_OWNER_MARKERS') {
      loadAdditionalOwnerIds(() => {
        updateMarkers();
        updateMarketplaceFloorSummary();
        updateActivitySaleMarkers();
      });
      return undefined;
    }
```

- [ ] **Step 2: Добавить вызов в `chrome.storage.onChanged` listener**

Найти (около строк 71–77):

```javascript
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.additional_owner_ids) return;
    const next = changes.additional_owner_ids.newValue;
    additionalOwnerIds = new Set(Array.isArray(next) ? next : []);
    updateMarkers();
    updateMarketplaceFloorSummary();
  });
```

Заменить на:

```javascript
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.additional_owner_ids) return;
    const next = changes.additional_owner_ids.newValue;
    additionalOwnerIds = new Set(Array.isArray(next) ? next : []);
    updateMarkers();
    updateMarketplaceFloorSummary();
    updateActivitySaleMarkers();
  });
```

- [ ] **Step 3: Проверить синтаксис**

```
node --check content.js
```

Ожидаемо: без вывода.

- [ ] **Step 4: Коммит**

```
git add content.js
git commit -m "feat(content): refresh history highlights on owner list changes"
```

---

## Task 4: CSS правила для подсветки строк истории

**Files:**
- Modify: `C:\Users\sudde\PycharmProjects\getgems-marker\styles.css` — добавить три правила после `.marketplace-sale-marker--unknown` (около строки 80, после блока маркеров истории)

- [ ] **Step 1: Найти `.marketplace-sale-marker--unknown`**

В файле `styles.css` найти правило (около строки 76):

```css
.marketplace-sale-marker--unknown {
```

И его закрывающую `}` (через пару строк).

- [ ] **Step 2: Вставить три новых правила сразу после закрывающей `}` блока `.marketplace-sale-marker--unknown`**

После закрывающей `}` блока `.marketplace-sale-marker--unknown` добавить:

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

- [ ] **Step 3: Коммит**

```
git add styles.css
git commit -m "style: highlight history rows by owner role (green/red/purple)"
```

---

## Task 5: Интеграционная ручная проверка

**Files:**
- Read-only — сценарии ручной проверки в браузере

- [ ] **Step 1: Сценарий 1 — мы продали**

1. Перезагрузить расширение в `chrome://extensions`.
2. Открыть `https://getgems.io/collection/<addr>?filter={"type":["sold"]}` для коллекции, где есть продажа с вашего залогиненного аккаунта.
3. Ожидаемо: строка с этой продажей имеет зелёный фон (`rgba(34, 197, 94, 0.12)`) и зелёную полосу слева. Маркетплейс-маркер (G/F/?) и offer-бейдж не пострадали.

- [ ] **Step 2: Сценарий 2 — мы купили**

1. На той же странице найти строку, где `newOwnerUser.id === currentUserId` (т. е. купили на залогиненный аккаунт).
2. Ожидаемо: красный фон + красная полоса слева.

- [ ] **Step 3: Сценарий 3 — дополнительный кошелёк**

1. В попапе сохранить дополнительный Getgems user ID, который встречается в истории (например, как `oldOwnerUser.id`).
2. Ожидаемо: соответствующая строка сразу получает зелёную подсветку без перезагрузки страницы (за счёт `chrome.storage.onChanged`).

- [ ] **Step 4: Сценарий 4 — внутренний перевод**

1. Найти продажу, где одна сторона — основной аккаунт, а другая — один из дополнительных ID.
2. Ожидаемо: фиолетовый фон + фиолетовая полоса.

- [ ] **Step 5: Сценарий 5 — очистка дополнительных**

1. В попапе очистить дополнительные ID.
2. Ожидаемо: фиолетовые строки превращаются в зелёные или красные (в зависимости от того, какая сторона совпадала с основным `currentUserId`); либо подсветка пропадает, если ни одна сторона больше не наша.

- [ ] **Step 6: Сценарий 6 — перезагрузка страницы**

1. С одним или несколькими сохранёнными доп. ID, полностью перезагрузить вкладку (Ctrl+R).
2. Ожидаемо: после загрузки строк подсветка появляется автоматически.

- [ ] **Step 7: Smoke-тест существующей функциональности**

1. Маркетплейс-маркеры (G/F/?) рисуются как прежде.
2. Offer-бейдж работает.
3. Зелёная подсветка карточек в /collection и в Listing floors panel работают.

- [ ] **Step 8: Если найдены баги — исправить и закоммитить отдельным коммитом**

Без отдельных правок просто отметить шаг как сделанный.

---

## Done criteria

- Все 4 содержательные задачи закоммичены (Task 5 — ручная проверка без своего коммита).
- В строках истории на странице коллекции:
  - продали с нашего → зелёный фон
  - купили на наш → красный фон
  - оба случая → фиолетовый фон
- `updateActivitySaleMarkers` вызывается из обоих мест (storage.onChanged и REAPPLY_OWNER_MARKERS).
- `injected.js` отдаёт `oldOwnerId`/`newOwnerId` рядом с остальной history-data.
- Существующие маркеры маркетплейса, offer-бейдж, и подсветка карточек NFT работают без регрессий.
