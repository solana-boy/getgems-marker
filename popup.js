(function() {
  'use strict';

  const form = document.getElementById('api-password-form');
  const input = document.getElementById('api-password');
  const clearButton = document.getElementById('clear-api-password');
  const status = document.getElementById('popup-status');

  function setStatus(message) {
    status.textContent = message || '';
  }

  function storageLocalGet(defaults) {
    return new Promise((resolve) => {
      chrome.storage.local.get(defaults, (items) => {
        resolve(items || defaults);
      });
    });
  }

  function storageLocalSet(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  }

  function storageLocalRemove(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(key, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  }

  function runtimeSendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(response);
      });
    });
  }

  function queryActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(Array.isArray(tabs) ? tabs[0] : null);
      });
    });
  }

  async function notifyActiveTabToRetryHistoryLookups() {
    const activeTab = await queryActiveTab();
    if (!activeTab?.id) return;

    await new Promise((resolve) => {
      chrome.tabs.sendMessage(activeTab.id, { type: 'GETGEMS_MARKER_RETRY_HISTORY_LOOKUPS' }, () => {
        resolve();
      });
    });
  }

  async function loadApiPassword() {
    try {
      const items = await storageLocalGet({ api_password: '' });
      input.value = typeof items.api_password === 'string' ? items.api_password : '';
    } catch (error) {
      console.error('[Getgems Marker] Failed to load api_password:', error);
      setStatus('Failed to load saved api_password.');
    }
  }

  form.addEventListener('submit', async(event) => {
    event.preventDefault();

    try {
      const nextValue = input.value.trim();
      await storageLocalSet({ api_password: nextValue });
      if (!nextValue) {
        setStatus('Empty api_password saved.');
        return;
      }

      const validation = await runtimeSendMessage({ type: 'GETGEMS_MARKER_VALIDATE_API_PASSWORD' });
      if (!validation?.ok) {
        setStatus(validation?.error || 'api_password was saved, but decryption failed.');
        return;
      }

      await notifyActiveTabToRetryHistoryLookups();
      setStatus(`api_password saved. Toncenter keys loaded: ${validation.keyCount}.`);
    } catch (error) {
      console.error('[Getgems Marker] Failed to save api_password:', error);
      setStatus('Failed to save api_password.');
    }
  });

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

  loadApiPassword();
})();
