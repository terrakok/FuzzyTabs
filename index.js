(function() {
  const OVERLAY_ID = "fuzzy-spotlight-overlay";
  const INPUT_ID = "fuzzy-spotlight-input";
  const DEBUG = false;
  const log = (...args) => { if (!DEBUG) return; try { console.debug('[FuzzySpotlight][content]', ...args); } catch (_) {} };
  log('content script loaded', { url: location.href });

  function createOverlay() {
    log('createOverlay called');
    if (document.getElementById(OVERLAY_ID)) return document.getElementById(OVERLAY_ID);

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('aria-hidden', 'true');

    // Backdrop + container
    overlay.innerHTML = `
      <div class="fsl-backdrop"></div>
      <div class="fsl-center">
        <div class="fsl-spotlight" role="dialog" aria-modal="true" aria-label="Spotlight">
          <input id="${INPUT_ID}" type="text" autocomplete="off" placeholder="Search or run a command"/>
          <ul class="fsl-results" aria-label="Open tabs"></ul>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #${OVERLAY_ID} { position: fixed; inset: 0; z-index: 2147483647; display: none; }
      #${OVERLAY_ID}.open { display: block; }
      #${OVERLAY_ID} * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
      #${OVERLAY_ID} .fsl-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.25); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
      #${OVERLAY_ID} .fsl-center { position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: center; padding-top: 15vh; }
      #${OVERLAY_ID} .fsl-spotlight { width: min(680px, calc(100vw - 32px)); background: rgba(34,34,36,0.92); color: #fff; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.08); padding: 14px 18px; }
      #${OVERLAY_ID} .fsl-spotlight input { width: 100%; background: transparent; border: none; outline: none; font-size: 20px; color: #fff; caret-color: #66d9ef; }
      #${OVERLAY_ID} .fsl-spotlight input::placeholder { color: rgba(255,255,255,0.55); }
      #${OVERLAY_ID} .fsl-results { margin: 8px 0 0; padding: 4px 0 0; list-style: none; max-height: 50vh; overflow-y: auto; border-top: 1px solid rgba(255,255,255,0.08); }
      #${OVERLAY_ID} .fsl-results li { display: flex; align-items: center; gap: 8px; padding: 8px 6px; font-size: 14px; line-height: 1.35; color: rgba(255,255,255,0.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #${OVERLAY_ID} .fsl-results li:nth-child(odd) { background: rgba(255,255,255,0.03); }
      #${OVERLAY_ID} .fsl-fav { width: 16px; height: 16px; flex: 0 0 16px; border-radius: 2px; background: rgba(255,255,255,0.1); }
      #${OVERLAY_ID} .fsl-title { font-weight: 500; margin-right: 6px; overflow: hidden; text-overflow: ellipsis; }
      #${OVERLAY_ID} .fsl-url { color: rgba(255,255,255,0.65); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
    `;

    overlay.appendChild(style);

    // Close on backdrop click
    overlay.querySelector('.fsl-backdrop').addEventListener('click', () => { log('backdrop clicked, closing overlay'); closeOverlay(); });

    document.documentElement.appendChild(overlay);
    log('overlay injected into DOM');

    // Prevent page scroll while open
    const observer = new MutationObserver(() => {
      if (overlay.classList.contains('open')) {
        document.documentElement.style.overflow = 'hidden';
      } else {
        document.documentElement.style.overflow = '';
      }
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });

    // Keyboard handling when overlay is open
    document.addEventListener('keydown', (e) => {
      const isOpen = overlay.classList.contains('open');
      if (!isOpen) return;
      if (e.key === 'Escape') {
        log('Escape pressed, closing overlay');
        e.preventDefault();
        closeOverlay();
      }
    }, true);

    return overlay;
  }

  function renderTabsList(tabs) {
    try {
      const overlay = document.getElementById(OVERLAY_ID) || createOverlay();
      const ul = overlay.querySelector('.fsl-results');
      if (!ul) return;
      ul.innerHTML = '';
      if (!tabs || !tabs.length) {
        const li = document.createElement('li');
        li.textContent = 'No tabs available';
        li.style.color = 'rgba(255,255,255,0.6)';
        ul.appendChild(li);
        return;
      }
      for (const t of tabs) {
        const li = document.createElement('li');
        // favicon
        const img = document.createElement('img');
        img.className = 'fsl-fav';
        img.alt = '';
        img.decoding = 'async';
        // Prefer tabs API favicon; fallback to origin favicon.ico if available
        let favicon = t.favIconUrl;
        try {
          if (!favicon && t.url) {
            const u = new URL(t.url);
            if (u.origin && u.origin !== 'null') favicon = u.origin + '/favicon.ico';
          }
        } catch (_) {}
        if (favicon) img.src = favicon;
        img.addEventListener('error', () => { img.style.visibility = 'hidden'; });

        // title and url
        const titleSpan = document.createElement('span');
        titleSpan.className = 'fsl-title';
        titleSpan.textContent = (t.title && t.title.trim()) ? t.title : (t.url || 'Untitled');

        const urlSpan = document.createElement('span');
        urlSpan.className = 'fsl-url';
        urlSpan.textContent = t.url || '';

        li.appendChild(img);
        li.appendChild(titleSpan);
        li.appendChild(urlSpan);
        ul.appendChild(li);
      }
    } catch (e) {
      log('renderTabsList error', e);
    }
  }

  function fetchAllTabsAndRender() {
    try {
      const api = (typeof browser !== 'undefined') ? browser : chrome;
      api.runtime.sendMessage({ type: 'get-all-tabs' }, (resp) => {
        try {
          if (resp && resp.ok && Array.isArray(resp.tabs)) {
            log('received tabs list', { count: resp.tabs.length });
            renderTabsList(resp.tabs);
          } else {
            log('unexpected response for get-all-tabs', resp);
            renderTabsList([]);
          }
        } catch (e) {
          log('error handling tabs response', e);
        }
      });
    } catch (e) {
      log('failed to request get-all-tabs', e);
    }
  }

  function openOverlay() {
    log('openOverlay');
    const overlay = createOverlay();
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    const input = overlay.querySelector('#' + CSS.escape(INPUT_ID));
    if (input) {
      log('focusing input');
      input.value = '';
      setTimeout(() => input.focus(), 0);
    }
    // Load tabs list under the input
    fetchAllTabsAndRender();
  }

  function closeOverlay() {
    log('closeOverlay');
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function toggleOverlay() {
    const overlay = createOverlay();
    const isOpen = overlay.classList.contains('open');
    log('toggleOverlay', { currentlyOpen: isOpen });
    if (isOpen) closeOverlay(); else openOverlay();
  }

  // Listen for command messages from background
  const portMessage = (msg) => {
    log('runtime message received', msg);
    if (!msg) return;
    if (msg.type === 'toggle-spotlight') {
      log('processing toggle-spotlight message');
      toggleOverlay();
    }
  };

  try {
    // Prefer browser API; fallback to chrome
    const api = (typeof browser !== 'undefined') ? browser : chrome;
    api.runtime.onMessage.addListener(portMessage);
    log('registered runtime.onMessage listener');
  } catch (e) {
    log('runtime messaging API not available', e);
    // in case messaging API isn't available, do nothing
  }
})();