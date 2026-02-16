(() => {
  const DEBUG_FINDCLOSE = false;

  const DEFAULT_SETTINGS = {
    isFindCloseEnabled: false,
  };
  let config = { ...DEFAULT_SETTINGS };

  const IS_TOP_FRAME = window === window.top;

  const BUTTON_CLASS_NAME = 'findclose-btn';
  const ACTIVE_CLASS_NAME = 'findclose-active';
  const FINDCLOSE_INLINE_STYLE_ID = 'findclose-inline-style';
  
  const SHAKER_THRESHOLD = 80;
  const SHAKER_TIMEOUT = 2500;
  const MOUSE_SHAKE_WINDOW_MS = 800;
  const MOUSE_SHAKE_TIMEOUT_SMALL = 2000;
  const MOUSE_SHAKE_TIMEOUT_MEDIUM = 2500;
  const MOUSE_SHAKE_TIMEOUT_LARGE = 3000;
  const MOUSE_SHAKE_DIAGONAL_MEDIUM = 2200;
  const MOUSE_SHAKE_DIAGONAL_LARGE = 2800;
  const MOUSE_SHAKE_MIN_DIRECTION_CHANGES = 3;
  const MOUSE_SHAKE_MIN_TOTAL_DISTANCE = 420;
  const MOUSE_SHAKE_MIN_SEGMENT_DELTA = 14;
  const MOUSE_SHAKE_MIN_SPEED = 1200;

  const isIPadOS = () => navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isIOS = /iPhone|iPod/.test(navigator.userAgent);
  const isMacOS = () => navigator.platform.includes('Mac') && !isIPadOS();

  const CSS_FILE_PATH = '/findclose-ext.css';
  const CSS_DURATION_PROPERTY = '--fc-duration';
  const CSS_DURATION_VALUE = '0.3s';
  const FINDCLOSE_EXT_CSS = `
      :root { ${CSS_DURATION_PROPERTY}: ${CSS_DURATION_VALUE}; }

      .findclose-btn {
        transition: transform var(--fc-duration) cubic-bezier(0.175, 0.885, 0.32, 1.275),
                    box-shadow var(--fc-duration) ease,
                    background-color var(--fc-duration) ease !important;
        transform-origin: center center !important;
      }

      @keyframes rotate { to { --angle: 360deg; } }

      @property --angle {
        syntax: "<angle>";
        initial-value: 0deg;
        inherits: false;
      }

      .findclose-active {
        transform: scale(1.5) !important;
        --angle: 0deg;
        animation: rotate 3.5s linear infinite;
        z-index: 2147483647 !important;
        box-shadow: 0 0 10px rgb(0 0 0/0.5) !important;
        border-radius: 15px !important;
        min-width: 60px !important;
        min-height: 60px !important;
        padding: 5px;
        cursor: pointer !important;
        pointer-events: auto !important;
        touch-action: manipulation !important;
        border: 5px solid transparent !important;
        background:
          linear-gradient(rgb(255 255 255/0.9), rgb(255 255 255/0.9)) padding-box,
          conic-gradient(
            from var(--angle),
            #ff3366, #ffcc33, #33ff99, #3366ff, #cc33ff, #ff3366
          ) border-box !important;
          color: black;

        display: flex !important;
        justify-content: center !important;
        align-items: center !important;
      }

      @media (prefers-color-scheme: dark) {
        .findclose-active {
          background:
            linear-gradient(rgb(0 0 0/0.9), rgb(0 0 0/0.9)) padding-box,
            conic-gradient(
              from var(--angle),
              #ff3366, #ffcc33, #33ff99, #3366ff, #cc33ff, #ff3366
            ) border-box !important;
          color: white;
          box-shadow: 0 0 10px rgb(255 255 255/0.5) !important;
        }
      }
    `;
  // ========================================
  // Close button detection
  // ========================================
  const CLOSE_SYMBOL_PATTERN = new RegExp("[\\u2715\\u00D7\\u2716\\u2573\\u2717\\u2718\\u274C]");
  const CLOSE_SYMBOL_GLOBAL_PATTERN = new RegExp("[\\u2715\\u00D7\\u2716\\u2573\\u2717\\u2718\\u274C]", "g");
  const PSEUDO_CLOSE_SYMBOL_PATTERN = new RegExp("^[\"']?\\s*(?:[\\u2715\\u00D7\\u2716\\u2573\\u2717\\u2718\\u274C\\u0078\\u0058]|\\\\00d7|\\\\2715|\\\\2716)\\s*[\"']?$");
  const WRAPPER_ONLY_PATTERN = new RegExp("^[\\s\"'`()[\\]{}<>\\u300C\\u300D\\u300E\\u300F\\u3010\\u3011.,:;|/\\\\+-]*$");

  const STRONG_CLOSE_TEXT_PATTERNS = [
    /\b(close|close ad|dismiss|dismiss ad|cancel|skip ad|luk|lukke|annuller|schließen|abbrechen|cerrar|cancelar|sulje|peruuta|fermer|annuler|tutup|batal|chiudi|annulla|lukk|avbryt|sluiten|annuleren|fechar|stäng|kapat|iptal)\b/i,
    /閉じる|とじる|キャンセル|关闭|取消|關閉|닫기|취소|إغلاق|إلغاء|סגור|ביטול|बंद करें|रद्द करें|ยกเลิก/,
    /закрыть|отмена|закрити|скасувати|κλείσιμο|κλείσε|ακύρωση/i,
    /(?:zavřít|zrušit|tanca|tancar|cancel·la|bezár|mégse|zatvori|odustani|zamknij|anuluj|închide|anulează|zavrieť|zrušiť|đóng|hủy)/i
  ];

  // Weak signals are only accepted with ad-oriented context (small/corner/ad-container).
  const WEAK_CLOSE_TEXT_PATTERNS = [
    /閉|关|關|닫다|غلق|बंद|रद्द|ปิด/
  ];

  const ATTR_CLOSE_KEYWORDS = new Set([
    'close', 'closead', 'closebtn', 'closebutton', 'closeicon', 'closemark',
    'btnclose', 'iconclose', 'dismiss', 'cancel', 'modalclose', 'popupclose',
    'adclose', 'xclose', 'btnx', 'batsu',
  ]);

  const AD_CONTEXT_KEYWORDS = new Set([
    'ad', 'ads', 'adslot', 'advert', 'advertisement', 'banner', 'sponsor',
    'sponsored', 'interstitial', 'promo', 'popup', 'overlay', 'modal'
  ]);

  const AD_FRAME_HOST_KEYWORDS = [
    'doubleclick', 'googlesyndication', 'googletagservices', 'adservice',
    'amazon-adsystem', 'adnxs', 'adsrvr', 'taboola', 'outbrain', 'criteo',
    'pubmatic', 'rubiconproject'
  ];

  const isAdLikeToken = (token) => (
    AD_CONTEXT_KEYWORDS.has(token) ||
    /^(ad|ads|adx|adslot|adunit|adframe|adbox|adwrap|adwrapper)$/.test(token)
  );

  const tokenizeAscii = (value) => {
    const normalized = String(value || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase();

    return normalized
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  };

  const getOwnerWindow = (el) => el?.ownerDocument?.defaultView || window;

  const querySelectorAllDeep = (selector, startRoot = document) => {
    if (!selector) return [];

    const rootsToVisit = [startRoot];
    const visitedRoots = new Set();
    const results = new Set();

    while (rootsToVisit.length > 0) {
      const root = rootsToVisit.pop();
      if (!root || visitedRoots.has(root)) continue;
      visitedRoots.add(root);

      root.querySelectorAll(selector).forEach((el) => results.add(el));

      root.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) {
          rootsToVisit.push(el.shadowRoot);
        }
      });
    }

    return Array.from(results);
  };

  const collectSearchRoots = (startRoot = document) => {
    const roots = [];
    const queue = [startRoot];
    const visited = new Set();

    while (queue.length > 0) {
      const root = queue.shift();
      if (!root || visited.has(root)) continue;
      visited.add(root);
      roots.push(root);

      const iframes = querySelectorAllDeep('iframe', root);
      iframes.forEach((iframe) => {
        try {
          const childDoc = iframe.contentDocument;
          if (childDoc && !visited.has(childDoc)) {
            queue.push(childDoc);
          }
        } catch (error) {
          // cross-origin iframe
        }
      });
    }

    return roots;
  };

  const collectTextCandidates = (el) => {
    const ownerDoc = el?.ownerDocument || document;
    const labelTargets = (el.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .map(id => id.trim())
      .filter(Boolean)
      .map(id => ownerDoc.getElementById(id)?.textContent || '');

    return [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('alt'),
      el.getAttribute('value'),
      el.getAttribute('name'),
      el.innerText,
      el.textContent,
      ...labelTargets
    ].filter(s => typeof s === 'string' && s.trim() !== '');
  };

  const getTextSignals = (el) => {
    const textCandidates = collectTextCandidates(el);
    const combinedText = textCandidates.join(' ');
    const hasStandaloneCloseSymbol = textCandidates.some((raw) => {
      const compactText = String(raw || '').replace(/\s+/g, '');
      if (!compactText) return false;
      const matchedSymbols = compactText.match(CLOSE_SYMBOL_GLOBAL_PATTERN) || [];
      if (matchedSymbols.length !== 1) return false;
      const stripped = compactText.replace(CLOSE_SYMBOL_GLOBAL_PATTERN, '');
      return stripped === '' || WRAPPER_ONLY_PATTERN.test(stripped);
    });

    return {
      hasSymbol: hasStandaloneCloseSymbol,
      hasStrongCloseText: STRONG_CLOSE_TEXT_PATTERNS.some(pattern => pattern.test(combinedText)),
      hasWeakCloseText: WEAK_CLOSE_TEXT_PATTERNS.some(pattern => pattern.test(combinedText)),
    };
  };

  const getAttributeSignals = (el) => {
    if (!el) {
      return { hasCloseToken: false, hasAdToken: false };
    }

    const raw = [
      el.id,
      typeof el.className === 'string' ? el.className : '',
      el.getAttribute('class'),
      el.getAttribute('name'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-test'),
      el.getAttribute('data-zone'),
      el.getAttribute('data-dismiss'),
      el.getAttribute('data-close')
    ].join(' ');

    const tokens = tokenizeAscii(raw);

    return {
      hasCloseToken: tokens.some(token => ATTR_CLOSE_KEYWORDS.has(token) || token.startsWith('close')),
      hasAdToken: tokens.some(token => isAdLikeToken(token)),
    };
  };

  const hasPseudoCloseGlyph = (el) => {
    const ownerWindow = getOwnerWindow(el);
    const pseudoCheck = (pseudoType) => {
      const style = ownerWindow.getComputedStyle(el, pseudoType);
      const content = style.content;
      if (!content || content === 'none' || content === 'normal') return false;
      return PSEUDO_CLOSE_SYMBOL_PATTERN.test(content);
    };

    return pseudoCheck('::before') || pseudoCheck('::after');
  };

  const containsInlineSVG = (el) => {
    if (!el) return false;
    if (el.tagName === 'SVG') return true;
    return !!el.querySelector?.('svg');
  };

  const hasMeaningfulTextContent = (el) => {
    // Reuse existing text candidate collection; it already filters empty strings
    const candidates = collectTextCandidates(el);
    return candidates.length > 0;
  };

  const isElementVisible = (el) => {
    if (!el || !el.isConnected) return false;

    const ownerWindow = getOwnerWindow(el);
    const style = ownerWindow.getComputedStyle(el);
    const opacity = Number.parseFloat(style.opacity || '1');
    // Visibility and interactivity are evaluated separately.
    if (style.display === 'none' || style.visibility === 'hidden' || opacity <= 0.02) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) {
      // Some ad overlays render the close mark only via pseudo element on an empty span.
      if (!hasPseudoCloseGlyph(el)) return false;
    }

    const viewportPadding = 8;
    const intersectsViewport =
      rect.bottom >= -viewportPadding &&
      rect.right >= -viewportPadding &&
      rect.top <= ownerWindow.innerHeight + viewportPadding &&
      rect.left <= ownerWindow.innerWidth + viewportPadding;

    return intersectsViewport;
  };

  const isLikelyClickable = (el) => {
    const tagName = el.tagName;
    if (tagName === 'BUTTON' || tagName === 'A' || tagName === 'INPUT') return true;
    if (el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link') return true;
    if (typeof el.onclick === 'function') return true;
    if (el.tabIndex >= 0) return true;
    if (el.hasAttribute('data-dismiss') || el.hasAttribute('data-close')) return true;

    const ownerWindow = getOwnerWindow(el);
    const style = ownerWindow.getComputedStyle(el);
    return style.cursor === 'pointer';
  };

  const isCompactTarget = (rect) => rect.width <= 72 && rect.height <= 72;

  const isNearViewportTopRight = (el, rect) => {
    const ownerWindow = getOwnerWindow(el);
    const rightMargin = Math.max(40, Math.min(220, ownerWindow.innerWidth * 0.22));
    const topMargin = Math.max(40, Math.min(220, ownerWindow.innerHeight * 0.25));

    return (
      rect.right >= ownerWindow.innerWidth - rightMargin &&
      rect.right <= ownerWindow.innerWidth + 8 &&
      rect.top >= -8 &&
      rect.top <= topMargin
    );
  };

  const isNearViewportTopLeft = (el, rect) => {
    const ownerWindow = getOwnerWindow(el);
    const leftMargin = Math.max(40, Math.min(220, ownerWindow.innerWidth * 0.22));
    const topMargin = Math.max(40, Math.min(220, ownerWindow.innerHeight * 0.25));

    return (
      rect.left >= -8 &&
      rect.left <= leftMargin &&
      rect.top >= -8 &&
      rect.top <= topMargin
    );
  };

  const isNearContainerTopRight = (el, rect) => {
    const parent = el.parentElement;
    if (!parent) return false;

    const parentRect = parent.getBoundingClientRect();
    if (parentRect.width < 32 || parentRect.height < 32) return false;

    const horizontalTolerance = Math.max(8, Math.min(32, parentRect.width * 0.18));
    const verticalTolerance = Math.max(8, Math.min(32, parentRect.height * 0.18));

    return (
      Math.abs(parentRect.right - rect.right) <= horizontalTolerance &&
      Math.abs(rect.top - parentRect.top) <= verticalTolerance
    );
  };

  const isNearContainerTopLeft = (el, rect) => {
    const parent = el.parentElement;
    if (!parent) return false;

    const parentRect = parent.getBoundingClientRect();
    if (parentRect.width < 32 || parentRect.height < 32) return false;

    const horizontalTolerance = Math.max(8, Math.min(32, parentRect.width * 0.18));
    const verticalTolerance = Math.max(8, Math.min(32, parentRect.height * 0.18));

    return (
      Math.abs(rect.left - parentRect.left) <= horizontalTolerance &&
      Math.abs(rect.top - parentRect.top) <= verticalTolerance
    );
  };

  const isLikelyAdFrame = AD_FRAME_HOST_KEYWORDS.some(keyword => window.location.hostname.includes(keyword));

  const isLikelyAdContext = (el) => {
    const ownerHostname = el?.ownerDocument?.location?.hostname || '';
    if (isLikelyAdFrame || AD_FRAME_HOST_KEYWORDS.some(keyword => ownerHostname.includes(keyword))) return true;

    let node = el;
    let depth = 0;
    while (node && depth < 6) {
      const raw = [
        node.id,
        typeof node.className === 'string' ? node.className : '',
        node.getAttribute?.('class'),
        node.getAttribute?.('aria-label'),
        node.getAttribute?.('role'),
        node.getAttribute?.('data-testid'),
        node.getAttribute?.('data-ad'),
      ].join(' ');

      const tokens = tokenizeAscii(raw);
      if (tokens.some(token => isAdLikeToken(token))) {
        return true;
      }

      node = node.parentElement;
      depth += 1;
    }

    return false;
  };

  const getCandidateMeta = (el) => {
    const rect = el.getBoundingClientRect();
    const textSignals = getTextSignals(el);
    const attrSignals = getAttributeSignals(el);
    const pseudoGlyph = hasPseudoCloseGlyph(el);
    const adContext = isLikelyAdContext(el);
    const compactTarget = isCompactTarget(rect);
    const cornerLike =
      isNearViewportTopRight(el, rect) ||
      isNearViewportTopLeft(el, rect) ||
      isNearContainerTopRight(el, rect) ||
      isNearContainerTopLeft(el, rect);
    const clickable = isLikelyClickable(el);

    const graphicOnly = containsInlineSVG(el) && !hasMeaningfulTextContent(el);

    const directCloseSignal =
      textSignals.hasStrongCloseText ||
      textSignals.hasSymbol ||
      attrSignals.hasCloseToken ||
      pseudoGlyph;

    const weakAdCloseSignal =
      textSignals.hasWeakCloseText &&
      (adContext || compactTarget || cornerLike || attrSignals.hasAdToken);

    const pseudoAdCloseProxy =
      !clickable &&
      adContext &&
      compactTarget &&
      (attrSignals.hasCloseToken || pseudoGlyph);

    const cornerCloseProxy =
      !clickable &&
      compactTarget &&
      cornerLike &&
      (attrSignals.hasCloseToken || pseudoGlyph || textSignals.hasStrongCloseText || textSignals.hasSymbol);

    const graphicCornerProxy =
      clickable &&
      compactTarget &&
      cornerLike &&
      graphicOnly &&
      (adContext || attrSignals.hasAdToken);

    const graphicAdProxy =
      clickable &&
      compactTarget &&
      graphicOnly &&
      adContext;

    const isValid =
      (clickable || pseudoAdCloseProxy || cornerCloseProxy || graphicCornerProxy || graphicAdProxy) &&
      (directCloseSignal || weakAdCloseSignal || graphicCornerProxy || graphicAdProxy);

    let priority = 0;
    if (textSignals.hasStrongCloseText) priority += 4;
    if (textSignals.hasSymbol || pseudoGlyph) priority += 3;
    if (attrSignals.hasCloseToken) priority += 2;
    if (adContext) priority += 3;
    if (compactTarget) priority += 2;
    if (cornerLike) priority += 1;
    if (cornerCloseProxy) priority += 2;
    if (weakAdCloseSignal) priority += 2;
    if (graphicOnly) priority += 2;
    if (graphicCornerProxy) priority += 2;
    if (graphicAdProxy) priority += 2;

    return {
      isValid,
      priority,
      compactTarget,
      adContext,
      cornerLike,
      graphicOnly,
      graphicAdProxy,
    };
  };

  const findCloseButtons = () => {
    const baseSelectors = [
      'button',
      'a',
      'input[type="button"]',
      'input[type="image"]',
      'input[type="submit"]',
      '[role="button"]',
      '[onclick]',
      '[tabindex]',
      '[id="batsu"]',
      // fallback
      '[class*="close" i]',
      '[class*="dismiss" i]',
      '[class*="cancel" i]',
      '[id*="close" i]',
      '[id*="dismiss" i]',
      '[id*="cancel" i]',
      '[aria-label*="close" i]',
      '[aria-label*="dismiss" i]',
      '[title*="close" i]',
      '[data-zone*="close" i]',
      '[data-dismiss]',
      '[data-close]'
    ];

    const selector = baseSelectors.join(',');
    const candidates = Array.from(new Set(
      collectSearchRoots(document)
        .flatMap(root => querySelectorAllDeep(selector, root))
    ));
    const validButtons = candidates
      .filter(isElementVisible)
      .map(el => ({ el, meta: getCandidateMeta(el) }))
      .filter(({ meta }) => meta.isValid);

    const finalTargets = [];

    validButtons.sort((a, b) => {
      if (a.meta.priority !== b.meta.priority) {
        return b.meta.priority - a.meta.priority;
      }

      if (a.meta.adContext !== b.meta.adContext) {
        return Number(b.meta.adContext) - Number(a.meta.adContext);
      }

      if (a.meta.compactTarget !== b.meta.compactTarget) {
        return Number(b.meta.compactTarget) - Number(a.meta.compactTarget);
      }

      if (a.meta.cornerLike !== b.meta.cornerLike) {
        return Number(b.meta.cornerLike) - Number(a.meta.cornerLike);
      }

      const tagScore = (el) => {
        if (el.tagName === 'BUTTON') return 6;
        if (el.getAttribute('role') === 'button') return 6;
        if (el.tagName === 'A') return 3;
        return 1;
      };
      return tagScore(b.el) - tagScore(a.el);
    });

    validButtons.forEach(({ el }) => {
      const isChildOfSelected = finalTargets.some(target => target.contains(el));
      const containsSelected = finalTargets.some(target => el.contains(target));

      if (!isChildOfSelected && !containsSelected) {
        finalTargets.push(el);
      }
    });

    return finalTargets;
  };

  // ========================================
  // Shake detection
  // ========================================
  class ShakeDetector {
    constructor(options = {}) {
      this.threshold = options.threshold || 100; // 60-100-120
      this.timeout = options.timeout || 1000;
      this.onShakeStart = options.onShakeStart || (() => {});
      this.onShakeEnd = options.onShakeEnd || (() => {});
      this.onShakeDocument = options.onShakeDocument || (() => {});

      this.lastTime = 0;
      this.lastX = null;
      this.lastY = null;
      this.lastZ = null;

      this.isShaking = false;
      this.stopTimer = null;
      this.started = false;

      this.handleMotion = this.handleMotion.bind(this);
    }

    async start() {
      if (this.started) return true;
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
          const permissionState = await DeviceMotionEvent.requestPermission();
          if (permissionState === 'granted') {
            if (this.started) return true;
            this.started = true;
            window.addEventListener('devicemotion', this.handleMotion, { capture: true });
            this.onShakeDocument();
            return true;
          } else {
            console.warn('Deny DeviceMotionEvent Permission.');
          }
          return false;
        } catch (error) {
          return false;
        }
      } else {
        this.started = true;
        window.addEventListener('devicemotion', this.handleMotion, { capture: true });
        return true;
      }
    }

    stop() {
      window.removeEventListener('devicemotion', this.handleMotion, { capture: true });
      this.started = false;
    }

    handleMotion(event) {
      const current = event.accelerationIncludingGravity;
      if (!current) return;

      const currentTime = Date.now();
      if ((currentTime - this.lastTime) < 100) return;

      const diffTime = currentTime - this.lastTime;
      this.lastTime = currentTime;

      if (this.lastX === null) {
        this.lastX = current.x;
        this.lastY = current.y;
        this.lastZ = current.z;
        return;
      }

      const speed = Math.abs(current.x + current.y + current.z - this.lastX - this.lastY - this.lastZ) / diffTime * 1000;

      if (speed > this.threshold) {
        if (!this.isShaking) {
          this.isShaking = true;
          this.onShakeStart();
        }

        if (this.stopTimer) clearTimeout(this.stopTimer);

        this.stopTimer = setTimeout(() => {
          this.isShaking = false;
          this.onShakeEnd();
        }, this.timeout);
      }

      this.lastX = current.x;
      this.lastY = current.y;
      this.lastZ = current.z;
    }
  };

  class MouseShakeDetector {
    constructor(options = {}) {
      this.windowMs = options.windowMs || 450;
      this.timeout = options.timeout || 1200;
      this.minDirectionChanges = options.minDirectionChanges || 3;
      this.minTotalDistance = options.minTotalDistance || 420;
      this.minSegmentDelta = options.minSegmentDelta || 14;
      this.minSpeed = options.minSpeed || 1200;
      this.onShakeStart = options.onShakeStart || (() => {});
      this.onShakeEnd = options.onShakeEnd || (() => {});

      this.points = [];
      this.isShaking = false;
      this.stopTimer = null;
      this.started = false;

      this.handlePointerMove = this.handlePointerMove.bind(this);
    }

    async start() {
      if (typeof PointerEvent === 'undefined') return false;
      if (this.started) return true;
      this.started = true;
      window.addEventListener('pointermove', this.handlePointerMove, { capture: true, passive: true });
      return true;
    }

    stop() {
      window.removeEventListener('pointermove', this.handlePointerMove, { capture: true });
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }
      this.isShaking = false;
      this.points = [];
      this.started = false;
    }

    updateTimeout(nextTimeout) {
      this.timeout = nextTimeout;
    }

    hold() {
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }
    }

    release() {
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }
      if (!this.isShaking) return;
      this.isShaking = false;
      this.onShakeEnd();
    }

    hasShakePattern() {
      if (this.points.length < 3) return false;

      let directionChanges = 0;
      let totalDistance = 0;
      let prevDirection = 0;
      const firstPoint = this.points[0];
      const lastPoint = this.points[this.points.length - 1];
      const duration = lastPoint.t - firstPoint.t;
      if (duration <= 0) return false;

      for (let i = 1; i < this.points.length; i += 1) {
        const prev = this.points[i - 1];
        const current = this.points[i];
        const dx = current.x - prev.x;
        const dy = current.y - prev.y;
        totalDistance += Math.hypot(dx, dy);

        const dominantDelta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
        if (Math.abs(dominantDelta) < this.minSegmentDelta) continue;

        const direction = dominantDelta > 0 ? 1 : -1;
        if (prevDirection !== 0 && direction !== prevDirection) {
          directionChanges += 1;
        }
        prevDirection = direction;
      }

      const speed = (totalDistance / duration) * 1000;
      return (
        directionChanges >= this.minDirectionChanges &&
        totalDistance >= this.minTotalDistance &&
        speed >= this.minSpeed
      );
    }

    handlePointerMove(event) {
      if (event.pointerType && event.pointerType !== 'mouse') return;

      const now = Date.now();
      this.points.push({
        x: event.clientX,
        y: event.clientY,
        t: now,
      });

      while (this.points.length > 0 && (now - this.points[0].t) > this.windowMs) {
        this.points.shift();
      }

      if (!this.hasShakePattern()) return;

      if (!this.isShaking) {
        this.isShaking = true;
        this.onShakeStart();
      }

      if (this.stopTimer) clearTimeout(this.stopTimer);
      this.stopTimer = setTimeout(() => {
        this.isShaking = false;
        this.onShakeEnd();
      }, this.timeout);
    }
  };

  let activeElements = []; // for cache
  const activeElementHoverHandlers = new WeakMap();
  let pendingHoverReleaseTimer = null;

  const hasFindCloseStylesheet = (ownerDocument = document) => {
    if (!ownerDocument) return false;

    const fromHref = Array.from(ownerDocument.styleSheets || []).some((sheet) => {
      const href = sheet?.href || '';
      return href.includes(CSS_FILE_PATH);
    });

    if (fromHref) return true;

    const ownerWindow = ownerDocument.defaultView || window;
    const docRoot = ownerDocument.documentElement;
    if (!docRoot) return false;
    const cssVar = ownerWindow.getComputedStyle(docRoot).getPropertyValue(CSS_DURATION_PROPERTY).trim();
    return cssVar === CSS_DURATION_VALUE;
  };

  const ensureFindCloseStyles = (ownerDocument = document) => {
    if (!ownerDocument) return false;
    if (hasFindCloseStylesheet(ownerDocument)) return true;

    if (ownerDocument.getElementById(FINDCLOSE_INLINE_STYLE_ID)) return true;

    const styleEl = ownerDocument.createElement('style');
    styleEl.id = FINDCLOSE_INLINE_STYLE_ID;
    styleEl.textContent = FINDCLOSE_EXT_CSS;

    const styleParent = ownerDocument.head || ownerDocument.documentElement || ownerDocument.body;
    if (!styleParent) return false;

    styleParent.appendChild(styleEl);
    return true;
  };

  const toElementBrief = (el) => ({
    tag: el.tagName,
    id: el.id || '',
    cls: typeof el.className === 'string' ? el.className : '',
    role: el.getAttribute('role') || '',
  });

  const shouldUseMouseHoverHold = () => shaker instanceof MouseShakeDetector;

  const isAnyActiveElementHovered = () => activeElements.some((el) => (
    el?.isConnected &&
    el.classList.contains(ACTIVE_CLASS_NAME) &&
    typeof el.matches === 'function' &&
    el.matches(':hover')
  ));

  const cancelPendingHoverRelease = () => {
    if (!pendingHoverReleaseTimer) return;
    clearTimeout(pendingHoverReleaseTimer);
    pendingHoverReleaseTimer = null;
  };

  const scheduleHoverRelease = () => {
    if (!shouldUseMouseHoverHold()) return;
    cancelPendingHoverRelease();
    pendingHoverReleaseTimer = setTimeout(() => {
      pendingHoverReleaseTimer = null;
      if (isAnyActiveElementHovered()) return;
      shaker.release();
    }, 0);
  };

  const attachHoverHandlers = (el) => {
    if (!shouldUseMouseHoverHold() || activeElementHoverHandlers.has(el)) return;

    const handlePointerEnter = () => {
      cancelPendingHoverRelease();
      shaker.hold();
    };
    const handlePointerLeave = () => {
      scheduleHoverRelease();
    };

    el.addEventListener('pointerenter', handlePointerEnter);
    el.addEventListener('pointerleave', handlePointerLeave);
    activeElementHoverHandlers.set(el, { handlePointerEnter, handlePointerLeave });
  };

  const detachHoverHandlers = (el) => {
    const handlers = activeElementHoverHandlers.get(el);
    if (!handlers) return;
    el.removeEventListener('pointerenter', handlers.handlePointerEnter);
    el.removeEventListener('pointerleave', handlers.handlePointerLeave);
    activeElementHoverHandlers.delete(el);
  };

  const runCloseButtonScan = (source = 'manual') => {
    const prevActiveElements = activeElements;
    activeElements = activeElements.filter(el => el?.isConnected);
    prevActiveElements.forEach((el) => {
      if (!el?.isConnected) {
        detachHoverHandlers(el);
      }
    });

    const closeButtons = findCloseButtons();
    const shouldCollectDebugDetails = DEBUG_FINDCLOSE;
    const ownerDocs = Array.from(new Set(
      closeButtons
        .map(el => el?.ownerDocument)
        .filter(Boolean)
    ));
    const styleReady = ownerDocs.length === 0
      ? hasFindCloseStylesheet(document)
      : ownerDocs.every((doc) => ensureFindCloseStyles(doc));
    const existing = new Set(activeElements);
    const closeButtonBriefs = shouldCollectDebugDetails ? closeButtons.map(toElementBrief) : [];
    let addedCount = 0;
    const addedElements = [];
    if (DEBUG_FINDCLOSE && closeButtons.length > 0) {
      console.debug('[FindClose][scan]', {
        source,
        isTop: IS_TOP_FRAME,
        href: location.href,
        count: closeButtons.length,
        styleReady,
        activeCountBefore: activeElements.length,
        buttons: closeButtonBriefs
      });
    }

    closeButtons.forEach(el => {
      if (existing.has(el)) return;

      el.classList.add(BUTTON_CLASS_NAME);
      attachHoverHandlers(el);
      const ownerWindow = getOwnerWindow(el);
      ownerWindow.requestAnimationFrame(() => {
        el.classList.add(ACTIVE_CLASS_NAME);
      });
      activeElements.push(el);
      existing.add(el);
      addedCount += 1;
      if (shouldCollectDebugDetails) {
        addedElements.push(toElementBrief(el));
      }
    });

    if (DEBUG_FINDCLOSE) {
      console.debug('[FindClose][activeElements]', {
        source,
        addedCount,
        total: activeElements.length,
        elements: activeElements.map(toElementBrief),
      });
    }

    return {
      source,
      foundCount: closeButtons.length,
      addedCount,
      totalActive: activeElements.length,
      styleReady,
      foundButtons: closeButtonBriefs,
      addedElements: shouldCollectDebugDetails ? addedElements : [],
    };
  };

  const clearCloseButtonScan = () => {
    cancelPendingHoverRelease();
    const beforeCount = activeElements.length;
    activeElements.forEach(el => {
      detachHoverHandlers(el);
      el.classList.remove(ACTIVE_CLASS_NAME);

      let finished = false;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        el.classList.remove(BUTTON_CLASS_NAME);
        el.removeEventListener('transitionend', onTransitionEnd);
      };

      const onTransitionEnd = (event) => {
        if (event.propertyName === 'transform') {
          cleanup();
        }
      };

      el.addEventListener('transitionend', onTransitionEnd);
      setTimeout(cleanup, 450);
    });

    activeElements = [];

    return {
      clearedCount: beforeCount,
      totalActive: activeElements.length,
    };
  };

  const handleShakeStart = () => {
    if (!shouldHandleShakeInThisFrame()) return;

    runCloseButtonScan('shake-top');
    
    if (DEBUG_FINDCLOSE) {
      // Keep debug dump available in production and synchronize highlighting to all frames.
      browser.runtime.sendMessage({ type: 'FINDCLOSE_SHAKE_START' }).catch((error) => {
        console.warn('[FindCloseExtension] Failed to notify shake-start to background:', error);
      });
    }
  };

  const handleShakeEnd = () => {
    if (!shouldHandleShakeInThisFrame()) return;

    clearCloseButtonScan();
    
    if (DEBUG_FINDCLOSE) {
      // Synchronize clear state to all frames.
      browser.runtime.sendMessage({ type: 'FINDCLOSE_SHAKE_END' }).catch((error) => {
        console.warn('[FindCloseExtension] Failed to notify shake-end to background:', error);
      });
    }
  };

  // Effect for granting permission
  const shakeDocument = ({
    duration = 300,
    amplitude = 15,
    frequency = 30,
    axis = 'x',
  } = {}) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return { cancel: () => {} };
    }

    const target = document.documentElement;
    const originalTransform = target.style.transform;
    const start = performance.now();
    let rafId = null;

    const animate = (time) => {
      const elapsed = time - start;
      const progress = elapsed / duration;

      if (progress < 1) {
        const damping = 1 - progress;
        const angle = progress * Math.PI * frequency;

        const x =
         axis === 'x' || axis === 'both'
           ? Math.sin(angle) * amplitude * damping
           : 0;

        const y =
         axis === 'y' || axis === 'both'
           ? Math.cos(angle) * amplitude * damping
           : 0;

        target.style.transform = `translate(${x}px, ${y}px)`;
        rafId = requestAnimationFrame(animate);
      } else {
        target.style.transform = originalTransform;
        rafId = null;
      }
    };

    rafId = requestAnimationFrame(animate);

    return {
     cancel: () => {
       if (rafId !== null) {
         cancelAnimationFrame(rafId);
         target.style.transform = originalTransform;
         rafId = null;
       }
     },
    };
  };

  // Click filter helper for requesting permission only from non-clickable area taps
  const isInteractionTarget = (el) => {
    const tagName = el.tagName;
    
    if (el.disabled || el.hasAttribute('disabled')) return false;
    
    if (tagName === 'BUTTON') return true;
    if (tagName === 'A') return true;
    if (tagName === 'SELECT') return true;
    if (tagName === 'TEXTAREA') return true;
    if (tagName === 'SUMMARY') return true;
    
    if (tagName === 'LABEL' && el.hasAttribute('for')) return true;
    
    if (tagName === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'hidden') return false;
      const clickableTypes = ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'color', 'range'];
      if (clickableTypes.includes(type)) return true;
    }
    
    if (el.isContentEditable) return true;
    const contenteditable = el.getAttribute('contenteditable');
    if (contenteditable === '' || contenteditable === 'true') return true;
    
    const role = el.getAttribute('role');
    if (role) {
      const clickableRoles = ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option'];
      if (clickableRoles.includes(role)) return true;
    }
    
    if (typeof el.onclick === 'function') return true;
    if (el.hasAttribute('onclick')) return true;
    
    if (el.hasAttribute('tabindex') && el.tabIndex >= 0) return true;
    
    if (el.hasAttribute('data-dismiss') || el.hasAttribute('data-close')) return true;
    
    const ownerWindow = getOwnerWindow(el);
    const style = ownerWindow.getComputedStyle(el);
    if (style.pointerEvents === 'none') return false;
    return style.cursor === 'pointer';
  };

  const getViewportDiagonal = () => {
    const width = Math.max(window.innerWidth || 0, 1);
    const height = Math.max(window.innerHeight || 0, 1);
    return Math.hypot(width, height);
  };

  const getMouseShakeTimeoutByViewport = () => {
    const diagonal = getViewportDiagonal();
    if (diagonal >= MOUSE_SHAKE_DIAGONAL_LARGE) return MOUSE_SHAKE_TIMEOUT_LARGE;
    if (diagonal >= MOUSE_SHAKE_DIAGONAL_MEDIUM) return MOUSE_SHAKE_TIMEOUT_MEDIUM;
    return MOUSE_SHAKE_TIMEOUT_SMALL;
  };

  const createShakeDetector = () => {
    if (isMacOS()) {
      return new MouseShakeDetector({
        windowMs: MOUSE_SHAKE_WINDOW_MS,
        timeout: getMouseShakeTimeoutByViewport(),
        minDirectionChanges: MOUSE_SHAKE_MIN_DIRECTION_CHANGES,
        minTotalDistance: MOUSE_SHAKE_MIN_TOTAL_DISTANCE,
        minSegmentDelta: MOUSE_SHAKE_MIN_SEGMENT_DELTA,
        minSpeed: MOUSE_SHAKE_MIN_SPEED,
        onShakeStart: handleShakeStart,
        onShakeEnd: handleShakeEnd
      });
    }

    return new ShakeDetector({
      threshold: SHAKER_THRESHOLD,
      timeout: SHAKER_TIMEOUT,
      onShakeStart: handleShakeStart,
      onShakeEnd: handleShakeEnd,
      onShakeDocument: shakeDocument
    });
  };

  const shaker = createShakeDetector();
  const shouldHandleShakeInThisFrame = () => IS_TOP_FRAME || (shaker instanceof MouseShakeDetector);

  if (shaker instanceof MouseShakeDetector) {
    window.addEventListener('resize', () => {
      shaker.updateTimeout(getMouseShakeTimeoutByViewport());
    });
  }

  // Util for running effect of shakeDocument
  const waitForAnimations = (callback, options = {}) => {
    const {
      timeout = 5000,
      debounce = 100,
      noAnimationTimeout = 300,
      initialRAF = true,
    } = options;

    let timeoutId;
    let debounceId;
    let noAnimId;
    let observer;
    let isCompleted = false;
    let animationDetected = false;

    const safeCallback = () => {
      if (isCompleted) return;
      isCompleted = true;
      try { callback(); } catch (_) {}
    };

    const cleanup = () => {
      if (isCompleted) return;
      clearTimeout(timeoutId);
      clearTimeout(debounceId);
      clearTimeout(noAnimId);
      if (observer) observer.disconnect();
    };

    const runCheck = () => {
      if (isCompleted) return;

      clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        if (isCompleted) return;

        const animations = document.getAnimations();

        if (animations.length > 0) {
          animationDetected = true;
          Promise.all(animations.map(a => a.finished.catch(() => {})))
            .then(() => {
              runCheck();
            });
        } else if (animationDetected) {
          cleanup();
          safeCallback();
        }
      }, debounce);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      safeCallback();
    }, timeout);

    observer = new MutationObserver(runCheck);
    const observeTarget = document.body || document.documentElement;
    if (observeTarget) {
      observer.observe(observeTarget, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    }

    const initialCheck = () => {
      if (isCompleted) return;

      const animations = document.getAnimations();
      if (animations.length === 0) {
        // No animations right now; arm a short timer. If nothing starts, fire callback.
        noAnimId = setTimeout(() => {
          if (isCompleted) return;
          // Double-check before completing to avoid a race if something just started
          if (document.getAnimations().length === 0) {
            cleanup();
            safeCallback();
          } else {
            // Animations started during grace period; switch to normal flow
            runCheck();
          }
        }, noAnimationTimeout);
      } else {
        // Animations already running; enter the normal wait loop
        animationDetected = true;
        runCheck();
      }
    };

    if (initialRAF) {
      requestAnimationFrame(() => {
        requestAnimationFrame(initialCheck);
      });
    } else {
      initialCheck();
    }

    return () => {
      cleanup();
      isCompleted = true;
    };
  };

  // ========================================
  // Utils for frame
  // ========================================
  const extractDomain = (url) => {
    try {
      return new URL(url).hostname;
    } catch (error) {
      return url;
    }
  };

  const getTopFrameHostname = () => {
    if (window === window.top) return window.location.hostname;

    const ancestorOrigin = window.location.ancestorOrigins?.[0];
    if (ancestorOrigin) return extractDomain(ancestorOrigin);

    if (document.referrer) return extractDomain(document.referrer);

    return window.location.hostname;
  };

  const getCurrentSiteKey = () => {
    const topFrameHost = getTopFrameHostname();
    return extractDomain(topFrameHost);
  };

  const refreshConfigFromStorage = async (reason = 'unknown') => {
    try {
      const stored = await browser.storage.local.get('settings');
      config = { ...DEFAULT_SETTINGS, ...stored.settings };
      return true;
    } catch (error) {
      console.warn(`[FindCloseExtension] Failed to load settings (${reason}):`, error);
      return false;
    }
  };
                                   
  // ========================================
  // Event listeners
  // ========================================
  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && changes.settings) {
      config = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };

      if (config.isFindCloseEnabled && shouldHandleShakeInThisFrame()) {
        await shaker.start();
      }

      if (!config.isFindCloseEnabled && shouldHandleShakeInThisFrame()) {
        shaker.stop();
      }
    }
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;

    await refreshConfigFromStorage('visibilitychange');
    browser.runtime.sendMessage({ type: 'UPDATE_ICON' });
    if (config.isFindCloseEnabled && shouldHandleShakeInThisFrame()) {
      await shaker.start();
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    if (config.isFindCloseEnabled && shouldHandleShakeInThisFrame()) {
      shaker.start();
    }
  });

  // ========================================
  // Initialization
  // ========================================
  (async () => {
    try {
      browser.runtime.sendMessage({ type: 'UPDATE_ICON' });
    } catch (error) {
      console.error('[FindCloseExtension] Failed to update icon:', error);
    }
  })();

  let isInitialized = false;
  const initializeContent = async () => {
    if (isInitialized) return;
    isInitialized = true;

    try {
      await refreshConfigFromStorage('initialize');

      if (config.isFindCloseEnabled && shouldHandleShakeInThisFrame()) {
        const started = await shaker.start();

        if (!started) {
          document.addEventListener('click', (event) => {
            if (isInteractionTarget(event.target)) return false;
            shaker.start();
          }, { once: true });
        } else {
          try {
            if (isMacOS) return;
            waitForAnimations(() => {
              shakeDocument();
            }, {
              noAnimationTimeout: 300
            });
          } catch (error) {
            console.warn('[FindCloseExtension] Failed to trigger shakeDocument:', error);
          }
        }
      }
    } catch (error) {
      console.error('[FindCloseExtension] Failed to isInitialize:', error);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeContent, { once: true });
  } else {
    initializeContent();
  }
  // debug
  const toDebugEntry = (el) => {
   const r = el.getBoundingClientRect();
   return {
     tag: el.tagName,
     id: el.id || '',
     cls: typeof el.className === 'string' ? el.className : '',
     text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 60),
     rect: { x: r.x, y: r.y, w: r.width, h: r.height }
   };
 };

  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'DEBUG_DUMP_CLOSE_BUTTONS') {
      if (!DEBUG_FINDCLOSE) {
        return Promise.resolve({
          frameHref: location.href,
          isTop: IS_TOP_FRAME,
          debugEnabled: false,
        });
      }

      const closeButtons = findCloseButtons();
      const closeBtnNodes = querySelectorAllDeep('#close-btn');
      const closeBtnCount = closeBtnNodes.length;
      const hasCloseBtn = closeBtnCount > 0;
      const ogyIframes = querySelectorAllDeep('iframe[id^="ogy-iframe-"]');
      const ogyIframeCount = ogyIframes.length;
      const ogyIframeIds = ogyIframes.map(iframe => iframe.id || '');
      const ogyIframeDetails = ogyIframes.map((iframe) => {
        const detail = {
          id: iframe.id || '',
          src: iframe.getAttribute('src') || '',
          hasSrcdoc: iframe.hasAttribute('srcdoc'),
          canAccessDocument: false,
          closeBtnCountInIframe: 0,
          closeBtnSamplesInIframe: [],
          accessError: '',
        };

        try {
          const childDoc = iframe.contentDocument;
          if (childDoc) {
            detail.canAccessDocument = true;
            const nestedCloseBtns = querySelectorAllDeep('#close-btn', childDoc);
            detail.closeBtnCountInIframe = nestedCloseBtns.length;
            detail.closeBtnSamplesInIframe = nestedCloseBtns
              .slice(0, 3)
              .map(toDebugEntry);
          }
        } catch (error) {
          detail.accessError = String(error);
        }

        return detail;
      });
      let selfIframeId = '';
      try {
        selfIframeId = window.frameElement?.id || '';
      } catch (error) {
        selfIframeId = '';
      }
      return Promise.resolve({
        frameHref: location.href,
        isTop: IS_TOP_FRAME,
        selfIframeId,
        hasCloseBtn,
        closeBtnCount,
        closeBtnSamples: closeBtnNodes.slice(0, 3).map(toDebugEntry),
        ogyIframeCount,
        ogyIframeIds,
        ogyIframeDetails,
        count: closeButtons.length,
        buttons: closeButtons.map(toDebugEntry)
      });
    }

   if (msg?.type === 'FINDCLOSE_RUN_SHAKE_SCAN') {
     const result = runCloseButtonScan('broadcast');
     return Promise.resolve({
       frameHref: location.href,
       isTop: IS_TOP_FRAME,
       activeCount: activeElements.length,
       ...result
     });
   }

   if (msg?.type === 'FINDCLOSE_CLEAR_SHAKE_SCAN') {
     const result = clearCloseButtonScan();
     return Promise.resolve({
       frameHref: location.href,
       isTop: IS_TOP_FRAME,
       activeCount: activeElements.length,
       ...result
     });
   }
 });

})();
