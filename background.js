// Background service worker for secure Toncenter lookups
(function() {
  'use strict';

  const ENCRYPTED_API_KEYS_TONCENTER = [
    'gAAAAABp4uC6PfGzVko7PdQlGcBPMV67_tKJg1iQNjxb8ZwBCTv1lnaStFckIJu9hEf9MvrGrjLvIzFv_dhs1QlvmqOSOtqBXxF5EKu9u-y3LKPFCs7t3-lJ9bQadNWL0iidZ9PodSW74rpRDylFszsvDN2YvGOxrskHYW_Uko0vBVyMdYFKOFA=',
    'gAAAAABp4uC6ffV96FFx3OuHNR3s6ccEuA_6DRFU4V1F7LTw6UkudbBU6H5__4bds-ZofQhQwSHQR6aq9K2ek-Ekym_ZpUnLliAThVrsjHg3cV_N90BoxPi3dpsEdByR1zprEN1MocpUfRIQq6WshiYwM0mjqyLYkcvBeUqV5kUhRwC31LtyL60=',
    'gAAAAABp4uC6o8w5ESmWYfuQgr69AKWj6hWsHXyhCRvYzbFoDR2hTJ2KN-SwvKergSZKpZxotNdYAfd3Mj5ViNBjrbciJ8rqjhTaDMWoIgZCk7nSleSUsvG-gWKNEa1abLCv7oQtl-LXPcGl-p8imUBRmgnuhte2dmttIt5KF-FVwH6l8BX2IxM=',
    'gAAAAABp4uC6cqeaBVAlQ_Z6zGTFMtDaHOTLt7bpbj4Av6UZ3pby-k7V73DfW3rXU2NIgAch-NhAr2biskT1MLgAaaXsccCsok5a-9nahtBvOzyu5ZMdNcc-9PWX8-sBMaGw9Ib1POzCBgGwymPj23mN6Wt3A26H3mMGaw9n5cHe6AN4pg4wKqY=',
    'gAAAAABp4uC6I4AI0e6kz4uGG47A8Xk1PME9CurZHgjM34X0fry9-XD2HuD2FmnA_FxO48_KbuLQidQHc1k1pp9R_lpzpmDlyyAX7_ogpQvUGyppU2vuTQBBW7gnArcIgOqplpStZRvcNWsretLWIWLum82uZeKuoTodoo_9lESLTkTQdl-zTAw=',
    'gAAAAABp4uC6mwq8kaSPg8Wn2YX4I1N7yBWeS6YLBaHmPiyBF82LKo3-Gj22r1n4lGvD3D35N0HUQPjuw5Tn0ZQEnJlze6iIw8HgQjJYbgfGfTp9fFc2IawOjDTSEkKKHRl7cX00ZvkaF1I0yzQlb0KI-lz2KIAvBeqAXIJCAbw2PKEL86fwnZc=',
    'gAAAAABp4uC6PFLXfvjOTVTpOVZx_2awWzoIauPx3fCGHHsybMBmiqVywfkiX1M7cDKdOHKlbznGAuBHe0Z1_V2tDkc98W9ar5oJshSxiuitM_xV7m0PYY2pHhIE9vbAWQtk2aLP6LSvQNQyNNiHrZD6py14uIgZZLQm6OjJIkUVw2EXtiXHgZ8=',
    'gAAAAABp4uC6COdlnM_3S3OIg0C5tFYLdga8oWDdFUpIq9YvDzW0nCYCHmuOerjIkYFlKKeK00pZPCvhALGOi8e_xqY2IXdDk5CzhBHOezUKFLsgHJ3vW45ESxEaHMlcT9nFEeRT_i1Mg7a3OVxxt58cfHVyOF6RSW7xfVWi8kVxnZSiMTQD4IM=',
    'gAAAAABp4uC6ZyIUmCEkDfHzeQoxZdt-bJ0mQajA1eTANXRkpADI_Kh0sDTBHxWGNVrKNouklerkVCNoqZX28mR8Zahsl_3aM1LWT6XbpR1GgswjuS_cjqtbxJ6bBLLHOK7aNupFzMEODnCN5NRt2KEnFW-hS78L1QoxN4gMORnatv_0prdk1eg=',
    'gAAAAABp4uC6_2LHywV-ur5vzOG_DCBYsKDoKJFLxhxyLcBym8hQju34E2LKMymokuDaOJHjI9Wz7MOvL9Rl1SDX1-TVSKVX0nEWiDqROfZRR8tWFczi11qHFTuHdC8MmoU9ufGqJWougRBOtdZJFi03NspuTfiGdsYrc2ZJJGXtprvsbgQInO4='
  ];

  const TONCENTER_REQUEST_DELAY_MIN_MS = 50;
  const TONCENTER_REQUEST_DELAY_MAX_MS = 110;
  const TONCENTER_RETRY_DELAY_MS = 110;
  const TONCENTER_MAX_ATTEMPTS = Math.max(6, ENCRYPTED_API_KEYS_TONCENTER.length * 2);
  const GIFT_SATELLITE_AUTH_STORAGE_KEY = 'gift_satellite_auth';

  let toncenterKeyIndex = 0;
  let cachedApiPassword = null;
  let cachedDecryptedToncenterApiKeys = null;
  let toncenterApiKeysPromise = null;
  let toncenterRequestQueue = Promise.resolve();

  const historyLookupCache = new Map();
  const historyLookupPromises = new Map();

  function normalizeHash(hash) {
    return typeof hash === 'string' ? hash.trim().toLowerCase() : '';
  }

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getRandomToncenterRequestDelayMs() {
    const delayRange = TONCENTER_REQUEST_DELAY_MAX_MS - TONCENTER_REQUEST_DELAY_MIN_MS;
    return TONCENTER_REQUEST_DELAY_MIN_MS + Math.floor(Math.random() * (delayRange + 1));
  }

  function enqueueToncenterRequest(task) {
    const queuedTask = toncenterRequestQueue
      .catch(() => undefined)
      .then(async () => {
        await delay(getRandomToncenterRequestDelayMs());
        return task();
      });

    toncenterRequestQueue = queuedTask.catch(() => undefined);
    return queuedTask;
  }

  function storageLocalGet(defaults) {
    return new Promise((resolve) => {
      chrome.storage.local.get(defaults, (items) => {
        resolve(items || defaults);
      });
    });
  }

  function storageSessionGet(defaults) {
    return new Promise((resolve) => {
      chrome.storage.session.get(defaults, (items) => {
        resolve(items || defaults);
      });
    });
  }

  function storageSessionSet(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.session.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  }

  function normalizeGiftSatelliteAuthRecord(rawAuth) {
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

  async function persistGiftSatelliteAuthRecord(rawAuth) {
    const nextRecord = normalizeGiftSatelliteAuthRecord(rawAuth);
    if (!nextRecord) {
      throw new Error('Gift Satellite auth payload is invalid');
    }

    const existingItems = await storageSessionGet({ [GIFT_SATELLITE_AUTH_STORAGE_KEY]: null });
    const existingRecord = normalizeGiftSatelliteAuthRecord(existingItems[GIFT_SATELLITE_AUTH_STORAGE_KEY]);

    if (existingRecord?.hash === nextRecord.hash) {
      return nextRecord;
    }

    await storageSessionSet({
      [GIFT_SATELLITE_AUTH_STORAGE_KEY]: nextRecord
    });

    return nextRecord;
  }

  function resetToncenterSecretsCache() {
    cachedApiPassword = null;
    cachedDecryptedToncenterApiKeys = null;
    toncenterApiKeysPromise = null;
    toncenterKeyIndex = 0;
    historyLookupCache.clear();
    historyLookupPromises.clear();
  }

  function base64UrlToUint8Array(value) {
    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    const base64 = normalizedValue
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(normalizedValue.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  async function decryptFernetToken(token, fernetKey) {
    const keyBytes = base64UrlToUint8Array(fernetKey);
    if (keyBytes.length !== 32) {
      throw new Error('api_password is not a valid Fernet key');
    }

    const tokenBytes = base64UrlToUint8Array(token);
    if (tokenBytes.length < 57 || tokenBytes[0] !== 0x80) {
      throw new Error('Encrypted Toncenter key has invalid Fernet payload');
    }

    const signingKey = keyBytes.slice(0, 16);
    const encryptionKey = keyBytes.slice(16, 32);
    const signedPayload = tokenBytes.slice(0, tokenBytes.length - 32);
    const signature = tokenBytes.slice(tokenBytes.length - 32);
    const iv = tokenBytes.slice(9, 25);
    const ciphertext = tokenBytes.slice(25, tokenBytes.length - 32);

    const hmacKey = await crypto.subtle.importKey(
      'raw',
      signingKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const isSignatureValid = await crypto.subtle.verify('HMAC', hmacKey, signature, signedPayload);

    if (!isSignatureValid) {
      throw new Error('api_password failed to decrypt Toncenter API keys');
    }

    const aesKey = await crypto.subtle.importKey(
      'raw',
      encryptionKey,
      { name: 'AES-CBC' },
      false,
      ['decrypt']
    );
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: iv },
      aesKey,
      ciphertext
    );

    return new TextDecoder().decode(new Uint8Array(decryptedBuffer));
  }

  async function getStoredApiPassword() {
    const items = await storageLocalGet({ api_password: '' });
    return typeof items.api_password === 'string' ? items.api_password.trim() : '';
  }

  async function getToncenterApiKeys() {
    const apiPassword = await getStoredApiPassword();
    if (!apiPassword) {
      return [];
    }

    if (cachedApiPassword === apiPassword && Array.isArray(cachedDecryptedToncenterApiKeys)) {
      return cachedDecryptedToncenterApiKeys;
    }

    if (toncenterApiKeysPromise) {
      return toncenterApiKeysPromise;
    }

    toncenterApiKeysPromise = Promise.all(
      ENCRYPTED_API_KEYS_TONCENTER.map((token) => decryptFernetToken(token, apiPassword))
    )
      .then((keys) => {
        cachedApiPassword = apiPassword;
        cachedDecryptedToncenterApiKeys = keys;
        toncenterKeyIndex = 0;
        return keys;
      })
      .finally(() => {
        toncenterApiKeysPromise = null;
      });

    return toncenterApiKeysPromise;
  }

  async function getNextToncenterApiKey() {
    const apiKeys = await getToncenterApiKeys();
    if (!Array.isArray(apiKeys) || apiKeys.length === 0) {
      throw new Error('api_password is not set');
    }

    const key = apiKeys[toncenterKeyIndex % apiKeys.length];
    toncenterKeyIndex = (toncenterKeyIndex + 1) % apiKeys.length;
    return key;
  }

  function isFragmentTransaction(tx) {
    return Array.isArray(tx?.out_msgs) && tx.out_msgs.some((msg) => msg?.decoded_opcode === 'auction_fill_up');
  }

  function getOutMessages(tx) {
    return Array.isArray(tx?.out_msgs) ? tx.out_msgs : [];
  }

  function hasTextComment(tx, comment) {
    return getOutMessages(tx).some((msg) => {
      const decoded = msg?.message_content?.decoded;
      return msg?.decoded_opcode === 'text_comment' && decoded?.comment === comment;
    });
  }

  function hasOutNftTransfer(tx) {
    return getOutMessages(tx).some((msg) => msg?.decoded_opcode === 'nft_transfer');
  }

  function isGetgemsTransaction(tx) {
    return tx?.in_msg?.decoded_opcode === 'nft_transfer';
  }

  function isGetgemsOfferTransaction(tx) {
    return hasTextComment(tx, 'Profit') && hasOutNftTransfer(tx);
  }

  function detectMarketplaceInfo(tx) {
    if (isFragmentTransaction(tx)) {
      return {
        marketplace: 'fragment',
        saleType: 'sale'
      };
    }

    if (isGetgemsOfferTransaction(tx)) {
      return {
        marketplace: 'getgems',
        saleType: 'offer'
      };
    }

    if (isGetgemsTransaction(tx)) {
      return {
        marketplace: 'getgems',
        saleType: 'sale'
      };
    }

    return {
      marketplace: 'unknown',
      saleType: 'sale'
    };
  }

  async function fetchTransaction(hash, attempt = 1) {
    const response = await enqueueToncenterRequest(async () => {
      const apiKey = await getNextToncenterApiKey();
      return fetch(`https://toncenter.com/api/v3/transactions?hash=${encodeURIComponent(hash)}`, {
        headers: {
          'Accept': 'application/json',
          'x-api-key': apiKey
        },
        cache: 'no-store'
      });
    });

    if (!response.ok) {
      if (attempt >= TONCENTER_MAX_ATTEMPTS) {
        throw new Error(`toncenter responded with ${response.status}`);
      }

      await delay(TONCENTER_RETRY_DELAY_MS);
      return fetchTransaction(hash, attempt + 1);
    }

    const data = await response.json();
    const tx = Array.isArray(data?.transactions) ? data.transactions[0] : null;

    if (tx) {
      return tx;
    }

    if (attempt >= TONCENTER_MAX_ATTEMPTS) {
      return null;
    }

    await delay(TONCENTER_RETRY_DELAY_MS);
    return fetchTransaction(hash, attempt + 1);
  }

  async function lookupMarketplace(hash) {
    const normalizedHash = normalizeHash(hash);
    if (!normalizedHash) {
      return null;
    }

    if (historyLookupCache.has(normalizedHash)) {
      return historyLookupCache.get(normalizedHash);
    }

    if (historyLookupPromises.has(normalizedHash)) {
      return historyLookupPromises.get(normalizedHash);
    }

    const pendingLookup = (async() => {
      try {
        const tx = await fetchTransaction(normalizedHash);
        const marketplaceInfo = tx ? detectMarketplaceInfo(tx) : { marketplace: 'unknown', saleType: 'sale' };
        const result = {
          hash: normalizedHash,
          marketplace: marketplaceInfo.marketplace,
          saleType: marketplaceInfo.saleType,
          offchain: false
        };

        historyLookupCache.set(normalizedHash, result);
        return result;
      } catch (e) {
        console.error('[Getgems Marker] Toncenter lookup failed for hash:', normalizedHash, e);

        const fallbackResult = {
          hash: normalizedHash,
          marketplace: 'unknown',
          saleType: 'sale',
          offchain: false
        };

        historyLookupCache.set(normalizedHash, fallbackResult);
        return fallbackResult;
      } finally {
        historyLookupPromises.delete(normalizedHash);
      }
    })();

    historyLookupPromises.set(normalizedHash, pendingLookup);
    return pendingLookup;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'GETGEMS_MARKER_SET_GIFT_SATELLITE_AUTH') {
      persistGiftSatelliteAuthRecord(message.record)
        .then((record) => {
          sendResponse({
            ok: true,
            hash: record.hash
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error?.message || 'Failed to persist Gift Satellite auth'
          });
        });

      return true;
    }

    if (message?.type === 'GETGEMS_MARKER_VALIDATE_API_PASSWORD') {
      getToncenterApiKeys()
        .then((apiKeys) => {
          sendResponse({
            ok: Array.isArray(apiKeys) && apiKeys.length > 0,
            keyCount: Array.isArray(apiKeys) ? apiKeys.length : 0
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error?.message || 'Failed to decrypt Toncenter API keys'
          });
        });

      return true;
    }

    if (message?.type !== 'GETGEMS_MARKER_LOOKUP_HISTORY_MARKETPLACES') {
      return undefined;
    }

    const hashes = Array.isArray(message.hashes)
      ? Array.from(new Set(message.hashes.map(normalizeHash).filter(Boolean)))
      : [];

    Promise.all(hashes.map((hash) => lookupMarketplace(hash)))
      .then((results) => {
        const data = {};

        results.forEach((result) => {
          if (!result?.hash) return;
          data[result.hash] = result;
        });

        sendResponse({
          ok: true,
          data: data
        });
      })
      .catch((error) => {
        console.error('[Getgems Marker] History lookup batch failed:', error);
        sendResponse({
          ok: false,
          error: error?.message || 'History lookup batch failed'
        });
      });

    return true;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!Object.prototype.hasOwnProperty.call(changes, 'api_password')) return;

    resetToncenterSecretsCache();
  });
})();
