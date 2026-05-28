# Additional Owner IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователю поле в попапе расширения для списка дополнительных Getgems user IDs; карточки этих владельцев подсвечиваются бирюзовым (рядом с зелёной подсветкой основного аккаунта).

**Architecture:** Список ID хранится в `chrome.storage.local` под ключом `additional_owner_ids`. Попап читает/пишет ключ и шлёт активной вкладке сигнал перерисовать маркеры. `content.js` подписан на `chrome.storage.onChanged` и держит `Set<string>` в памяти; `updateMarkers()` и `computeMarketplaceFloors()` используют этот Set наряду с `currentUserId`.

**Tech Stack:** Manifest V3 расширение для Chrome, ванильный JS (без сборки), `chrome.storage.local`, `chrome.runtime` сообщения. Тестов в проекте нет — верификация ручная в DevTools.

**Источник:** [Spec 2026-05-28-additional-owner-ids-design.md](../specs/2026-05-28-additional-owner-ids-design.md)

---

## File Structure

- **Modify:** `index.html` — добавить второй блок формы под существующим `api-password-form`
- **Modify:** `popup.css` — добавить класс под textarea (расширение `popup__input`)
- **Modify:** `popup.js` — добавить обработчики save/load/clear для нового ключа + сообщение активной вкладке
- **Modify:** `content.js` — добавить состояние `additionalOwnerIds`, подписку на storage, ветку `updateMarkers`, ветку `computeMarketplaceFloors`, обработчик нового runtime-сообщения
- **Modify:** `styles.css` — добавить правило `.own-nft-item--additional`

---

## Task 1: HTML-блок для textarea дополнительных ID

**Files:**
- Modify: `index.html` — после закрывающего `</form>` (строка 34) добавить второй блок

- [ ] **Step 1: Открыть `index.html` и вставить второй блок формы**

После строки `</form>` (закрытие `api-password-form`, ~ строка 34) и перед `</main>` (~ строка 35) вставить:

```html

    <form id="additional-owner-ids-form" class="popup__form popup__form--secondary">
      <h2 class="popup__subtitle">Additional owner IDs</h2>
      <p class="popup__copy">
        Highlight NFT cards owned by these Getgems user IDs in a secondary color. One ID per line.
      </p>

      <label class="popup__label" for="additional-owner-ids">Getgems user IDs</label>
      <textarea
        id="additional-owner-ids"
        class="popup__input popup__input--textarea"
        name="additional_owner_ids"
        spellcheck="false"
        autocomplete="off"
        placeholder="One Getgems user ID per line"
        rows="6"
      ></textarea>

      <div class="popup__actions">
        <button class="popup__button popup__button--primary" type="submit">Save</button>
        <button class="popup__button popup__button--secondary" type="button" id="clear-additional-owner-ids">Clear</button>
      </div>

      <p id="additional-owner-ids-status" class="popup__status" role="status" aria-live="polite"></p>
    </form>
```

- [ ] **Step 2: Открыть попап в Chrome и убедиться, что блок отрисовался**

В `chrome://extensions` нажать «обновить» на расширении, открыть попап. Ожидаемо: под формой api_password виден заголовок «Additional owner IDs», textarea, кнопки Save/Clear. Textarea пока без стилей — это нормально, исправляем в Task 2.

- [ ] **Step 3: Коммит**

```bash
git add index.html
git commit -m "feat(popup): add additional owner IDs textarea block"
```

---

## Task 2: Стили textarea и подзаголовка в попапе

**Files:**
- Modify: `popup.css` — добавить в конец файла

- [ ] **Step 1: Открыть `popup.css` и добавить в конец**

```css

.popup__form--secondary {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
}

.popup__subtitle {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
  color: #f8fafc;
}

.popup__input--textarea {
  min-height: 96px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 1.4;
}
```

- [ ] **Step 2: Перезагрузить расширение, открыть попап**

Ожидаемо: блок отделён горизонтальной чертой сверху, textarea моноширинным шрифтом, минимум 6 строк, с возможностью растяжения по вертикали.

