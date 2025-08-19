(function() {
  const OVERLAY_ID = "fuzzy-spotlight-overlay";
  const INPUT_ID = "fuzzy-spotlight-input";
  const DEBUG = false;
  const log = (...args) => { if (!DEBUG) return; try { console.debug('[FuzzySpotlight][content]', ...args); } catch (_) {} };
  log('content script loaded', { url: location.href });

  // State for results navigation
  const STATE = { allTabs: [], tabs: [], focusedIndex: -1, query: '', allowMouseFocus: false };

  function getOverlayElements() {
    const overlay = document.getElementById(OVERLAY_ID) || createOverlay();
    return {
      overlay,
      input: overlay.querySelector('#' + CSS.escape(INPUT_ID)),
      ul: overlay.querySelector('.fsl-results')
    };
  }

  function setFocusedIndex(newIndex) {
    const { ul } = getOverlayElements();
    const items = ul ? Array.from(ul.querySelectorAll('li')) : [];
    if (!items.length) { STATE.focusedIndex = -1; return; }
    const max = items.length - 1;
    newIndex = Math.max(0, Math.min(max, newIndex));
    // Remove previous
    if (STATE.focusedIndex >= 0 && items[STATE.focusedIndex]) {
      items[STATE.focusedIndex].classList.remove('focused');
    }
    // Add to new
    STATE.focusedIndex = newIndex;
    const li = items[newIndex];
    if (li) {
      li.classList.add('focused');
      try { li.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    }
  }

  function moveFocus(delta) {
    const { ul } = getOverlayElements();
    const items = ul ? Array.from(ul.querySelectorAll('li')) : [];
    if (!items.length) return;
    const next = STATE.focusedIndex < 0 ? 0 : STATE.focusedIndex + delta;
    setFocusedIndex(next);
  }

  function activateTabById(tabId) {
    try {
      const api = (typeof browser !== 'undefined') ? browser : chrome;
      api.runtime.sendMessage({ type: 'activate-tab', tabId }, (resp) => {
        // On success, close overlay
        if (resp && resp.ok) {
          closeOverlay();
        }
      });
    } catch (_) {}
  }

  function buildHighlightedSpan(text, ranges) {
    const span = document.createElement('span');
    let pos = 0;
    for (const [a, b] of ranges) {
      if (a > pos) span.appendChild(document.createTextNode(text.slice(pos, a)));
      const mark = document.createElement('span');
      mark.className = 'fsl-hl';
      mark.textContent = text.slice(a, b + 1);
      span.appendChild(mark);
      pos = b + 1;
    }
    if (pos < text.length) span.appendChild(document.createTextNode(text.slice(pos)));
    return span;
  }

  function computeResultsAndRender() {
    const { ul, input } = getOverlayElements();
    if (!ul) return;
    const q = (input && input.value || '').trim();
    STATE.query = q;
    if (!q) {
      // No query: show all tabs in original order
      renderTabsList(STATE.allTabs.map(t => ({ item: t })));
      return;
    }

    const fuzzySearch = window.Microfuzz.createFuzzySearch(STATE.allTabs, {
        getText: (item) => [item.title, item.url]
    })
    const fuzzySearchResults = fuzzySearch(q)
    renderTabsList(fuzzySearchResults);
  }

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
          <input id="${INPUT_ID}" type="text" autocomplete="off" placeholder="Start typing something..."/>
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
      #${OVERLAY_ID} .fsl-results li { position: relative; }
      #${OVERLAY_ID} .fsl-results li .fsl-arrow { width: 10px; flex: 0 0 10px; color: #fff; opacity: 0; }
      #${OVERLAY_ID} .fsl-results li.focused .fsl-arrow { opacity: 1; }
      #${OVERLAY_ID} .fsl-results li.focused { background: rgba(255,255,255,0.08); }
      #${OVERLAY_ID} .fsl-hl { color: #ffe08a; font-weight: 700; }
      #${OVERLAY_ID} .fsl-results li .fsl-close { margin-left: auto; flex: 0 0 auto; width: 16px; height: 16px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.65); opacity: 0; cursor: pointer; user-select: none; background: transparent; border: 1px solid rgba(255,255,255,0.06); transition: opacity 120ms ease, background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease; }
      #${OVERLAY_ID} .fsl-results li.focused .fsl-close { opacity: 1; }
      #${OVERLAY_ID} .fsl-results li .fsl-close:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.10); }
      #${OVERLAY_ID} .fsl-results li .fsl-close:active { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.14); }
      #${OVERLAY_ID} .fsl-results li .fsl-close:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(255,255,255,0.12); }
      #${OVERLAY_ID} .fsl-results li .fsl-close svg { width: 10px; height: 10px; display: block; }
    `;

    overlay.appendChild(style);

    // Close on backdrop click
    overlay.querySelector('.fsl-backdrop').addEventListener('click', () => { log('backdrop clicked, closing overlay'); closeOverlay(); });

    // Also close when clicking anywhere outside the spotlight panel (e.g., on the center area around it)
    overlay.addEventListener('mousedown', (e) => {
      try {
        // Only when overlay is open
        if (!overlay.classList.contains('open')) return;
        const target = e.target;
        const insideSpotlight = target && target.closest && target.closest('.fsl-spotlight');
        if (!insideSpotlight) {
          log('outside click detected, closing overlay');
          closeOverlay();
        }
      } catch (_) {}
    }, true);

    document.documentElement.appendChild(overlay);
    log('overlay injected into DOM');

    // Wire input events for fuzzy search
    const inputEl = overlay.querySelector('#' + CSS.escape(INPUT_ID));
    if (inputEl) {
      inputEl.addEventListener('input', () => computeResultsAndRender());
      // If Vimium or other extensions steal focus from the input on Escape (blurring it),
      // ensure that leaving the overlay closes it to match expected UX.
      inputEl.addEventListener('blur', (ev) => {
        try {
          if (!overlay.classList.contains('open')) return;
          const next = ev.relatedTarget;
          const stillInside = next && next.closest && next.closest('#' + CSS.escape(OVERLAY_ID));
          if (stillInside) return;
          // Defer to allow any immediate focus changes. If focus ends up outside the overlay, close it.
          setTimeout(() => {
            if (!overlay.classList.contains('open')) return;
            const ae = document.activeElement;
            const insideNow = ae && ae.closest && ae.closest('#' + CSS.escape(OVERLAY_ID));
            if (!insideNow) {
              log('Input blurred away from overlay, closing overlay');
              closeOverlay();
            }
          }, 0);
        } catch (_) {}
      }, true);
    }

    // Prevent page scroll while open
    const observer = new MutationObserver(() => {
      if (overlay.classList.contains('open')) {
        document.documentElement.style.overflow = 'hidden';
      } else {
        document.documentElement.style.overflow = '';
      }
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });

    // Enable mouse-driven focusing only after actual mouse movement while overlay is open
    document.addEventListener('mousemove', () => {
      if (overlay.classList.contains('open')) {
        STATE.allowMouseFocus = true;
      }
    }, true);

    // Keyboard handling when overlay is open
    document.addEventListener('keydown', (e) => {
      const isOpen = overlay.classList.contains('open');
      if (!isOpen) return;
      // Any key press disables mouse-driven focusing until the mouse moves again
      STATE.allowMouseFocus = false;
      if (e.key === 'Escape') {
        log('Escape pressed, closing overlay');
        e.preventDefault();
        closeOverlay();
        return;
      }
      if (e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'n' || e.key === 'N'))) {
        e.preventDefault();
        moveFocus(1);
        return;
      }
      if (e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'p' || e.key === 'P'))) {
        e.preventDefault();
        moveFocus(-1);
        return;
      }
      if (e.key === 'Enter') {
        // Activate the focused tab
        const { ul } = getOverlayElements();
        if (!ul) return;
        const items = Array.from(ul.querySelectorAll('li'));
        if (STATE.focusedIndex >= 0 && items[STATE.focusedIndex]) {
          const li = items[STATE.focusedIndex];
          const tabId = li && li.getAttribute('data-tab-id');
          if (tabId) {
            e.preventDefault();
            activateTabById(parseInt(tabId, 10));
          }
        }
        return;
      }
      // Ctrl/Cmd+W closes the focused tab from the list (not the browser tab)
      const isMac = navigator.platform && /Mac/i.test(navigator.platform);
      if ((e.key === 'w' || e.key === 'W') && (e.ctrlKey && isMac || e.altKey && !isMac)) {
        const { ul } = getOverlayElements();
        if (!ul) return;
        const items = Array.from(ul.querySelectorAll('li'));
        if (STATE.focusedIndex >= 0 && items[STATE.focusedIndex]) {
          const li = items[STATE.focusedIndex];
          const tabIdStr = li && li.getAttribute('data-tab-id');
          if (tabIdStr) {
            e.preventDefault();
            e.stopPropagation();
            const tabId = parseInt(tabIdStr, 10);
            try {
              const api = (typeof browser !== 'undefined') ? browser : chrome;
              api.runtime.sendMessage({ type: 'close-tab', tabId }, (resp) => {
                // Optimistically remove the item from the list
                try {
                  li.remove();
                  const remaining = Array.from(ul.querySelectorAll('li'));
                  // Update STATE.tabs and STATE.allTabs to reflect removal
                  STATE.tabs = STATE.tabs.filter(t => t.id !== tabId);
                  STATE.allTabs = STATE.allTabs.filter(t => t.id !== tabId);
                  // Adjust focus to a sensible item
                  if (remaining.length > 0) {
                    const nextIndex = Math.min(STATE.focusedIndex, remaining.length - 1);
                    STATE.focusedIndex = -1; // will be set by setFocusedIndex
                    setFocusedIndex(nextIndex);
                  } else {
                    // No items left; show empty message
                    computeResultsAndRender();
                  }
                } catch (_) {}
              });
            } catch (_) {}
          }
        }
        return;
      }
    }, true);

    return overlay;
  }

  // Helpers injected between overlay creation and rendering
  function renderTabsList(items) {
    try {
      const overlay = document.getElementById(OVERLAY_ID) || createOverlay();
      const ul = overlay.querySelector('.fsl-results');
      if (!ul) return;
      ul.innerHTML = '';

      STATE.tabs = items.map(n => n.item);
      STATE.focusedIndex = -1;

      if (!items.length) {
        const li = document.createElement('li');
        li.textContent = STATE.query ? 'No results' : 'No tabs available';
        li.style.color = 'rgba(255,255,255,0.6)';
        ul.appendChild(li);
        return;
      }

      for (let i = 0; i < items.length; i++) {
        const { item: t, matches } = items[i];
        const li = document.createElement('li');
        li.setAttribute('data-tab-id', String(t.id));
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');

        // small arrow indicator (hidden unless focused)
        const arrow = document.createElement('span');
        arrow.className = 'fsl-arrow';
        arrow.textContent = '▸';

        // favicon
        const img = document.createElement('img');
        img.className = 'fsl-fav';
        img.alt = '';
        img.decoding = 'async';

        // Helper: check if favicon URL is safe to load in a content page
        const isSafeFaviconUrl = (url) => {
          if (!url || typeof url !== 'string') return false;
          // Block chrome://, about://, resource:// and similar internal schemes
          if (/^(chrome|about|resource|moz-icon):/i.test(url)) return false;
          // Allow http(s) and data URIs; also allow extension's own moz-extension URLs
          if (/^(https?:|data:|moz-extension:)/i.test(url)) return true;
          return false;
        };
        const getDefaultIconUrl = () => {
          try {
            const api = (typeof browser !== 'undefined') ? browser : chrome;
            if (api && api.runtime && typeof api.runtime.getURL === 'function') {
              return api.runtime.getURL('icons/ic_search.svg');
            }
          } catch (_) {}
          return null;
        };

        // Prefer tabs API favicon; fallback to origin favicon.ico if available
        let favicon = t.favIconUrl;
        try {
          if (!favicon && t.url) {
            const u = new URL(t.url);
            if (u.origin && u.origin !== 'null' && /^https?:$/i.test(u.protocol)) {
              favicon = u.origin + '/favicon.ico';
            }
          }
        } catch (_) {}
        // If favicon is unsafe (e.g., chrome://mozapps/.../extension.svg), use default icon
        if (!isSafeFaviconUrl(favicon)) {
          favicon = getDefaultIconUrl();
        }
        if (favicon) img.src = favicon;
        img.addEventListener('error', () => { img.style.visibility = 'hidden'; });

        // title and url with highlight
        const titleSpan = document.createElement('span');
        titleSpan.className = 'fsl-title';
        const titleText = (t.title && t.title.trim()) ? t.title : (t.url || 'Untitled');
        if (STATE.query && matches && matches[0]) {
          const titleMatches = matches[0]
          titleSpan.appendChild(buildHighlightedSpan(titleText, titleMatches));
        } else {
          titleSpan.textContent = titleText;
        }

        const urlSpan = document.createElement('span');
        urlSpan.className = 'fsl-url';
        const urlText = t.url || '';
        if (STATE.query && matches && matches[1]) {
          const urlMatches = matches[1]
          urlSpan.appendChild(buildHighlightedSpan(urlText, urlMatches));
        } else {
          urlSpan.textContent = urlText;
        }

        li.appendChild(arrow);
        li.appendChild(img);
        li.appendChild(titleSpan);
        li.appendChild(urlSpan);

        // close (cross) button on the right
        const closeBtn = document.createElement('button');
        closeBtn.className = 'fsl-close';
        closeBtn.type = 'button';
        // SVG cross icon
        // Ensure the cross is visible by explicitly disabling fill and using rounded joins
        closeBtn.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3 L9 9 M9 3 L3 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
        // Tooltip with platform-specific hotkey
        const isMac = navigator.platform && /Mac/i.test(navigator.platform);
        closeBtn.title = isMac ? 'Ctrl+W' : 'Alt+W';
        // Prevent list item activation and focus changes on clicking cross
        const handleClose = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const tabId = t.id;
          if (typeof tabId !== 'number') return;
          try {
            const api = (typeof browser !== 'undefined') ? browser : chrome;
            api.runtime.sendMessage({ type: 'close-tab', tabId }, () => {
              try {
                // Remove li and update state similarly to keyboard path
                const currentUl = ul;
                li.remove();
                const remaining = Array.from(currentUl.querySelectorAll('li'));
                STATE.tabs = STATE.tabs.filter(tt => tt.id !== tabId);
                STATE.allTabs = STATE.allTabs.filter(tt => tt.id !== tabId);
                if (remaining.length > 0) {
                  const idx = Math.min(STATE.focusedIndex, remaining.length - 1);
                  STATE.focusedIndex = -1;
                  setFocusedIndex(idx);
                } else {
                  computeResultsAndRender();
                }
              } catch (_) {}
            });
          } catch (_) {}
        };
        closeBtn.addEventListener('click', handleClose);

        li.appendChild(closeBtn);

        // interactions: hover moves focus (only when mouse focus is enabled); click/mousedown activates
        li.addEventListener('mouseenter', () => {
          if (!STATE.allowMouseFocus) return;
          const idx = Array.prototype.indexOf.call(ul.children, li);
          setFocusedIndex(idx);
        });
        // Activate early on mousedown to avoid input blur closing the overlay before click fires
        li.addEventListener('mousedown', (ev) => {
          try {
            // Only react to primary button and ignore clicks on the close button
            if (ev.button !== 0) return;
            if (ev.target && ev.target.closest && ev.target.closest('.fsl-close')) return;
            ev.preventDefault();
            const tabId = t.id;
            if (tabId != null) activateTabById(tabId);
          } catch (_) {}
        });
        // Fallback activation on click (in case mousedown was prevented by the page)
        li.addEventListener('click', (ev) => {
          try {
            if (ev.target && ev.target.closest && ev.target.closest('.fsl-close')) return;
            ev.preventDefault();
            const tabId = t.id;
            if (tabId != null) activateTabById(tabId);
          } catch (_) {}
        });

        ul.appendChild(li);
      }
      // initialize focus to the first item
      setFocusedIndex(0);
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
            STATE.allTabs = resp.tabs.slice();
            computeResultsAndRender();
          } else {
            log('unexpected response for get-all-tabs', resp);
            STATE.allTabs = [];
            computeResultsAndRender();
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
    // On open, require a fresh mouse move to enable hover focusing
    STATE.allowMouseFocus = false;
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
    // Reset mouse focus state when closing
    STATE.allowMouseFocus = false;
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