// Content script for Getgems Marketplace Marker
(function() {
  'use strict';

  console.log('[Getgems Marker] Content script starting...');

  // Store NFT data received from injected script
  let nftData = {};

  // Store current user ID
  let currentUserId = null;

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
      updateMarketplaceFloorSummary();
    }
  });

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
      updateMarketplaceFloorSummary();
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
      updateMarketplaceFloorSummary();
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

  function hasOneNanoTonTail(info) {
    return Boolean(info?.hasOneNanoTonTail && info?.fullPriceTon);
  }

  function getExactPriceTitle(info) {
    if (!info?.fullPriceTon || !info?.fullPriceNano) return '';

    return `Exact API price: ${info.fullPriceTon} TON (${info.fullPriceNano} nanoTON)`;
  }

  function collectCurrentPageListings() {
    const listings = [];
    const seen = new Set();
    const containers = document.querySelectorAll('.NftItemContainer');

    containers.forEach(container => {
      const nftAddress = extractNftAddress(container);
      if (!nftAddress || seen.has(nftAddress)) return;

      seen.add(nftAddress);
      const info = nftData[nftAddress];

      if (!info?.fullPriceNano || !info?.fullPriceTon) return;
      if (info.kind === 'OffchainNft') return;
      if (info.marketplace !== 'getgems' && info.marketplace !== 'fragment') return;

      listings.push({
        address: nftAddress,
        ...info
      });
    });

    if (listings.length > 0) {
      return listings;
    }

    const currentItemAddress = extractCurrentItemPageAddress();
    if (!currentItemAddress) return listings;

    const currentItemInfo = nftData[currentItemAddress];
    if (!currentItemInfo?.fullPriceNano || !currentItemInfo?.fullPriceTon) return listings;
    if (currentItemInfo.kind === 'OffchainNft') return listings;
    if (currentItemInfo.marketplace !== 'getgems' && currentItemInfo.marketplace !== 'fragment') return listings;

    return [{
      address: currentItemAddress,
      ...currentItemInfo
    }];
  }

  function computeMarketplaceFloors(listings) {
    const floors = {
      getgems: null,
      fragment: null
    };

    listings.forEach(listing => {
      const priceNano = BigInt(listing.fullPriceNano);
      const currentFloor = floors[listing.marketplace];

      if (!currentFloor || priceNano < currentFloor.priceNano) {
        floors[listing.marketplace] = {
          priceNano: priceNano,
          priceTon: listing.fullPriceTon,
          name: listing.name || null
        };
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
    }

    if (panel.previousElementSibling !== anchor) {
      anchor.insertAdjacentElement('afterend', panel);
    }

    return panel;
  }

  function createMarketplaceFloorRow(marketplace, floorInfo) {
    const row = document.createElement('div');
    row.className = 'marketplace-floor-summary__row';

    const badge = document.createElement('div');
    badge.className = `marketplace-floor-summary__badge marketplace-floor-summary__badge--${marketplace}`;

    const logo = document.createElement('img');
    logo.className = 'marketplace-floor-summary__logo';
    logo.src = chrome.runtime.getURL(marketplace === 'getgems' ? 'getgems.svg' : 'fragment.svg');
    logo.alt = marketplace === 'getgems' ? 'G' : 'F';
    badge.appendChild(logo);

    const labelGroup = document.createElement('div');
    labelGroup.className = 'marketplace-floor-summary__copy';

    const label = document.createElement('div');
    label.className = 'marketplace-floor-summary__label';
    label.textContent = marketplace === 'getgems' ? 'Getgems floor' : 'Fragment floor';

    const value = document.createElement('div');
    value.className = 'marketplace-floor-summary__value';
    value.textContent = floorInfo ? `${floorInfo.priceTon} TON` : '-';

    if (floorInfo?.name) {
      value.title = `${floorInfo.name} | ${floorInfo.priceTon} TON`;
    }

    labelGroup.appendChild(label);
    labelGroup.appendChild(value);

    row.appendChild(badge);
    row.appendChild(labelGroup);

    return row;
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

    panel.replaceChildren();

    const title = document.createElement('div');
    title.className = 'marketplace-floor-summary__title';
    title.textContent = 'Listing floors';

    const subtitle = document.createElement('div');
    subtitle.className = 'marketplace-floor-summary__subtitle';
    subtitle.textContent = `Observed listings: ${listings.length}`;

    const rows = document.createElement('div');
    rows.className = 'marketplace-floor-summary__rows';
    rows.appendChild(createMarketplaceFloorRow('getgems', floors.getgems));
    rows.appendChild(createMarketplaceFloorRow('fragment', floors.fragment));

    panel.appendChild(title);
    panel.appendChild(subtitle);
    panel.appendChild(rows);
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
    const actionsCard = document.querySelector('.NftPageActionsCard__info');
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
