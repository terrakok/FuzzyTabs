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

  // --- Fuzzy search helpers ---
  function isWordBoundary(prevChar) {
    const sepRe = /[\s\-_.\/\\()\[\]{}<>\"'`~!@#$%^&*+=|,:;?]/;
    return !prevChar || sepRe.test(prevChar);
  }

  function fuzzyMatch(query, candidate) {
    if (!query) return { matched: true, score: 0, indexes: [] };
    if (!candidate) return { matched: false, score: -Infinity, indexes: [] };
    const q = query.toLowerCase();
    const s = candidate.toLowerCase();
    let qi = 0;
    let score = 0;
    const idx = [];
    let lastMatchPos = -1;
    let streak = 0;
    for (let si = 0; si < s.length && qi < q.length; si++) {
      if (s[si] === q[qi]) {
        idx.push(si);
        // Base point
        score += 1;
        // Consecutive bonus
        if (lastMatchPos === si - 1) {
          streak += 1;
          score += 0.5 + Math.min(streak * 0.05, 0.3);
        } else {
          streak = 0;
        }
        // Word boundary / start bonus
        const prev = si > 0 ? candidate[si - 1] : '';
        if (isWordBoundary(prev)) score += 0.7;
        // Early position bonus
        score += Math.max(0, 1.2 - si * 0.01);
        lastMatchPos = si;
        qi++;
      }
    }
    const matched = qi === q.length;
    if (!matched) return { matched: false, score: -Infinity, indexes: [] };
    // Prefer shorter gaps (compactness)
    if (idx.length > 1) {
      let gaps = 0;
      for (let i = 1; i < idx.length; i++) gaps += idx[i] - idx[i - 1] - 1;
      score -= gaps * 0.02;
    }
    return { matched: true, score, indexes: idx };
  }

  function rangesFromIndexes(indexes) {
    if (!indexes || !indexes.length) return [];
    const ranges = [];
    let start = indexes[0];
    let prev = indexes[0];
    for (let i = 1; i < indexes.length; i++) {
      if (indexes[i] === prev + 1) {
        prev = indexes[i];
      } else {
        ranges.push([start, prev + 1]);
        start = indexes[i];
        prev = indexes[i];
      }
    }
    ranges.push([start, prev + 1]);
    return ranges;
  }

  function buildHighlightedSpan(text, indexes) {
    const ranges = rangesFromIndexes(indexes);
    const span = document.createElement('span');
    let pos = 0;
    for (const [a, b] of ranges) {
      if (a > pos) span.appendChild(document.createTextNode(text.slice(pos, a)));
      const mark = document.createElement('span');
      mark.className = 'fsl-hl';
      mark.textContent = text.slice(a, b);
      span.appendChild(mark);
      pos = b;
    }
    if (pos < text.length) span.appendChild(document.createTextNode(text.slice(pos)));
    return span;
  }

  function scoreTab(query, tab) {
    const title = (tab.title && tab.title.trim()) ? tab.title : '';
    const url = tab.url || '';
    const mt = fuzzyMatch(query, title);
    const mu = fuzzyMatch(query, url);
    // Weight title higher than URL
    let score = (mt.matched ? mt.score * 2.2 : -Infinity);
    let titleIdx = mt.matched ? mt.indexes : [];
    let urlIdx = [];
    if (mu.matched) {
      const urlScore = mu.score * 1.2;
      if (!mt.matched) {
        score = urlScore;
        urlIdx = mu.indexes;
      } else {
        // If both match, combine a bit and keep title highlight, but also keep URL indexes
        score = Math.max(score, urlScore) + 0.2; // small combo bonus
        urlIdx = mu.indexes;
      }
    }
    // Active tab small boost
    if (tab.active) score += 0.15;
    return { score, titleIdx, urlIdx, matched: (mt.matched || mu.matched) };
  }

  function computeResultsAndRender() {
    const { ul, input } = getOverlayElements();
    if (!ul) return;
    const q = (input && input.value || '').trim();
    STATE.query = q;
    if (!q) {
      // No query: show all tabs in original order
      renderTabsList(STATE.allTabs.map(t => ({ tab: t }))); 
      return;
    }
    const results = [];
    for (const t of STATE.allTabs) {
      const r = scoreTab(q, t);
      if (r.matched) results.push({ tab: t, score: r.score, titleIdx: r.titleIdx, urlIdx: r.urlIdx });
    }
    results.sort((a, b) => b.score - a.score);
    renderTabsList(results);
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

      // Normalize items to { tab, titleIdx?, urlIdx? }
      const normalized = (Array.isArray(items) ? items : []).map(it => {
        if (it && it.tab) return it;
        return { tab: it };
      });

      STATE.tabs = normalized.map(n => n.tab);
      STATE.focusedIndex = -1;

      if (!normalized.length) {
        const li = document.createElement('li');
        li.textContent = STATE.query ? 'No results' : 'No tabs available';
        li.style.color = 'rgba(255,255,255,0.6)';
        ul.appendChild(li);
        return;
      }

      for (let i = 0; i < normalized.length; i++) {
        const { tab: t, titleIdx, urlIdx } = normalized[i];
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
        if (STATE.query && titleIdx && titleIdx.length) {
          titleSpan.appendChild(buildHighlightedSpan(titleText, titleIdx));
        } else {
          titleSpan.textContent = titleText;
        }

        const urlSpan = document.createElement('span');
        urlSpan.className = 'fsl-url';
        const urlText = t.url || '';
        if (STATE.query && urlIdx && urlIdx.length) {
          urlSpan.appendChild(buildHighlightedSpan(urlText, urlIdx));
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

        // interactions: hover moves focus (only when mouse focus is enabled); click activates
        li.addEventListener('mouseenter', () => {
          if (!STATE.allowMouseFocus) return;
          const idx = Array.prototype.indexOf.call(ul.children, li);
          setFocusedIndex(idx);
        });
        li.addEventListener('click', (ev) => {
          ev.preventDefault();
          const tabId = t.id;
          if (tabId != null) activateTabById(tabId);
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