- [ ] **Step 3: Коммит**

```bash
git add popup.css
git commit -m "style(popup): style additional owner IDs textarea block"
```

---

## Task 3: Сохранение/загрузка/очистка дополнительных ID в popup.js

**Files:**
- Modify: `popup.js` — расширить IIFE дополнительными обработчиками

- [ ] **Step 1: Открыть `popup.js` и заменить вызов `loadApiPassword();` на инициализацию обоих блоков**

Перед строкой `loadApiPassword();` (~ строка 130) добавить новые элементы, хелперы и обработчики. Конкретно — заменить участок от `clearButton.addEventListener` (~ строка 119) до конца файла на:

```javascript
  clearButton.addEventListener('click', async() => {
    try {
      await storageLocalRemove('api_password');
      input.value = '';
      setStatus('api_password cleared.');
    } catch (error) {
      console.error('[Getgems Marker] Failed to clear api_password:', error);
      setStatus('Failed to clear api_password.');
    }
  });

  const additionalForm = document.getElementById('additional-owner-ids-form');
  const additionalInput = document.getElementById('additional-owner-ids');
  const additionalClearButton = document.getElementById('clear-additional-owner-ids');
  const additionalStatus = document.getElementById('additional-owner-ids-status');

  function setAdditionalStatus(message) {
    additionalStatus.textContent = message || '';
  }

  function parseAdditionalOwnerIds(text) {
    const lines = (text || '').split('\n');
    const seen = new Set();
    const result = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }

    return result;
  }

  async function notifyActiveTabToReapplyOwnerMarkers() {
    const activeTab = await queryActiveTab();
    if (!activeTab?.id) return;

    await new Promise((resolve) => {
      chrome.tabs.sendMessage(activeTab.id, { type: 'GETGEMS_MARKER_REAPPLY_OWNER_MARKERS' }, () => {
        resolve();
      });
    });
  }

  async function loadAdditionalOwnerIds() {
    try {
      const items = await storageLocalGet({ additional_owner_ids: [] });
      const value = Array.isArray(items.additional_owner_ids) ? items.additional_owner_ids : [];
      additionalInput.value = value.join('\n');
    } catch (error) {
      console.error('[Getgems Marker] Failed to load additional_owner_ids:', error);
      setAdditionalStatus('Failed to load additional owner IDs.');
    }
  }

  additionalForm.addEventListener('submit', async(event) => {
    event.preventDefault();

    try {
      const parsed = parseAdditionalOwnerIds(additionalInput.value);
      await storageLocalSet({ additional_owner_ids: parsed });
      additionalInput.value = parsed.join('\n');
      await notifyActiveTabToReapplyOwnerMarkers();
      setAdditionalStatus(`Saved ${parsed.length} additional owner ID${parsed.length === 1 ? '' : 's'}.`);
    } catch (error) {
      console.error('[Getgems Marker] Failed to save additional_owner_ids:', error);
      setAdditionalStatus('Failed to save additional owner IDs.');
    }
  });

  additionalClearButton.addEventListener('click', async() => {
    try {
      await storageLocalRemove('additional_owner_ids');
      additionalInput.value = '';
      await notifyActiveTabToReapplyOwnerMarkers();
      setAdditionalStatus('Cleared additional owner IDs.');
    } catch (error) {
      console.error('[Getgems Marker] Failed to clear additional_owner_ids:', error);
      setAdditionalStatus('Failed to clear additional owner IDs.');
    }
  });

  loadApiPassword();
  loadAdditionalOwnerIds();
})();
```

- [ ] **Step 2: Перезагрузить расширение, проверить save/load**

