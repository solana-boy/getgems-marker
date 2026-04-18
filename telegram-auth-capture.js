// Captures fresh Gift Satellite Telegram Web auth payloads from Telegram WebApp iframe src.
(function() {
  'use strict';

  const STORAGE_KEY = 'gift_satellite_auth';
  const GIFT_SATELLITE_ORIGIN = 'https://gift-satellite.dev';
  const IFRAME_SELECTOR = [
    'iframe.payment-verification',
    'iframe[src^="https://gift-satellite.dev/#tgWebAppData="]',
    'iframe[src*="gift-satellite.dev/#tgWebAppData="]'
  ].join(', ');

  let lastCapturedHash = '';

  function storageLocalGet(defaults) {
    return new Promise((resolve) => {
      chrome.storage.local.get(defaults, (items) => {
        resolve(items || defaults);
      });
    });
  }

  function storageLocalSet(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items, () => resolve());
    });
  }

  function normalizeText(value) {
    if (typeof value !== 'string') return '';

    return value.trim();
  }

  function extractAuthRecord(src) {
    const normalizedSrc = normalizeText(src);
    if (!normalizedSrc) return null;

    try {
      const url = new URL(normalizedSrc, window.location.href);
      if (url.origin !== GIFT_SATELLITE_ORIGIN) return null;
      if (!url.hash || !url.hash.includes('tgWebAppData=')) return null;

      const hash = url.hash.replace(/^#/, '').trim();
      const params = new URLSearchParams(hash);
      const tgWebAppData = params.get('tgWebAppData') || '';
      const authDateMatch = tgWebAppData.match(/(?:^|&)auth_date=(\d+)/);

      return {
        hash: hash,
        authDate: authDateMatch ? Number(authDateMatch[1]) : null,
        capturedAt: Date.now(),
        source: 'telegram_web',
        sourceUrl: window.location.href
      };
    } catch (error) {
      return null;
    }
  }

  async function persistAuthRecord(record) {
    if (!record?.hash) return;
    if (record.hash === lastCapturedHash) return;

    const existingItems = await storageLocalGet({ [STORAGE_KEY]: null });
    const existingRecord = existingItems[STORAGE_KEY];

    if (existingRecord?.hash === record.hash) {
      lastCapturedHash = record.hash;
      return;
    }

    lastCapturedHash = record.hash;
    await storageLocalSet({
      [STORAGE_KEY]: record
    });
  }

  function captureFromIframe(iframe) {
    if (!(iframe instanceof HTMLIFrameElement)) return;

    const src = iframe.getAttribute('src') || iframe.src || '';
    const record = extractAuthRecord(src);
    if (!record) return;

    persistAuthRecord(record).catch(() => {});
  }

  function scanForGiftSatelliteIframe(root) {
    const scope = root instanceof Element || root instanceof Document ? root : document;

    if (scope instanceof Element && scope.matches(IFRAME_SELECTOR)) {
      captureFromIframe(scope);
    }

    scope.querySelectorAll?.(IFRAME_SELECTOR).forEach(captureFromIframe);
  }

  function handleMutations(mutations) {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes') {
        captureFromIframe(mutation.target);
        return;
      }

      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        scanForGiftSatelliteIframe(node);
      });
    });
  }

  function initObserver() {
    const observer = new MutationObserver(handleMutations);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
  }

  function init() {
    scanForGiftSatelliteIframe(document);
    initObserver();
    window.setInterval(() => {
      scanForGiftSatelliteIframe(document);
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
