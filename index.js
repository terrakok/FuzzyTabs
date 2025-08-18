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