1. Открыть попап, в textarea вписать на отдельных строках: `aaa`, `  bbb  `, `aaa` (дубликат), пустую строку, `ccc`.
2. Нажать Save. Ожидаемо в статусе: `Saved 3 additional owner IDs.` Textarea приводится к нормализованному виду (`aaa\nbbb\nccc`).
3. Открыть DevTools для попапа (правая кнопка в попапе → Inspect), вкладка Application → Storage → Extension Storage → Local. Убедиться, что `additional_owner_ids` = `["aaa","bbb","ccc"]`.
4. Закрыть и снова открыть попап. Ожидаемо: textarea подгружена со значениями.
5. Нажать Clear. Ожидаемо: textarea пуста, статус `Cleared additional owner IDs.`, ключ в storage удалён.

- [ ] **Step 3: Коммит**

```bash
git add popup.js
git commit -m "feat(popup): persist and edit list of additional owner IDs"
```

---

## Task 4: CSS-правило для вторичной подсветки

**Files:**
- Modify: `styles.css` — добавить после правила `.own-nft-item` (~ строка 158)

- [ ] **Step 1: Открыть `styles.css` и добавить новое правило**

После закрывающей `}` блока `.own-nft-item` (строка 158) и перед `.marketplace-floor-summary` (строка 160) вставить:

```css

.own-nft-item--additional {
  box-shadow:
    0 0 8px 2px rgba(20, 184, 166, 0.35),
    0 0 20px 4px rgba(20, 184, 166, 0.15) !important;
  border-radius: 12px !important;
}
```

- [ ] **Step 2: Проверить, что правило загружается**

Перезагрузить расширение, открыть любую страницу Getgems, в DevTools (вкладка Elements) найти любую `.NftItemContainer`, через консоль добавить класс:

```javascript
document.querySelector('.NftItemContainer').classList.add('own-nft-item--additional')
```

Ожидаемо: карточка получает бирюзовую рамку (свечение). Снять класс — рамка пропадает.

- [ ] **Step 3: Коммит**

```bash
git add styles.css
git commit -m "style: add teal highlight for additional owner cards"
```

---

## Task 5: Состояние, storage subscription и message-обработчик в content.js

**Files:**
- Modify: `content.js`
  - Добавить переменную состояния рядом с `currentUserId`
  - Расширить существующий `chrome.runtime.onMessage` слушатель
  - Добавить новый `chrome.storage.onChanged` слушатель
  - Загрузить значение в `init()`

- [ ] **Step 1: Добавить переменную состояния**

После строки `let currentUserId = null;` (строка 14) вставить:

```javascript

  // Additional Getgems user IDs whose NFTs should also be highlighted (secondary tone).
  let additionalOwnerIds = new Set();
```

- [ ] **Step 2: Расширить существующий runtime-message слушатель**

Заменить блок `chrome.runtime.onMessage.addListener` (строки 40–51) на:

```javascript
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'GETGEMS_MARKER_RETRY_HISTORY_LOOKUPS') {
      requestedHistoryLookupAt.clear();
      historyLookupBatchInFlight = false;
      requestMissingActivityHistoryLookups();
      updateActivitySaleMarkers();
      return undefined;
    }

    if (message?.type === 'GETGEMS_MARKER_REAPPLY_OWNER_MARKERS') {
      loadAdditionalOwnerIds(() => {
        updateMarkers();
        updateMarketplaceFloorSummary();
      });
      return undefined;
    }

    return undefined;
  });
```

- [ ] **Step 3: Добавить `loadAdditionalOwnerIds` и storage subscription**

Сразу после блока `chrome.runtime.onMessage.addListener` вставить:

```javascript

  function loadAdditionalOwnerIds(callback) {
    chrome.storage.local.get({ additional_owner_ids: [] }, (items) => {
      const value = Array.isArray(items?.additional_owner_ids) ? items.additional_owner_ids : [];
      additionalOwnerIds = new Set(value);
      if (typeof callback === 'function') callback();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.additional_owner_ids) return;
    const next = changes.additional_owner_ids.newValue;
    additionalOwnerIds = new Set(Array.isArray(next) ? next : []);
    updateMarkers();
    updateMarketplaceFloorSummary();
  });
```

- [ ] **Step 4: Загрузить начальные значения в `init()`**

