// Content script for Getgems Marketplace Marker
(function() {
  'use strict';

  console.log('[Getgems Marker] Content script starting...');

  // Store NFT data received from injected script
  let nftData = {};

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
    if (event.data?.type === 'GETGEMS_MARKER_NFT_DATA') {
      console.log('[Getgems Marker] Received NFT data via postMessage:', Object.keys(event.data.data).length, 'items');
      nftData = event.data.data;
      updateMarkers();
      updateItemPageMarker();
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

    // Observe DOM changes for dynamically loaded content
    const observer = new MutationObserver(() => {
      debounce(updateMarkers, 300)();
      debounce(updateItemPageMarker, 300)();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Periodic update
    setInterval(updateMarkers, 2000);
    setInterval(updateItemPageMarker, 2000);

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
    
    // Only fetch if we don't have data for this NFT yet
    if (nftData[nftAddress]) return;
    
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
    const unmarkedAddresses = [];

    containers.forEach(container => {
      if (container.querySelector('.marketplace-marker')) return;

      const nftAddress = extractNftAddress(container);
      if (nftAddress && !nftData[nftAddress]) {
        unmarkedAddresses.push(nftAddress);
      }
    });

    if (unmarkedAddresses.length > 0) {
      console.log('[Getgems Marker] Found', unmarkedAddresses.length, 'unmarked NFTs, requesting data...');

      window.postMessage({
        type: 'GETGEMS_MARKER_REQUEST_DATA',
        addresses: unmarkedAddresses
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

  // Update markers on collection listing and user pages
  function updateMarkers() {
    const dataCount = Object.keys(nftData).length;
    if (dataCount === 0) return;

    const containers = document.querySelectorAll('.NftItemContainer');
    if (containers.length === 0) return;

    let marked = 0;

    containers.forEach(container => {
      if (container.querySelector('.marketplace-marker')) return;

      const nftAddress = extractNftAddress(container);
      if (!nftAddress) return;

      const info = nftData[nftAddress];

      if (info) {
        addMarkerToCard(container, info.marketplace);
        marked++;
      }
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
    let nftAddress = null;
    const collectionPathMatch = window.location.pathname.match(/\/collection\/[^/]+\/([A-Za-z0-9_-]+)/);
    const nftPathMatch = window.location.pathname.match(/\/nft\/([A-Za-z0-9_-]+)/);
    
    if (collectionPathMatch) {
      nftAddress = collectionPathMatch[1];
    } else if (nftPathMatch) {
      nftAddress = nftPathMatch[1];
    }
    
    if (!nftAddress) return;
    const info = nftData[nftAddress];

    if (!info) return;

    // Find the actions card on the item page
    const actionsCard = document.querySelector('.NftPageActionsCard__info');
    if (!actionsCard) return;

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

    const selectIconContainer = container.querySelector('[class*="AbsoluteControl--position-top-left"]');

    if (selectIconContainer) {
      selectIconContainer.style.display = 'flex';
      selectIconContainer.style.alignItems = 'flex-start';
      selectIconContainer.style.gap = '4px';
      selectIconContainer.appendChild(marker);
    } else {
      // No top-left container (e.g. user pages) - create one in the overlay-inner
      const overlayInner = container.querySelector('[class*="NftItemContainer__overlay-inner"]');
      if (overlayInner) {
        const topLeftContainer = document.createElement('div');
        topLeftContainer.className = 'AbsoluteControl AbsoluteControl--position-top-left AbsoluteControl--spacing-6px';
        topLeftContainer.style.display = 'flex';
        topLeftContainer.style.alignItems = 'flex-start';
        topLeftContainer.style.gap = '4px';
        topLeftContainer.appendChild(marker);
        overlayInner.insertBefore(topLeftContainer, overlayInner.firstChild);
      } else {
        container.style.position = 'relative';
        container.insertBefore(marker, container.firstChild);
      }
    }
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
