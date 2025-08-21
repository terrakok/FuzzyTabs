(function() {
  const DEBUG = false;
  const log = (...args) => { if (!DEBUG) return; try { console.debug('[FuzzyTabs][content]', ...args); } catch (_) {} };
  log('content script loaded', { url: location.href });

  // State for results navigation
  const STATE = { allTabs: [], tabs: [], focusedIndex: -1, query: '', allowMouseFocus: false };

  function getUIElements() {
    const input = document.getElementById("fuzzy-tabs-input");
    const ul = document.querySelector('.fsl-results');
    return { input, ul };
  }

  function setFocusedIndex(newIndex) {
    const { ul } = getUIElements();
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
    const { ul } = getUIElements();
    const items = ul ? Array.from(ul.querySelectorAll('li')) : [];
    if (!items.length) return;
    const next = STATE.focusedIndex < 0 ? 0 : STATE.focusedIndex + delta;
    setFocusedIndex(next);
  }

  function activateTabById(tabId) {
    try {
      const api = (typeof browser !== 'undefined') ? browser : chrome;
      api.runtime.sendMessage({ type: 'activate-tab', tabId }, (resp) => {
        // On success, close window (extension page) or overlay otherwise
        if (resp && resp.ok) {
          closeExtensionWindow();
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
    const { ul, input } = getUIElements();
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

  function renderTabsList(items) {
    try {
      const { ul } = getUIElements();
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

  function initApp() {
    log('initApp');
    // On open, require a fresh mouse move to enable hover focusing
    STATE.allowMouseFocus = false;
    const { input } = getUIElements();
    if (input) {
      log('focusing input');
      input.value = '';
      setTimeout(() => input.focus(), 50);
      input.addEventListener('input', () => computeResultsAndRender());
    }

    // Enable mouse-driven focusing after actual mouse movement
    document.addEventListener('mousemove', () => {
      STATE.allowMouseFocus = true;
    }, true);

    // Keyboard handling on the app page
    document.addEventListener('keydown', (e) => {
      // Any key press disables mouse-driven focusing until the mouse moves again
      STATE.allowMouseFocus = false;
      if (e.key === 'Escape') {
        log('Escape pressed, closing');
        e.preventDefault();
        closeExtensionWindow();
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
        const { ul } = getUIElements();
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
        const { ul } = getUIElements();
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
      }
    }, true);

    // Load tabs list under the input
    fetchAllTabsAndRender();
  }

  // Close the extension window
  function closeExtensionWindow() {
    try { window.close(); } catch (_) {}
  }

  initApp();
})();