В функции `init()` (строка 98) после строки `console.log('[Getgems Marker] Content script initialized');` (строка 99) добавить:

```javascript
    loadAdditionalOwnerIds();
```

- [ ] **Step 5: Перезагрузить расширение и проверить состояние**

1. Открыть любую страницу `getgems.io`, открыть DevTools.
2. В консоли content script (выбрать context страницы) выполнить:
   ```javascript
   chrome.storage.local.set({ additional_owner_ids: ['test-id-1'] })
   ```
3. В логах ожидаемо ничего нового (логирование не добавляли), но видимых поломок быть не должно. Карточки пока не подсвечиваются — следующая задача.
4. Через попап добавить ID и сохранить → ошибок в консоли нет, обработчик `GETGEMS_MARKER_REAPPLY_OWNER_MARKERS` срабатывает.

- [ ] **Step 6: Коммит**

```bash
git add content.js
git commit -m "feat(content): track additional_owner_ids from storage and popup signal"
```

---

## Task 6: Подсветка дополнительных владельцев в `updateMarkers`

**Files:**
- Modify: `content.js:1279-1310` — функция `updateMarkers`

- [ ] **Step 1: Открыть `content.js`, найти `updateMarkers` (строка 1279)**

Заменить весь блок `containers.forEach(container => { ... });` (строки 1288–1305 включительно — открывающий вызов и закрывающее `});`) на:

```javascript
    containers.forEach(container => {
      const nftAddress = extractNftAddress(container);
      if (!nftAddress) return;

      const info = nftData[nftAddress];
      if (!info) return;

      const ownerId = info.ownerId || null;
      const isOwn = Boolean(currentUserId && ownerId && ownerId === currentUserId);
      const isAdditional = Boolean(!isOwn && ownerId && additionalOwnerIds.has(ownerId));

      container.classList.toggle('own-nft-item', isOwn);
      container.classList.toggle('own-nft-item--additional', isAdditional);
      updateExactPriceDisplay(container, info);
      syncSpecialPriceMarker(container, info);

      if (container.querySelector('.marketplace-marker')) return;

      addMarkerToCard(container, info.marketplace);
      marked++;
    });
```

- [ ] **Step 2: Проверить подсветку**

1. Перезагрузить расширение, открыть страницу коллекции Getgems с листингами.
2. В попапе вписать чужой Getgems user ID, у которого есть листинги на странице. Save.
3. Ожидаемо: карточки этого владельца получают бирюзовую рамку, карточки залогиненного аккаунта — зелёную, остальные — без рамки.
4. Вписать в textarea свой собственный ID (тот же, что у залогиненного аккаунта) и нажать Save. Ожидаемо: своя карточка остаётся зелёной (без удвоения).
5. Нажать Clear → бирюзовая рамка пропадает в течение секунды-двух (за счёт MutationObserver + интервала). На странице со статичным содержимым может потребоваться pageмаленький scroll/resize для триггера; это не проблема.

- [ ] **Step 3: Коммит**

```bash
git add content.js
git commit -m "feat(content): apply secondary highlight for additional owner cards"
```

---

## Task 7: Включить дополнительных в floor summary `mine`

**Files:**
- Modify: `content.js:1054-1064` — функция `computeMarketplaceFloors`, цикл по `listings`

- [ ] **Step 1: Заменить `listings.forEach`-блок**

В функции `computeMarketplaceFloors` (строка 1034) заменить блок `listings.forEach` (строки 1054–1064) на:

```javascript
    listings.forEach(listing => {
      const priceNano = BigInt(listing.fullPriceNano);

      if (listing.marketplace === 'getgems' || listing.marketplace === 'fragment') {
        updateFloor(listing.marketplace, listing, priceNano);
      }

      const ownerId = listing.ownerId || null;
      const belongsToUser =
        (currentUserId && ownerId && ownerId === currentUserId) ||
        (ownerId && additionalOwnerIds.has(ownerId));

      if (belongsToUser) {
        updateFloor('mine', listing, priceNano);
      }
    });
```

