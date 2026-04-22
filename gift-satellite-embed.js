(function() {
  'use strict';

  const REMOTE_URL = 'https://gift-satellite.dev/subscription/new';
  const REMOTE_ORIGIN = 'https://gift-satellite.dev';
  const TELEGRAM_ORIGIN = 'https://t.me';
  const TELEGRAM_WEBAPP_ORIGIN = 'https://web.telegram.org';
  const TELEGRAM_AUTH_URL = 'https://web.telegram.org/k/#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3Dgift_satellite_bot%26appname%3Dsniper%26startapp%3D';
  const TONNEL_BOT_DOMAIN = 'tonnel_network_bot';
  const TONNEL_BOT_APP_NAME = 'gift';
  const TONNEL_MARKET_URL = 'https://market.tonnel.network/';
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
    pendingAuthRefresh: false,
    remoteFrameBridgeBound: false
  };

  function normalizeText(value) {
    if (typeof value !== 'string') return '';

    return value
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getRemoteFrame() {
    return document.getElementById('gift-satellite-frame');
  }

  function tryParseFrameMessage(data) {
    if (!data) return null;

    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (error) {
        return null;
      }
    }

    return typeof data === 'object' ? data : null;
  }

  function toSafeExternalUrl(value, baseUrl) {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) return '';

    try {
      const url = baseUrl
        ? new URL(normalizedValue, baseUrl)
        : new URL(normalizedValue);

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return '';
      }

      return url.toString();
    } catch (error) {
      return '';
    }
  }

  function parseTelegramAppLaunch(url) {
    const telegramUrl = toSafeExternalUrl(url);
    if (!telegramUrl) return null;

    try {
      const parsedUrl = new URL(telegramUrl);
      if (parsedUrl.origin === TELEGRAM_ORIGIN) {
        const pathParts = parsedUrl.pathname
          .split('/')
          .map((part) => normalizeText(part))
          .filter(Boolean);

        if (pathParts.length < 2) {
          return null;
        }

        const [domain, appName] = pathParts;
        const startApp = normalizeText(parsedUrl.searchParams.get('startapp'));
        if (!domain || !appName || !startApp) {
          return null;
        }

        return {
          domain: domain,
          appName: appName,
          startApp: startApp
        };
      }

      if (parsedUrl.origin !== TELEGRAM_WEBAPP_ORIGIN) {
        return null;
      }

      const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#\?/, ''));
      const tgAddressValue = normalizeText(hashParams.get('tgaddr'));
      if (!tgAddressValue) {
        return null;
      }

      const tgAddress = new URL(tgAddressValue);
      if (tgAddress.protocol !== 'tg:' || tgAddress.hostname !== 'resolve') {
        return null;
      }

      const domain = normalizeText(tgAddress.searchParams.get('domain'));
      const appName = normalizeText(tgAddress.searchParams.get('appname'));
      const startApp = normalizeText(tgAddress.searchParams.get('startapp'));
      if (!domain || !appName || !startApp) {
        return null;
      }

      return {
        domain: domain,
        appName: appName,
        startApp: startApp
      };
    } catch (error) {
      return null;
    }
  }

  function buildTonnelMarketUrl(giftDrawerId) {
    const url = new URL(TONNEL_MARKET_URL);
    url.searchParams.set('giftDrawerId', giftDrawerId);
    return url.toString();
  }

  function convertTelegramUrlToWebAppUrl(url) {
    const telegramUrl = toSafeExternalUrl(url);
    if (!telegramUrl) return '';

    try {
      const telegramLaunch = parseTelegramAppLaunch(telegramUrl);
      if (!telegramLaunch) {
        return telegramUrl;
      }

      if (
        telegramLaunch.domain === TONNEL_BOT_DOMAIN &&
        telegramLaunch.appName === TONNEL_BOT_APP_NAME
      ) {
        return buildTonnelMarketUrl(telegramLaunch.startApp);
      }

      const tgAddress = new URL('tg://resolve');
      tgAddress.searchParams.set('domain', telegramLaunch.domain);
      tgAddress.searchParams.set('appname', telegramLaunch.appName);
      tgAddress.searchParams.set('startapp', telegramLaunch.startApp);

      const webAppUrl = new URL('https://web.telegram.org/k/');
      webAppUrl.hash = `?tgaddr=${encodeURIComponent(tgAddress.toString())}`;
      return webAppUrl.toString();
    } catch (error) {
      return telegramUrl;
    }
  }

  function openExternalTab(url) {
    const targetUrl = toSafeExternalUrl(url);
    if (!targetUrl) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      if (chrome?.tabs?.create) {
        chrome.tabs.create({ url: targetUrl }, () => {
          if (!chrome.runtime.lastError) {
            resolve(true);
            return;
          }

          window.open(targetUrl, '_blank', 'noopener,noreferrer');
          resolve(false);
        });
        return;
      }

      window.open(targetUrl, '_blank', 'noopener,noreferrer');
      resolve(false);
    });
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

  function bindRemoteFrameBridge() {
    if (state.remoteFrameBridgeBound) return;

    state.remoteFrameBridgeBound = true;
    window.addEventListener('message', (event) => {
      const frame = getRemoteFrame();
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.origin !== REMOTE_ORIGIN) return;

      const payload = tryParseFrameMessage(event.data);
      if (!payload?.eventType) return;

      if (payload.eventType === 'web_app_open_tg_link') {
        const telegramUrl = toSafeExternalUrl(payload.eventData?.path_full, TELEGRAM_ORIGIN);
        if (!telegramUrl.startsWith(`${TELEGRAM_ORIGIN}/`)) return;

        openExternalTab(convertTelegramUrlToWebAppUrl(telegramUrl)).catch(() => {});
        return;
      }

      if (payload.eventType === 'web_app_open_link') {
        const externalUrl = toSafeExternalUrl(payload.eventData?.url);
        if (!externalUrl) return;

        openExternalTab(externalUrl).catch(() => {});
      }
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
    bindRemoteFrameBridge();
    watchAuthStorage();
    syncUi();
  }

  init().catch(() => {
    state.context = getContext();
    renderContext(state.context);
    bindCloseButton();
    bindActionButtons();
    bindRemoteFrameBridge();
    syncUi();
  });
})();
