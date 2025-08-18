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
})();
