(function(){
  // Use browser.* if available, fallback to chrome.* for compatibility
  const api = (typeof browser !== 'undefined') ? browser : chrome;
  const DEBUG = false;
  const log = (...args) => { if (!DEBUG) return; try { console.debug('[FuzzyTabs][background]', ...args); } catch (_) {} };
  log('background loaded');

  // Small helpers to deduplicate repeated tab activation code
  function activateTabAndRespond(tabId, sendResponse) {
    try {
      api.tabs.update(tabId, { active: true }, () => {
        const err = api.runtime && api.runtime.lastError;
        if (err) {
          log('tabs.update error', err);
          sendResponse({ ok: false, error: String((err && err.message) || err) });
        } else {
          sendResponse({ ok: true });
        }
      });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  }

  function focusWindowThenActivate(windowId, tabId, sendResponse) {
    try {
      if (typeof windowId === 'number' && api.windows && api.windows.update) {
        api.windows.update(windowId, { focused: true }, () => {
          // ignore possible lastError on focusing
          activateTabAndRespond(tabId, sendResponse);
        });
      } else {
        // No windows API or no windowId, just activate the tab
        activateTabAndRespond(tabId, sendResponse);
      }
    } catch (e) {
      log('error focusing window', e);
      // Try to activate anyway
      activateTabAndRespond(tabId, sendResponse);
    }
  }
  
  // Handle messages from content scripts
  if (api && api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || !msg.type) return; // not ours
        if (msg.type === 'get-all-tabs') {
          log('get-all-tabs request');
          api.tabs.query({}, (tabs) => {
            try {
              const data = (tabs || []).map(t => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl, active: t.active, windowId: t.windowId }));
              sendResponse({ ok: true, tabs: data });
            } catch (e) {
              log('error mapping tabs', e);
              sendResponse({ ok: false, error: String(e) });
            }
          });
          return true; // keep the message channel open for async sendResponse
        } else if (msg.type === 'activate-tab') {
          const tabId = msg && msg.tabId;
          if (typeof tabId === 'number') {
            log('activate-tab request', { tabId });
            try {
              api.tabs.get(tabId, (tabInfo) => {
                const getErr = api.runtime && api.runtime.lastError;
                if (getErr) {
                  log('tabs.get error', getErr);
                  // Fallback: try to activate anyway
                  activateTabAndRespond(tabId, sendResponse);
                  return;
                }
                const targetWindowId = tabInfo && tabInfo.windowId;
                // First, focus the window (also unminimize if supported)
                focusWindowThenActivate(targetWindowId, tabId, sendResponse);
              });
              return true; // async
            } catch (e) {
              log('tabs.update threw', e);
              sendResponse({ ok: false, error: String(e) });
            }
          } else {
            sendResponse({ ok: false, error: 'Invalid tabId' });
          }
        } else if (msg.type === 'close-tab') {
          const tabId = msg && msg.tabId;
          if (typeof tabId === 'number') {
            log('close-tab request', { tabId });
            try {
              api.tabs.remove(tabId, () => {
                const err = api.runtime && api.runtime.lastError;
                if (err) {
                  log('tabs.remove error', err);
                  sendResponse({ ok: false, error: String(err && err.message || err) });
                } else {
                  sendResponse({ ok: true });
                }
              });
              return true; // async
            } catch (e) {
              log('tabs.remove threw', e);
              sendResponse({ ok: false, error: String(e) });
            }
          } else {
            sendResponse({ ok: false, error: 'Invalid tabId' });
          }
        }
      } catch (e) {
        log('onMessage handler error', e);
      }
    });
  }
})();
