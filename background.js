(function(){
  // Use browser.* if available, fallback to chrome.* for compatibility
  const api = (typeof browser !== 'undefined') ? browser : chrome;
  const DEBUG = true;
  const log = (...args) => { if (!DEBUG) return; try { console.debug('[FuzzySpotlight][background]', ...args); } catch (_) {} };
  log('background loaded');

  function sendToggleToActiveTab() {
    try {
      log('querying active tab');
      api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const targetTabs = tabs || [];
        log('tabs query result', { count: targetTabs.length });
        for (const tab of targetTabs) {
          if (!tab.id) continue;
          try {
            log('sending message to tab', { id: tab.id, url: tab.url });
            api.tabs.sendMessage(tab.id, { type: 'toggle-spotlight' });
          } catch (e) {
            log('failed to send message to tab', { id: tab && tab.id, error: e });
            // ignore failures (e.g., no content script on the page like about: pages)
          }
        }
      });
    } catch (e) {
      log('error in sendToggleToActiveTab', e);
      // noop
    }
  }

  if (api && api.commands && api.commands.onCommand) {
    log('registering commands.onCommand listener');
    api.commands.onCommand.addListener((command) => {
      log('command received', { command });
      if (command === 'toggle-spotlight') {
        sendToggleToActiveTab();
      }
    });
  } else {
    log('commands API not available');
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
        }
      } catch (e) {
        log('onMessage handler error', e);
      }
    });
  }
})();
