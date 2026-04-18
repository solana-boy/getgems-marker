// Content script for Getgems Marketplace Marker
(function() {
  'use strict';

  console.log('[Getgems Marker] Content script starting...');

  // Store NFT data received from injected script
  let nftData = {};

  // Store sale history marketplace data keyed by transaction hash
  let historySaleData = {};

  // Store current user ID
  let currentUserId = null;

  // Track all listings encountered on the current page so floors survive virtualized scrolling.
  let marketplaceFloorState = null;

  let giftSatelliteOverlay = null;
  let giftSatelliteScrollLock = null;

  // Avoid spamming hash lookup fallback requests if a response is still in flight.
  const requestedHistoryLookupAt = new Map();

  let historyLookupBatchInFlight = false;

  // Inject the fetch interceptor into the page context
  function injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
      console.log('[Getgems Marker] Injected script loaded');
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  injectScript();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'GETGEMS_MARKER_RETRY_HISTORY_LOOKUPS') {
      return undefined;
    }

    requestedHistoryLookupAt.clear();
    historyLookupBatchInFlight = false;
    requestMissingActivityHistoryLookups();
    updateActivitySaleMarkers();

    return undefined;
  });

  // Listen for messages from injected script (page context)
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'GETGEMS_MARKER_CURRENT_USER') {
      currentUserId = event.data.userId;
      console.log('[Getgems Marker] Received current user ID:', currentUserId);
      // Re-apply markers in case NFT data arrived before user ID
      updateMarkers();
      updateMarketplaceFloorSummary();
    }
    if (event.data?.type === 'GETGEMS_MARKER_NFT_DATA') {
      console.log('[Getgems Marker] Received NFT data via postMessage:', Object.keys(event.data.data).length, 'items');
      nftData = event.data.data;
      updateMarkers();
      updateItemPageMarker();
      updateGiftSatelliteLauncher();
      updateMarketplaceFloorSummary();
    }
    if (event.data?.type === 'GETGEMS_MARKER_HISTORY_DATA') {
      const incomingHistoryData = event.data.data || {};
      console.log('[Getgems Marker] Received history data via postMessage:', Object.keys(incomingHistoryData).length, 'items');
      historySaleData = {
        ...historySaleData,
        ...incomingHistoryData
      };

      Object.entries(incomingHistoryData).forEach(([hash, info]) => {
        if (info?.marketplace) {
          requestedHistoryLookupAt.delete(hash);
        }
      });

      updateActivitySaleMarkers();
    }
  });

  window.addEventListener('message', handleGiftSatelliteEmbedMessage);

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    console.log('[Getgems Marker] Content script initialized');

    const refreshUi = debounce(() => {
      updateMarkers();
      updateItemPageMarker();
      updateGiftSatelliteLauncher();
      updateMarketplaceFloorSummary();
      updateActivitySaleMarkers();
      requestMissingActivityHistoryLookups();
    }, 300);

    // Observe DOM changes for dynamically loaded content
    const observer = new MutationObserver(refreshUi);

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Periodic update
    setInterval(() => {
      updateMarkers();
      updateItemPageMarker();
      updateGiftSatelliteLauncher();
      updateMarketplaceFloorSummary();
      updateActivitySaleMarkers();
      requestMissingActivityHistoryLookups();
    }, 2000);

    // Try to fetch initial data after a delay (for cached pages)
    setTimeout(fetchInitialData, 1500);
    setTimeout(fetchInitialData, 3000);

    // For item pages, try to extract data from __NEXT_DATA__
    setTimeout(extractItemPageData, 500);
    setTimeout(extractItemPageData, 2000);
    
    // For /nft/ pages, also try to fetch data directly if extraction fails
    setTimeout(fetchNftPageData, 1000);
    setTimeout(fetchNftPageData, 3000);
  }
  
  // Fetch NFT data directly for /nft/ADDRESS pages
  function fetchNftPageData() {
    const nftPathMatch = window.location.pathname.match(/\/nft\/([A-Za-z0-9_-]+)/);
    if (!nftPathMatch) return;
    
    const nftAddress = nftPathMatch[1];
    const knownInfo = nftData[nftAddress];
    
    // Keep fetching until we know the precise sale price for fixed-price NFTs.
    if (knownInfo && (knownInfo.fullPriceNano || knownInfo.kind === 'OffchainNft')) return;
    
    console.log('[Getgems Marker] Requesting data for NFT page:', nftAddress);
    window.postMessage({
      type: 'GETGEMS_MARKER_REQUEST_DATA',
      addresses: [nftAddress]
    }, '*');
  }

  // Extract NFT data from __NEXT_DATA__ for item pages
  function extractItemPageData() {
    // Check if we're on an item page (either /collection/ADDRESS/ITEM or /nft/ADDRESS)
    const isCollectionItemPage = /\/collection\/[^/]+\/[^/]+/.test(window.location.pathname);
    const isNftPage = /\/nft\/[A-Za-z0-9_-]+/.test(window.location.pathname);
    if (!isCollectionItemPage && !isNftPage) return;

    console.log('[Getgems Marker] Detected item page, extracting data...');

    // Request data extraction from page context
    window.postMessage({
      type: 'GETGEMS_MARKER_EXTRACT_PAGE_DATA'
    }, '*');
  }

  // Fetch data for NFTs that don't have markers yet (for initial page load)
  function fetchInitialData() {
    const containers = document.querySelectorAll('.NftItemContainer');
    const pendingAddresses = new Set();

    containers.forEach(container => {
      const nftAddress = extractNftAddress(container);
      const info = nftAddress ? nftData[nftAddress] : null;

      if (!nftAddress) return;

      const hasMarker = Boolean(container.querySelector('.marketplace-marker'));
      const needsRefresh = !info || !info.fullPriceNano;

      if (!hasMarker || needsRefresh) {
        pendingAddresses.add(nftAddress);
      }
    });

    if (pendingAddresses.size > 0) {
      console.log('[Getgems Marker] Found', pendingAddresses.size, 'NFTs with incomplete marker data, requesting data...');

      window.postMessage({
        type: 'GETGEMS_MARKER_REQUEST_DATA',
        addresses: Array.from(pendingAddresses)
      }, '*');
    }
  }

  let debounceTimer;
  function debounce(func, delay) {
    return function() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(func, delay);
    };
  }

  function normalizeHistoryHash(hash) {
    return typeof hash === 'string' ? hash.trim().toLowerCase() : '';
  }

  function extractHistoryTransactionHash(row) {
    const txLink = row?.querySelector('a[href*="tonviewer.com/transaction/"]');
    const href = txLink?.getAttribute('href') || txLink?.href || '';
    const match = href.match(/\/transaction\/([0-9a-f]{64})/i);

    return match ? normalizeHistoryHash(match[1]) : null;
  }

  function isSaleHistoryRow(row) {
    return Boolean(row?.querySelector('.TransactionTypeView--sold'));
  }

  function getSaleHistoryMarkerHost(row) {
    return (
      row?.querySelector('.TypeCell .LibraryCellTitle .LibraryLineContainer') ||
      row?.querySelector('.TypeCell .LibraryLineContainer') ||
      null
    );
  }

  function createSaleHistoryMarkerContent(marketplace) {
    if (marketplace === 'getgems' || marketplace === 'fragment') {
      const logo = document.createElement('img');
      logo.className = 'marketplace-sale-marker__logo';
      logo.src = chrome.runtime.getURL(marketplace === 'getgems' ? 'getgems.svg' : 'fragment.svg');
      logo.alt = marketplace === 'getgems' ? 'G' : 'F';
      return logo;
    }

    const text = document.createElement('span');
    text.className = 'marketplace-sale-marker__text';
    text.textContent = '?';
    return text;
  }

  function getSaleHistoryMarkerTitle(info) {
    if (info?.marketplace === 'getgems') {
      if (info.saleType === 'offer') {
        return 'Sale via Getgems offer';
      }

      return info.offchain ? 'Sale via Getgems (offchain)' : 'Sale via Getgems';
    }

    if (info?.marketplace === 'fragment') {
      return 'Sale via Fragment';
    }

    return 'Sale marketplace is unknown';
  }

  function syncActivitySaleOfferBadge(markerHost, hash, info) {
    const existingBadge = markerHost.querySelector('.marketplace-sale-offer-badge');
    const shouldShow = info?.marketplace === 'getgems' && info?.saleType === 'offer';

    if (!shouldShow) {
      if (existingBadge) {
        existingBadge.remove();
      }
      return;
    }

    const badge = existingBadge || document.createElement('span');

    if (!existingBadge) {
      badge.className = 'marketplace-sale-offer-badge';
      markerHost.appendChild(badge);
    }

    if (badge.dataset.hash !== hash) {
      badge.dataset.hash = hash;
    }

    if (badge.textContent !== 'offer') {
      badge.textContent = 'offer';
    }

    const nextTitle = 'Getgems offer sale';
    if (badge.title !== nextTitle) {
      badge.title = nextTitle;
    }
  }

  function syncActivitySaleMarker(markerHost, hash, info) {
    const existingMarker = markerHost.querySelector('.marketplace-sale-marker');

    if (!info?.marketplace) {
      if (existingMarker && existingMarker.dataset.hash !== hash) {
        existingMarker.remove();
      }
      return;
    }

    const marker = existingMarker || document.createElement('span');
    const nextMarketplace = info.marketplace;

    if (!existingMarker) {
      marker.className = 'marketplace-sale-marker';
      markerHost.appendChild(marker);
    }

    if (marker.dataset.hash !== hash) {
      marker.dataset.hash = hash;
    }

    if (marker.dataset.marketplace !== nextMarketplace) {
      marker.dataset.marketplace = nextMarketplace;
      marker.className = `marketplace-sale-marker marketplace-sale-marker--${nextMarketplace}`;
      marker.replaceChildren(createSaleHistoryMarkerContent(nextMarketplace));
    }

    const nextTitle = getSaleHistoryMarkerTitle(info);
    if (marker.title !== nextTitle) {
      marker.title = nextTitle;
    }
  }

  function updateActivitySaleMarkers() {
    const rows = document.querySelectorAll('.TableRow');
    if (rows.length === 0) return;

    rows.forEach((row) => {
      if (!isSaleHistoryRow(row)) return;

      const hash = extractHistoryTransactionHash(row);
      const markerHost = getSaleHistoryMarkerHost(row);
      if (!hash || !markerHost) return;

      syncActivitySaleMarker(markerHost, hash, historySaleData[hash]);
      syncActivitySaleOfferBadge(markerHost, hash, historySaleData[hash]);
    });
  }

  function requestMissingActivityHistoryLookups() {
    if (historyLookupBatchInFlight) return;

    const rows = document.querySelectorAll('.TableRow');
    if (rows.length === 0) return;

    const pendingHashes = [];

    rows.forEach((row) => {
      if (!isSaleHistoryRow(row)) return;

      const hash = extractHistoryTransactionHash(row);
      if (!hash) return;

      if (historySaleData[hash]?.marketplace) {
        requestedHistoryLookupAt.delete(hash);
        return;
      }

      const lastRequestedAt = requestedHistoryLookupAt.get(hash) || 0;
      if (Date.now() - lastRequestedAt < 15000) {
        return;
      }

      requestedHistoryLookupAt.set(hash, Date.now());
      pendingHashes.push(hash);
    });

    if (pendingHashes.length > 0) {
      console.log('[Getgems Marker] Requesting history hash lookups for', pendingHashes.length, 'rows');
      historyLookupBatchInFlight = true;

      chrome.runtime.sendMessage({
        type: 'GETGEMS_MARKER_LOOKUP_HISTORY_MARKETPLACES',
        hashes: pendingHashes
      }, (response) => {
        historyLookupBatchInFlight = false;

        if (chrome.runtime.lastError) {
          console.error('[Getgems Marker] History lookup request failed:', chrome.runtime.lastError.message);
          return;
        }

        if (!response?.ok || !response.data) {
          console.error('[Getgems Marker] History lookup returned no data:', response?.error || 'unknown error');
          return;
        }

        historySaleData = {
          ...historySaleData,
          ...response.data
        };

        Object.keys(response.data).forEach((hash) => {
          if (response.data[hash]?.marketplace) {
            requestedHistoryLookupAt.delete(hash);
          }
        });

        updateActivitySaleMarkers();
      });
    }
  }

  // Extract NFT address from a card container
  function extractNftAddress(container) {
    // Method 1: modalNft= parameter in links (works on both collection and user pages)
    const modalLink = container.querySelector('a[href*="modalNft="]');
    if (modalLink) {
      const match = modalLink.getAttribute('href').match(/modalNft=([A-Za-z0-9_-]+)/);
      if (match) return match[1];
    }

    // Method 2: Direct link to /collection/ADDR/NFT_ADDR
    const collectionLink = container.querySelector('a[href*="/collection/"]');
    if (collectionLink) {
      const match = collectionLink.getAttribute('href').match(/\/collection\/[^/]+\/([A-Za-z0-9_-]+)/);
      if (match) return match[1];
    }

    return null;
  }

  function extractCurrentItemPageAddress() {
    const collectionPathMatch = window.location.pathname.match(/\/collection\/[^/]+\/([A-Za-z0-9_-]+)/);
    if (collectionPathMatch) {
      return collectionPathMatch[1];
    }

    const nftPathMatch = window.location.pathname.match(/\/nft\/([A-Za-z0-9_-]+)/);
    if (nftPathMatch) {
      return nftPathMatch[1];
    }

    return null;
  }

  function isStandaloneNftPage() {
    return (
      /\/nft\/[A-Za-z0-9_-]+/.test(window.location.pathname) ||
      /\/collection\/[^/]+\/[A-Za-z0-9_-]+/.test(window.location.pathname)
    );
  }

  function normalizeGiftSatelliteText(value) {
    if (typeof value !== 'string') return '';

    return value
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeGiftSatelliteLabel(value) {
    return normalizeGiftSatelliteText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function extractGiftCollectionNameFromNftName(value) {
    const normalized = normalizeGiftSatelliteText(value);
    if (!normalized) return '';

    const hashIndex = normalized.indexOf('#');
    const collectionName = hashIndex >= 0
      ? normalizeGiftSatelliteText(normalized.slice(0, hashIndex))
      : normalized;

    return isLikelyGiftSatelliteValue(collectionName) ? collectionName : '';
  }

  function isLikelyGiftSatelliteValue(value) {
    const normalized = normalizeGiftSatelliteText(value);

    if (!normalized || normalized.length > 80) return false;
    if (/^(?:eq|uq)[a-z0-9_-]{20,}$/i.test(normalized)) return false;
    if (/^[0-9]+(?:\.[0-9]+)?$/.test(normalized)) return false;
    if (/^(model|backdrop|background|symbol|pattern)$/i.test(normalized)) return false;

    return true;
  }

  function resolveGiftSatelliteFieldKey(label) {
    const normalized = normalizeGiftSatelliteLabel(label);
    if (!normalized) return null;

    if (normalized === 'model' || normalized.startsWith('model ')) {
      return 'modelName';
    }

    if (
      normalized === 'backdrop' ||
      normalized === 'background' ||
      normalized.startsWith('backdrop ') ||
      normalized.startsWith('background ')
    ) {
      return 'backdropName';
    }

    if (
      normalized === 'symbol' ||
      normalized === 'pattern' ||
      normalized.startsWith('symbol ') ||
      normalized.startsWith('pattern ')
    ) {
      return 'symbolName';
    }

    return null;
  }

  function setGiftSatelliteContextValue(target, key, value) {
    if (!key || target[key]) return;
    if (!isLikelyGiftSatelliteValue(value)) return;

    target[key] = normalizeGiftSatelliteText(value);
  }

  function extractGiftSatelliteContextFromObject(root) {
    if (!root || typeof root !== 'object') return {};

    const context = {};
    const visited = new WeakSet();

    setGiftSatelliteContextValue(context, 'collectionName', extractGiftCollectionNameFromNftName(root.name));

    function walk(node, depth = 0) {
      if (!node || depth > 8) return;

      if (Array.isArray(node)) {
        node.forEach(child => walk(child, depth + 1));
        return;
      }

      if (typeof node !== 'object') return;
      if (visited.has(node)) return;
      visited.add(node);

      if ((node.__typename === 'NftItem' || node.address) && typeof node.name === 'string') {
        setGiftSatelliteContextValue(context, 'collectionName', extractGiftCollectionNameFromNftName(node.name));
      }

      setGiftSatelliteContextValue(context, 'collectionName', node.collectionName);
      if (node.collection && typeof node.collection === 'object') {
        setGiftSatelliteContextValue(context, 'collectionName', node.collection.name);
      }
      if (node.nftCollection && typeof node.nftCollection === 'object') {
        setGiftSatelliteContextValue(context, 'collectionName', node.nftCollection.name);
      }

      const labelCandidates = [
        node.traitType,
        node.trait_type,
        node.label,
        node.key,
        node.title,
        node.name,
        node.type
      ];
      const valueCandidates = [
        node.value,
        node.displayValue,
        node.traitValue,
        node.text,
        node.slug,
        node.content
      ];

      for (const label of labelCandidates) {
        const fieldKey = resolveGiftSatelliteFieldKey(label);
        if (!fieldKey) continue;

        for (const value of valueCandidates) {
          if (typeof value === 'string') {
            setGiftSatelliteContextValue(context, fieldKey, value);
            break;
          }
        }
      }

      Object.values(node).forEach(child => walk(child, depth + 1));
    }

    walk(root, 0);

    return context;
  }

  function findNftItemInObject(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;

    if (obj.address && obj.__typename === 'NftItem') {
      return obj;
    }

    if (obj.nftItemByAddress && typeof obj.nftItemByAddress === 'object') {
      return obj.nftItemByAddress;
    }

    if (obj.nftItem && typeof obj.nftItem === 'object') {
      return obj.nftItem;
    }

    if (obj.item && obj.item.address) {
      return obj.item;
    }

    for (const key of Object.keys(obj)) {
      const found = findNftItemInObject(obj[key], depth + 1);
      if (found) return found;
    }

    return null;
  }

  function extractGiftSatelliteContextFromNextData() {
    const nextDataScript = document.getElementById('__NEXT_DATA__');
    if (!nextDataScript?.textContent) return {};

    try {
      const nextData = JSON.parse(nextDataScript.textContent);
      const pageProps = nextData?.props?.pageProps || {};
      const nftItem = findNftItemInObject(pageProps);

      return extractGiftSatelliteContextFromObject(nftItem || pageProps);
    } catch (error) {
      console.warn('[Getgems Marker] Could not parse __NEXT_DATA__ for Gift Satellite context:', error);
      return {};
    }
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.hidden) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    return true;
  }

  function findVisibleTextInNode(node, excludedValues = new Set()) {
    if (!node) return null;

    const candidates = [];

    if (node instanceof HTMLElement && isElementVisible(node)) {
      const directText = normalizeGiftSatelliteText(node.textContent || '');
      if (directText && !excludedValues.has(directText)) {
        candidates.push(directText);
      }

      const textElements = node.querySelectorAll('a, button, span, div, p, dt, dd, li');
      textElements.forEach((element) => {
        if (!isElementVisible(element)) return;

        const text = normalizeGiftSatelliteText(element.textContent || '');
        if (!text || excludedValues.has(text)) return;
        candidates.push(text);
      });
    }

    return candidates.find(isLikelyGiftSatelliteValue) || null;
  }

  function extractValueNearLabel(labelTexts) {
    const normalizedLabels = new Set(
      labelTexts
        .map(resolveGiftSatelliteFieldKey)
        .filter(Boolean)
    );
    const normalizedRawLabels = new Set(labelTexts.map(text => normalizeGiftSatelliteLabel(text)).filter(Boolean));
    const rawLabels = new Set(labelTexts.map(text => normalizeGiftSatelliteText(text)).filter(Boolean));
    const allLabels = new Set([...normalizedLabels, ...normalizedRawLabels, ...rawLabels]);

    const elements = document.querySelectorAll('div, span, dt, dd, button, p, a, li');

    for (const element of elements) {
      if (!isElementVisible(element)) continue;

      const text = normalizeGiftSatelliteText(element.textContent || '');
      if (!text) continue;

      const normalizedText = normalizeGiftSatelliteLabel(text);
      if (!allLabels.has(text) && !allLabels.has(normalizedText)) continue;

      const excludedValues = new Set([text]);
      if (element.nextElementSibling) {
        const nextText = findVisibleTextInNode(element.nextElementSibling, excludedValues);
        if (nextText) return nextText;
      }

      if (element.parentElement) {
        const siblingElements = Array.from(element.parentElement.children).filter(child => child !== element);
        for (const sibling of siblingElements) {
          const siblingText = findVisibleTextInNode(sibling, excludedValues);
          if (siblingText) return siblingText;
        }
      }

      const container = element.closest('li, div, section, article, tr, dl');
      const containerText = findVisibleTextInNode(container, excludedValues);
      if (containerText) return containerText;
    }

    return null;
  }

  function extractCollectionNameFromDom() {
    const headingCandidates = [];
    const titleCollectionName = extractGiftCollectionNameFromNftName(document.title);
    if (titleCollectionName) {
      headingCandidates.push(titleCollectionName);
    }

    const headingElements = document.querySelectorAll('h1, [role="heading"]');
    for (const element of headingElements) {
      if (!(element instanceof HTMLElement) || !isElementVisible(element)) continue;

      const collectionName = extractGiftCollectionNameFromNftName(element.textContent || '');
      if (collectionName) {
        headingCandidates.push(collectionName);
      }
    }

    if (headingCandidates.length > 0) {
      return headingCandidates[0];
    }

    const collectionLinks = document.querySelectorAll('a[href*="/collection/"]');

    for (const link of collectionLinks) {
      if (!(link instanceof HTMLElement) || !isElementVisible(link)) continue;

      const text = normalizeGiftSatelliteText(link.textContent || '');
      if (!isLikelyGiftSatelliteValue(text)) continue;
      if (text.includes('#')) continue;

      return text;
    }

    return null;
  }

  function extractGiftSatelliteContextFromDom() {
    const context = {};

    setGiftSatelliteContextValue(context, 'collectionName', extractCollectionNameFromDom());
    setGiftSatelliteContextValue(context, 'modelName', extractValueNearLabel(['Model']));
    setGiftSatelliteContextValue(context, 'backdropName', extractValueNearLabel(['Backdrop', 'Background']));
    setGiftSatelliteContextValue(context, 'symbolName', extractValueNearLabel(['Symbol', 'Pattern']));

    return context;
  }

  function mergeGiftSatelliteContexts(...contexts) {
    const merged = {};

    contexts.forEach((context) => {
      if (!context || typeof context !== 'object') return;

      ['collectionName', 'modelName', 'backdropName', 'symbolName'].forEach((key) => {
        setGiftSatelliteContextValue(merged, key, context[key]);
      });
    });

    return merged;
  }

  function getGiftSatelliteContext() {
    const nftAddress = extractCurrentItemPageAddress();
    const info = nftAddress ? nftData[nftAddress] || {} : {};

    return {
      nftAddress: nftAddress || '',
      ...mergeGiftSatelliteContexts(
        {
          collectionName: info.collectionName,
          modelName: info.giftModelName,
          backdropName: info.giftBackdropName,
          symbolName: info.giftSymbolName
        },
        extractGiftSatelliteContextFromNextData(),
        extractGiftSatelliteContextFromDom()
      )
    };
  }

  function buildGiftSatelliteFilter(context) {
    const parts = [
      normalizeGiftSatelliteText(context.collectionName),
      normalizeGiftSatelliteText(context.modelName),
      normalizeGiftSatelliteText(context.backdropName),
      normalizeGiftSatelliteText(context.symbolName)
    ];

    while (parts.length > 0 && !parts[parts.length - 1]) {
      parts.pop();
    }

    return parts.filter(Boolean).join(':');
  }

  function buildGiftSatelliteEmbedUrl(context) {
    const params = new URLSearchParams();
    const filter = buildGiftSatelliteFilter(context);

    if (context.collectionName) params.set('collection', context.collectionName);
    if (context.modelName) params.set('model', context.modelName);
    if (context.backdropName) params.set('backdrop', context.backdropName);
    if (context.symbolName) params.set('symbol', context.symbolName);
    if (context.nftAddress) params.set('nftAddress', context.nftAddress);
    if (filter) params.set('filter', filter);

    const query = params.toString();
    return chrome.runtime.getURL(query ? `gift-satellite-embed.html?${query}` : 'gift-satellite-embed.html');
  }

  function ensureGiftSatelliteLauncherHost(actionsCard) {
    let host = actionsCard.querySelector('.getgems-marker-item-tools');
    if (!host) {
      host = document.createElement('div');
      host.className = 'getgems-marker-item-tools';
    }

    const anchor = actionsCard.querySelector(
      '.marketplace-marker-item-container, .NftPageActionsCard__list, .NftPageActions'
    );
    if (anchor) {
      if (host.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement('afterend', host);
      }
    } else if (!actionsCard.contains(host)) {
      actionsCard.insertBefore(host, actionsCard.firstChild);
    }

    return host;
  }

  function removeGiftSatelliteLauncher() {
    document.querySelectorAll('.getgems-marker-item-tools').forEach((node) => node.remove());
  }

  function closeGiftSatelliteOverlay() {
    if (!giftSatelliteOverlay) return;

    document.removeEventListener('keydown', handleGiftSatelliteOverlayKeydown, true);
    giftSatelliteOverlay.remove();
    giftSatelliteOverlay = null;

    if (giftSatelliteScrollLock) {
      document.documentElement.style.overflow = giftSatelliteScrollLock.htmlOverflow;
      document.body.style.overflow = giftSatelliteScrollLock.bodyOverflow;
      giftSatelliteScrollLock = null;
    }
  }

  function handleGiftSatelliteOverlayKeydown(event) {
    if (event.key === 'Escape') {
      closeGiftSatelliteOverlay();
    }
  }

  function handleGiftSatelliteEmbedMessage(event) {
    if (!giftSatelliteOverlay || !event?.data) return;

    const expectedOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
    const frame = giftSatelliteOverlay.querySelector('.getgems-marker-gift-satellite-overlay__frame');

    if (event.data.type !== 'GETGEMS_MARKER_CLOSE_GIFT_SATELLITE') return;
    if (event.origin !== expectedOrigin) return;
    if (event.source !== frame?.contentWindow) return;

    closeGiftSatelliteOverlay();
  }

  function openGiftSatelliteOverlay() {
    const context = getGiftSatelliteContext();

    closeGiftSatelliteOverlay();

    giftSatelliteScrollLock = {
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow
    };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    const overlay = document.createElement('div');
    overlay.className = 'getgems-marker-gift-satellite-overlay';

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'getgems-marker-gift-satellite-overlay__backdrop';
    backdrop.setAttribute('aria-label', 'Close Check other markets');
    backdrop.addEventListener('click', closeGiftSatelliteOverlay);

    const panel = document.createElement('div');
    panel.className = 'getgems-marker-gift-satellite-overlay__panel';

    const frame = document.createElement('iframe');
    frame.className = 'getgems-marker-gift-satellite-overlay__frame';
    frame.src = buildGiftSatelliteEmbedUrl(context);
    frame.title = 'Gift Satellite';
    frame.loading = 'eager';

    panel.appendChild(frame);
    overlay.appendChild(backdrop);
    overlay.appendChild(panel);

    document.documentElement.appendChild(overlay);
    document.addEventListener('keydown', handleGiftSatelliteOverlayKeydown, true);

    giftSatelliteOverlay = overlay;
  }

  function updateGiftSatelliteLauncher() {
    if (!isStandaloneNftPage()) {
      removeGiftSatelliteLauncher();
      closeGiftSatelliteOverlay();
      return;
    }

    const actionsCard = document.querySelector('.NftPageActionsCard__info') || document.querySelector('.NftPageActionsCard');
    if (!actionsCard) return;

    const host = ensureGiftSatelliteLauncherHost(actionsCard);
    let button = host.querySelector('.getgems-marker-gift-satellite-button');

    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'getgems-marker-gift-satellite-button';
      button.textContent = 'Check other markets';
      button.addEventListener('click', openGiftSatelliteOverlay);
      host.appendChild(button);
    }

    const context = getGiftSatelliteContext();
    const isReady = Boolean(context.collectionName && context.modelName);

    button.dataset.context = isReady ? 'ready' : 'partial';
    button.title = isReady
      ? `Gift Satellite prefill: ${context.collectionName} / ${context.modelName}`
      : 'Open Gift Satellite. If the model is not detected automatically, the page will still open.';
  }

  function hasOneNanoTonTail(info) {
    return Boolean(info?.hasOneNanoTonTail && info?.fullPriceTon);
  }

  function getExactPriceTitle(info) {
    if (!info?.fullPriceTon || !info?.fullPriceNano) return '';

    return `Exact API price: ${info.fullPriceTon} TON (${info.fullPriceNano} nanoTON)`;
  }

  function createMarketplaceFloorState(pageKey) {
    return {
      pageKey,
      trackedAddresses: new Set()
    };
  }

  function getMarketplaceFloorPageKey() {
    const url = new URL(window.location.href);
    url.searchParams.delete('modalNft');

    const search = url.searchParams.toString();
    return `${url.pathname}${search ? `?${search}` : ''}`;
  }

  function ensureMarketplaceFloorState() {
    const pageKey = getMarketplaceFloorPageKey();

    if (!marketplaceFloorState || marketplaceFloorState.pageKey !== pageKey) {
      marketplaceFloorState = createMarketplaceFloorState(pageKey);
    }

    return marketplaceFloorState;
  }

  function trackCurrentPageListingAddresses(state) {
    let foundCards = false;
    const containers = document.querySelectorAll('.NftItemContainer');

    containers.forEach(container => {
      const nftAddress = extractNftAddress(container);
      if (!nftAddress) return;

      state.trackedAddresses.add(nftAddress);
      foundCards = true;
    });

    if (foundCards) return;

    const currentItemAddress = extractCurrentItemPageAddress();
    if (currentItemAddress) {
      state.trackedAddresses.add(currentItemAddress);
    }
  }

  function collectCurrentPageListings() {
    const state = ensureMarketplaceFloorState();
    trackCurrentPageListingAddresses(state);

    const listings = [];
    state.trackedAddresses.forEach(nftAddress => {
      const info = nftData[nftAddress];

      if (!info?.fullPriceNano || !info?.fullPriceTon) return;
      if (info.kind === 'OffchainNft') return;
      if (info.marketplace !== 'getgems' && info.marketplace !== 'fragment') return;

      listings.push({
        address: nftAddress,
        ...info
      });
    });

    return listings;
  }

  function computeMarketplaceFloors(listings) {
    const floors = {
      getgems: null,
      fragment: null,
      mine: null
    };

    function updateFloor(key, listing, priceNano) {
      const currentFloor = floors[key];

      if (!currentFloor || priceNano < currentFloor.priceNano) {
        floors[key] = {
          priceNano: priceNano,
          priceTon: listing.fullPriceTon,
          name: listing.name || null,
          marketplace: listing.marketplace || null
        };
      }
    }

    listings.forEach(listing => {
      const priceNano = BigInt(listing.fullPriceNano);

      if (listing.marketplace === 'getgems' || listing.marketplace === 'fragment') {
        updateFloor(listing.marketplace, listing, priceNano);
      }

      if (currentUserId && listing.ownerId && listing.ownerId === currentUserId) {
        updateFloor('mine', listing, priceNano);
      }
    });

    return floors;
  }

  function getMarketplaceSummaryAnchor() {
    return (
      document.querySelector('.EntityPageInfoCard') ||
      document.querySelector('.NftPageActionsCard') ||
      document.querySelector('.CollectionPage > *') ||
      document.querySelector('.NftItemContainer')?.parentElement ||
      null
    );
  }

  function ensureMarketplaceFloorSummary() {
    const anchor = getMarketplaceSummaryAnchor();
    if (!anchor) return null;

    let panel = document.querySelector('.marketplace-floor-summary');
    if (!panel) {
      panel = document.createElement('section');
      panel.className = 'marketplace-floor-summary';
      const title = document.createElement('div');
      title.className = 'marketplace-floor-summary__title';
      title.textContent = 'Listing floors';

      const subtitle = document.createElement('div');
      subtitle.className = 'marketplace-floor-summary__subtitle';

      const rows = document.createElement('div');
      rows.className = 'marketplace-floor-summary__rows';
      rows.appendChild(createMarketplaceFloorRow('getgems'));
      rows.appendChild(createMarketplaceFloorRow('fragment'));
      rows.appendChild(createMarketplaceFloorRow('mine'));

      panel.appendChild(title);
      panel.appendChild(subtitle);
      panel.appendChild(rows);
    }

    if (panel.previousElementSibling !== anchor) {
      anchor.insertAdjacentElement('afterend', panel);
    }

    return panel;
  }

  function createMarketplaceFloorRow(marketplace) {
    const row = document.createElement('div');
    row.className = 'marketplace-floor-summary__row';
    row.dataset.marketplace = marketplace;

    const badge = document.createElement('div');
    badge.className = `marketplace-floor-summary__badge marketplace-floor-summary__badge--${marketplace}`;

    if (marketplace === 'mine') {
      const badgeText = document.createElement('span');
      badgeText.className = 'marketplace-floor-summary__badge-text';
      badgeText.textContent = 'MY';
      badge.appendChild(badgeText);
    } else {
      const logo = document.createElement('img');
      logo.className = 'marketplace-floor-summary__logo';
      logo.src = chrome.runtime.getURL(marketplace === 'getgems' ? 'getgems.svg' : 'fragment.svg');
      logo.alt = marketplace === 'getgems' ? 'G' : 'F';
      badge.appendChild(logo);
    }

    const labelGroup = document.createElement('div');
    labelGroup.className = 'marketplace-floor-summary__copy';

    const label = document.createElement('div');
    label.className = 'marketplace-floor-summary__label';
    label.textContent =
      marketplace === 'getgems'
        ? 'Getgems floor'
        : marketplace === 'fragment'
          ? 'Fragment floor'
          : 'My floor';

    const value = document.createElement('div');
    value.className = 'marketplace-floor-summary__value';
    value.textContent = '-';

    labelGroup.appendChild(label);
    labelGroup.appendChild(value);

    row.appendChild(badge);
    row.appendChild(labelGroup);

    return row;
  }

  function updateMarketplaceFloorRow(panel, marketplace, floorInfo) {
    const row = panel.querySelector(`.marketplace-floor-summary__row[data-marketplace="${marketplace}"]`);
    const value = row?.querySelector('.marketplace-floor-summary__value');
    if (!value) return;

    const nextText = floorInfo ? `${floorInfo.priceTon} TON` : '-';
    if (value.textContent !== nextText) {
      value.textContent = nextText;
    }

    const marketplaceLabel =
      floorInfo?.marketplace === 'getgems'
        ? 'Getgems'
        : floorInfo?.marketplace === 'fragment'
          ? 'Fragment'
          : '';
    const nextTitle = floorInfo?.name
      ? `${floorInfo.name} | ${floorInfo.priceTon} TON${marketplaceLabel ? ` | ${marketplaceLabel}` : ''}`
      : '';
    if (value.title !== nextTitle) {
      value.title = nextTitle;
    }
  }

  function updateMarketplaceFloorSummary() {
    const listings = collectCurrentPageListings();
    const hasListings = listings.length > 0;
    const existingPanel = document.querySelector('.marketplace-floor-summary');

    if (!hasListings) {
      if (existingPanel) {
        existingPanel.remove();
      }
      return;
    }

    const floors = computeMarketplaceFloors(listings);
    const panel = ensureMarketplaceFloorSummary();
    if (!panel) return;

    const subtitle = panel.querySelector('.marketplace-floor-summary__subtitle');
    const nextSubtitle = `Observed listings: ${listings.length}`;
    if (subtitle && subtitle.textContent !== nextSubtitle) {
      subtitle.textContent = nextSubtitle;
    }

    updateMarketplaceFloorRow(panel, 'getgems', floors.getgems);
    updateMarketplaceFloorRow(panel, 'fragment', floors.fragment);
    updateMarketplaceFloorRow(panel, 'mine', floors.mine);
  }

  function ensureCardControlsContainer(container) {
    const selectIconContainer = container.querySelector('[class*="AbsoluteControl--position-top-left"]');

    if (selectIconContainer) {
      selectIconContainer.style.display = 'flex';
      selectIconContainer.style.alignItems = 'flex-start';
      selectIconContainer.style.gap = '4px';
      return selectIconContainer;
    }

    const overlayInner = container.querySelector('[class*="NftItemContainer__overlay-inner"]');
    if (overlayInner) {
      const topLeftContainer = document.createElement('div');
      topLeftContainer.className = 'AbsoluteControl AbsoluteControl--position-top-left AbsoluteControl--spacing-6px';
      topLeftContainer.style.display = 'flex';
      topLeftContainer.style.alignItems = 'flex-start';
      topLeftContainer.style.gap = '4px';
      overlayInner.insertBefore(topLeftContainer, overlayInner.firstChild);
      return topLeftContainer;
    }

    container.style.position = 'relative';
    return container;
  }

  function updateExactPriceDisplay(root, info) {
    const priceElement = root.querySelector('.LibraryCryptoPrice');
    const amountElement = priceElement?.querySelector('.LibraryCryptoPrice__amount');
    if (!priceElement || !amountElement) return;

    const shouldHighlight = hasOneNanoTonTail(info);

    if (shouldHighlight) {
      amountElement.textContent = info.fullPriceTon;
      priceElement.title = getExactPriceTitle(info);
    }

    priceElement.classList.toggle('one-nano-ton-tail-price', shouldHighlight);
    if (shouldHighlight) {
      priceElement.setAttribute('data-getgems-exact-price', info.fullPriceTon);
    } else {
      if (priceElement.hasAttribute('data-getgems-exact-price')) {
        priceElement.title = amountElement.textContent.trim();
      }
      priceElement.removeAttribute('data-getgems-exact-price');
    }
  }

  function syncSpecialPriceMarker(container, info) {
    const existingMarker = container.querySelector('.one-nano-ton-tail-marker');
    const shouldShow = hasOneNanoTonTail(info);

    if (!shouldShow) {
      if (existingMarker) {
        existingMarker.remove();
      }
      return;
    }

    const marker = existingMarker || document.createElement('div');
    marker.className = 'one-nano-ton-tail-marker';
    marker.textContent = '+1n';
    marker.title = getExactPriceTitle(info);

    if (!existingMarker) {
      ensureCardControlsContainer(container).appendChild(marker);
    }
  }

  // Update markers on collection listing and user pages
  function updateMarkers() {
    const dataCount = Object.keys(nftData).length;
    if (dataCount === 0) return;

    const containers = document.querySelectorAll('.NftItemContainer');
    if (containers.length === 0) return;

    let marked = 0;

    containers.forEach(container => {
      const nftAddress = extractNftAddress(container);
      if (!nftAddress) return;

      const info = nftData[nftAddress];
      if (!info) return;

      const isOwn = currentUserId && info.ownerId && info.ownerId === currentUserId;

      container.classList.toggle('own-nft-item', Boolean(isOwn));
      updateExactPriceDisplay(container, info);
      syncSpecialPriceMarker(container, info);

      if (container.querySelector('.marketplace-marker')) return;

      addMarkerToCard(container, info.marketplace);
      marked++;
    });

    if (marked > 0) {
      console.log('[Getgems Marker] Added', marked, 'markers to cards');
    }
  }

  // Update marker on individual NFT item page
  function updateItemPageMarker() {
    const dataCount = Object.keys(nftData).length;
    if (dataCount === 0) return;

    // Check if we're on an item page (either /collection/ADDRESS/ITEM or /nft/ADDRESS)
    const nftAddress = extractCurrentItemPageAddress();

    if (!nftAddress) return;
    const info = nftData[nftAddress];

    if (!info) return;

    // Find the actions card on the item page
    const actionsCard = document.querySelector('.NftPageActionsCard__info') || document.querySelector('.NftPageActionsCard');
    if (!actionsCard) return;

    updateExactPriceDisplay(actionsCard, info);

    // Check if already marked
    if (actionsCard.querySelector('.marketplace-marker-item')) return;

    console.log('[Getgems Marker] Adding marker to item page for:', info.name || nftAddress);
    addMarkerToItemPage(actionsCard, info.marketplace);
  }

  function addMarkerToCard(container, marketplace) {
    const marker = document.createElement('div');
    marker.className = 'marketplace-marker';

    const logo = document.createElement('img');
    logo.className = 'marketplace-marker-logo';

    if (marketplace === 'getgems') {
      marker.classList.add('marker-getgems');
      logo.src = chrome.runtime.getURL('getgems.svg');
      logo.alt = 'G';
      marker.title = 'Listed on Getgems (0.3 TON fee)';
    } else {
      marker.classList.add('marker-fragment');
      logo.src = chrome.runtime.getURL('fragment.svg');
      logo.alt = 'F';
      marker.title = 'Listed on Fragment (no fee)';
    }

    marker.appendChild(logo);
    ensureCardControlsContainer(container).appendChild(marker);
  }

  function addMarkerToItemPage(actionsCard, marketplace) {
    const markerContainer = document.createElement('div');
    markerContainer.className = 'marketplace-marker-item-container';

    const marker = document.createElement('div');
    marker.className = 'marketplace-marker-item';

    const logo = document.createElement('img');
    logo.className = 'marketplace-marker-logo';

    const label = document.createElement('span');
    label.className = 'marketplace-marker-item-label';

    if (marketplace === 'getgems') {
      marker.classList.add('marker-getgems');
      logo.src = chrome.runtime.getURL('getgems.svg');
      logo.alt = 'G';
      label.textContent = 'Listed on Getgems';
      markerContainer.title = 'This NFT is listed on Getgems marketplace (0.3 TON fee)';
    } else {
      marker.classList.add('marker-fragment');
      logo.src = chrome.runtime.getURL('fragment.svg');
      logo.alt = 'F';
      label.textContent = 'Listed on Fragment';
      markerContainer.title = 'This NFT is listed on Fragment marketplace (no fee)';
    }

    marker.appendChild(logo);

    markerContainer.appendChild(marker);
    markerContainer.appendChild(label);

    // Insert at the beginning of the actions card info
    actionsCard.insertBefore(markerContainer, actionsCard.firstChild);
  }

  console.log('[Getgems Marker] Script loaded');
})();