- [ ] **Step 2: Проверить floor summary**

1. Перезагрузить расширение, открыть страницу коллекции, где у вашего основного аккаунта есть листинги (например, с твоим NFT, выставленным на продажу).
2. Запомнить значение строки `mine` в Listing floors.
3. В попапе сохранить ID другого владельца, у которого на этой же странице есть более дешёвый листинг.
4. Ожидаемо: строка `mine` обновилась до минимальной цены среди всех «своих» (моих + дополнительных). Подпись и стиль строки те же.
5. Очистить дополнительные ID → строка `mine` возвращается к значению только основного кошелька.

- [ ] **Step 3: Коммит**

```bash
git add content.js
git commit -m "feat(content): include additional owners in mine floor row"
```

---

## Task 8: Интеграционная ручная проверка и cleanup

**Files:**
- Read-only — финальная сборка проверок

- [ ] **Step 1: Сценарий 1 — пустой список**

1. В попапе очистить дополнительные ID (если не пусто). Закрыть попап.
2. Открыть страницу коллекции Getgems.
3. Ожидаемо: только карточки залогиненного аккаунта имеют зелёную рамку. Бирюзовых нет.

- [ ] **Step 2: Сценарий 2 — несколько дополнительных ID**

1. Открыть DevTools на странице Getgems → вкладка Application → Extension Storage → Local. Скопировать чей-то владелец ID (например, через `nftData` в консоли content script: `Object.values(nftData).find(v => v.ownerId)?.ownerId`).
2. В попапе вписать два разных чужих ID на разных строках, Save.
3. Ожидаемо: все карточки этих двух владельцев получают бирюзовую рамку.

- [ ] **Step 3: Сценарий 3 — перезагрузка страницы**

1. Сохранить какой-то ID в попапе.
2. Полностью перезагрузить вкладку Getgems (Ctrl+R).
3. Ожидаемо: после загрузки карточек бирюзовая рамка появляется автоматически (значение пришло из storage в `init`).

- [ ] **Step 4: Сценарий 4 — мусор и дубликаты**

1. В textarea ввести: пустые строки, пробелы, повторы (`abc`, `abc`, ` def `).
2. Save.
3. Ожидаемо: storage содержит `["abc","def"]`, textarea приводится к нормализованному виду.

- [ ] **Step 5: Сценарий 5 — popup → активная вкладка**

1. Открыть страницу коллекции.
2. В попапе сохранить ID — карточки в активной вкладке должны обновиться немедленно (за счёт runtime-сообщения), не дожидаясь следующего интервала `setInterval`.

- [ ] **Step 6: Финальный smoke-тест существующей функциональности**

1. Убедиться, что api_password по-прежнему работает: сохранить тестовый ключ, ожидаемый статус «api_password saved. Toncenter keys loaded: N».
2. Подсветка собственных листингов (зелёная) и блок Listing floors работают как раньше.
3. История продаж (collection activity history) маркируется как и раньше.

- [ ] **Step 7: Если найдены баги — исправить, commit отдельным коммитом, повторить сценарии**

- [ ] **Step 8: Финальный коммит (если был cleanup)**

```bash
git add -A
git commit -m "chore: post-implementation cleanup for additional owner IDs"
```

Если cleanup не требовался — пропустить шаг.

---

## Done criteria

- Все 7 задач закоммичены.
- В попапе есть рабочий блок «Additional owner IDs» с textarea, Save, Clear.
- `chrome.storage.local.additional_owner_ids` содержит дедуплицированный массив.
- Карточки с `ownerId` из списка получают `.own-nft-item--additional` (бирюзовая рамка).
- Карточки с `ownerId === currentUserId` остаются зелёными даже при наличии своего ID в списке.
- Listing floors `mine` = минимум среди всех «своих» (основной + дополнительные).
- Сохранение/очистка в попапе мгновенно отражается на активной вкладке.
- Существующая функциональность (api_password, history markers, floor getgems/fragment) не пострадала.
