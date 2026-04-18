(function() {
  'use strict';

  const REMOTE_URL = 'https://gift-satellite.dev/subscription/new';
  const TELEGRAM_AUTH_URL = 'https://web.telegram.org/k/#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3Dgift_satellite_bot%26appname%3Dsniper%26startapp%3D';
  const AUTH_STORAGE_KEY = 'gift_satellite_auth';
  const AUTH_STALE_HINT_MS = 15 * 60 * 1000;
  const CONTEXT_FIELDS = [
    ['collection', 'Collection'],
    ['model', 'Model'],
    ['backdrop', 'Backdrop'],
    ['symbol', 'Symbol']
  ];
  const state = {
    context: null,
    auth: null,
    remoteUrl: '',
    loadTimeoutId: null,
    pendingAuthRefresh: false
  };

  function normalizeText(value) {
    if (typeof value !== 'string') return '';

    return value
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getContext() {
    const params = new URLSearchParams(window.location.search);
    const context = {
      collection: normalizeText(params.get('collection')),
      model: normalizeText(params.get('model')),
      backdrop: normalizeText(params.get('backdrop')),
      symbol: normalizeText(params.get('symbol')),
      nftAddress: normalizeText(params.get('nftAddress')),
      filter: normalizeText(params.get('filter'))
    };

    if (!context.filter) {
      const parts = [
        context.collection,
        context.model,
        context.backdrop,
        context.symbol
      ];

      while (parts.length > 0 && !parts[parts.length - 1]) {
        parts.pop();
      }

      context.filter = parts.filter(Boolean).join(':');
    }

    return context;
  }

  function storageSessionGet(defaults) {
    return new Promise((resolve) => {
      chrome.storage.session.get(defaults, (items) => {
        resolve(items || defaults);
      });
    });
  }

  function normalizeAuthRecord(rawAuth) {
    if (!rawAuth || typeof rawAuth !== 'object') {
      return null;
    }

    const hash = normalizeText(rawAuth.hash);
    if (!hash || !hash.includes('tgWebAppData=')) {
      return null;
    }

    const capturedAt = Number(rawAuth.capturedAt);
    const authDate = Number(rawAuth.authDate);

    return {
      hash: hash,
      capturedAt: Number.isFinite(capturedAt) && capturedAt > 0 ? capturedAt : null,
      authDate: Number.isFinite(authDate) && authDate > 0 ? authDate : null,
      source: normalizeText(rawAuth.source),
      sourceUrl: normalizeText(rawAuth.sourceUrl)
    };
  }

  async function loadStoredAuth() {
    const items = await storageSessionGet({ [AUTH_STORAGE_KEY]: null });
    return normalizeAuthRecord(items[AUTH_STORAGE_KEY]);
  }

  function buildRemoteUrl(context, auth) {
    const url = new URL(REMOTE_URL);

    if (context.filter) {
      url.searchParams.set('filter', context.filter);
    }

    if (auth?.hash) {
      url.hash = auth.hash;
    }

    return url.toString();
  }

  function getAuthTimestamp(auth) {
    if (auth?.capturedAt) {
      return auth.capturedAt;
    }

    if (auth?.authDate) {
      return auth.authDate * 1000;
    }

    return null;
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) return '';

    const diffMs = Math.max(0, Date.now() - timestamp);
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) {
      return 'just now';
    }

    if (diffMinutes < 60) {
      return `${diffMinutes} min ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} hr ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day ago`;
  }

  function hasFreshAuth(auth) {
    return Boolean(auth?.hash);
  }

  function renderContext(context) {
    const container = document.getElementById('gift-satellite-context');
    const chips = [];

    CONTEXT_FIELDS.forEach(([key, label]) => {
      if (!context[key]) return;

      const chip = document.createElement('span');
      chip.className = 'gift-satellite-embed__chip';

      const chipLabel = document.createElement('span');
      chipLabel.className = 'gift-satellite-embed__chip-label';
      chipLabel.textContent = label;

      const chipValue = document.createElement('span');
      chipValue.textContent = context[key];

      chip.appendChild(chipLabel);
      chip.appendChild(chipValue);
      chips.push(chip);
    });

    if (chips.length === 0) {
      const fallback = document.createElement('span');
      fallback.className = 'gift-satellite-embed__chip';
      fallback.textContent = 'Prefill not detected on this NFT page';
      chips.push(fallback);
    }

    chips.forEach((chip) => container.appendChild(chip));
  }

  function renderNote(context, auth) {
    const note = document.getElementById('gift-satellite-note');

    if (context.collection && context.model && hasFreshAuth(auth)) {
      note.textContent = 'Collection and model were prefilled. This modal reuses the latest Gift Satellite auth captured from Telegram Web in the same browser profile.';
      return;
    }

    if (context.collection && context.model) {
      note.textContent = 'Collection and model are already prefilled. If Telegram auth is missing or stale, refresh it and this window will update automatically.';
      return;
    }

    note.textContent = 'Prefill is partial on this NFT page. If Gift Satellite needs a fresh Telegram session, refresh auth and this window will update automatically.';
  }

  function bindCloseButton() {
    const closeButton = document.getElementById('gift-satellite-close');
    closeButton.addEventListener('click', () => {
      window.parent.postMessage({ type: 'GETGEMS_MARKER_CLOSE_GIFT_SATELLITE' }, '*');
    });
  }

  function updateAuthStatus(auth) {
    const authStatus = document.getElementById('gift-satellite-auth-status');
    const authTimestamp = getAuthTimestamp(auth);
    const ageLabel = formatRelativeTime(authTimestamp);
    const looksStale = authTimestamp ? Date.now() - authTimestamp > AUTH_STALE_HINT_MS : false;

    if (!hasFreshAuth(auth)) {
      authStatus.textContent = state.pendingAuthRefresh
        ? 'Telegram Web opened in a new tab. Click LAUNCH there and this window will refresh automatically when auth is captured.'
        : 'Telegram auth not found yet. Click Refresh Telegram auth, then LAUNCH in Telegram Web. This window will update automatically.';
      return;
    }

    if (looksStale) {
      authStatus.textContent = `Telegram auth captured ${ageLabel}. It may be stale already, so refresh it if Gift Satellite does not open normally.`;
      return;
    }

    authStatus.textContent = ageLabel
      ? `Telegram auth captured ${ageLabel}.`
      : 'Telegram auth captured and ready.';
  }

  function syncOpenTabLink(remoteUrl, auth) {
    const openTabLink = document.getElementById('gift-satellite-open-tab');
    const enabled = hasFreshAuth(auth);

    openTabLink.href = enabled ? remoteUrl : TELEGRAM_AUTH_URL;
    openTabLink.classList.toggle('gift-satellite-embed__action--disabled', !enabled);
    openTabLink.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    openTabLink.tabIndex = enabled ? 0 : -1;
  }

  function clearPendingLoadTimer() {
    if (!state.loadTimeoutId) return;

    window.clearTimeout(state.loadTimeoutId);
    state.loadTimeoutId = null;
  }

  function scheduleFrameFallbackStatus() {
    const frame = document.getElementById('gift-satellite-frame');
    const status = document.getElementById('gift-satellite-status');

    clearPendingLoadTimer();
    state.loadTimeoutId = window.setTimeout(() => {
      if (status.hidden || frame.hidden) return;

      status.textContent = 'If Gift Satellite does not render here, refresh Telegram auth or use Open in new tab.';
    }, 5000);
  }

  function ensureFrameListener() {
    const frame = document.getElementById('gift-satellite-frame');
    if (frame.dataset.bound === '1') return;

    frame.dataset.bound = '1';
    frame.addEventListener('load', () => {
      const status = document.getElementById('gift-satellite-status');
      clearPendingLoadTimer();
      status.hidden = true;
    });
  }

  function syncFrame(remoteUrl, auth) {
    const frame = document.getElementById('gift-satellite-frame');
    const status = document.getElementById('gift-satellite-status');

    ensureFrameListener();

    if (!hasFreshAuth(auth)) {
      clearPendingLoadTimer();
      status.hidden = false;
      status.textContent = state.pendingAuthRefresh
        ? 'Waiting for Telegram Web auth. Click LAUNCH in Telegram Web, then return here.'
        : 'Telegram auth is required before Gift Satellite can open here.';
      frame.hidden = true;
      frame.removeAttribute('src');
      return;
    }

    frame.hidden = false;
    status.hidden = false;
    status.textContent = 'Loading Gift Satellite...';

    if (frame.src !== remoteUrl) {
      frame.src = remoteUrl;
    }

    scheduleFrameFallbackStatus();
  }

  function openTelegramAuthTab() {
    return new Promise((resolve) => {
      if (chrome?.tabs?.create) {
        chrome.tabs.create({ url: TELEGRAM_AUTH_URL }, () => {
          if (!chrome.runtime.lastError) {
            resolve(true);
            return;
          }

          window.open(TELEGRAM_AUTH_URL, '_blank', 'noopener,noreferrer');
          resolve(false);
        });
        return;
      }

      window.open(TELEGRAM_AUTH_URL, '_blank', 'noopener,noreferrer');
      resolve(false);
    });
  }

  async function refreshTelegramAuth() {
    state.pendingAuthRefresh = true;
    updateAuthStatus(state.auth);
    syncFrame(state.remoteUrl, state.auth);
    await openTelegramAuthTab();
  }

  function bindActionButtons() {
    const refreshButton = document.getElementById('gift-satellite-refresh-auth');
    const openTabLink = document.getElementById('gift-satellite-open-tab');

    refreshButton.addEventListener('click', () => {
      refreshTelegramAuth().catch(() => {});
    });

    openTabLink.addEventListener('click', (event) => {
      if (hasFreshAuth(state.auth)) return;
      event.preventDefault();
    });
  }

  function syncUi() {
    state.remoteUrl = buildRemoteUrl(state.context, state.auth);
    syncOpenTabLink(state.remoteUrl, state.auth);
    updateAuthStatus(state.auth);
    renderNote(state.context, state.auth);
    syncFrame(state.remoteUrl, state.auth);
  }

  function watchAuthStorage() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'session') return;
      if (!Object.prototype.hasOwnProperty.call(changes, AUTH_STORAGE_KEY)) return;

      state.auth = normalizeAuthRecord(changes[AUTH_STORAGE_KEY].newValue);
      state.pendingAuthRefresh = false;
      syncUi();
    });
  }

  async function init() {
    state.context = getContext();
    state.auth = await loadStoredAuth();

    renderContext(state.context);
    bindCloseButton();
    bindActionButtons();
    watchAuthStorage();
    syncUi();
  }

  init().catch(() => {
    state.context = getContext();
    renderContext(state.context);
    bindCloseButton();
    bindActionButtons();
    syncUi();
  });
})();
