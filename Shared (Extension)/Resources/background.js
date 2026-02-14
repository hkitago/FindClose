const DEBUG_FINDCLOSE = false;

// ============================================
// Settings
// ============================================
const settings = (() => {
  const DEFAULT_SETTINGS = {
    isFindCloseEnabled: false,
  };

  let cache = { ...DEFAULT_SETTINGS };

  const load = async () => {
    try {
      const { settings: stored } = await browser.storage.local.get('settings');
      cache = { ...DEFAULT_SETTINGS, ...stored };
    } catch (error) {
      console.error('[FindCloseExtension] Failed to load settings:', error);
    }
  };

  const get = (key) => {
    if (key === undefined) return { ...cache };
    return cache[key];
  };

  const set = async (key, value) => {
    cache[key] = value;
    try {
      await browser.storage.local.set({ settings: cache });
    } catch (error) {
      console.error('[FindCloseExtension] Failed to save settings:', error);
    }
  };

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && changes.settings) {
      cache = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    }
  });

  return { load, get, set };
})();

// ========================================
// Icon Handlings
// ========================================
const updateToolbarIcon = async (tabId, isEnabled) => {
  let iconPath;
  if (isEnabled) {
    iconPath = `./images/toolbar-icon-on.svg`;
  } else {
    iconPath = './images/toolbar-icon.svg';
  }
  browser.action.setIcon({ path: iconPath, tabId: tabId });
};

// ========================================
// Utils for debug
// ========================================
const getFramesByTab = async (tabId) => {
  try {
    return await browser.webNavigation.getAllFrames({ tabId });
  } catch (error) {
    console.warn('[FindCloseExtension] Failed to get frames:', error);
    return [];
  }
};

const sendMessageToAllFrames = async (tabId, message, options = {}) => {
  const excludeFrameIds = new Set(options.excludeFrameIds || []);
  const frames = await getFramesByTab(tabId);
  if (!frames.length) return [];

  return Promise.all(frames
    .filter(f => !excludeFrameIds.has(f.frameId))
    .map(async (f) => {
    try {
      const res = await browser.tabs.sendMessage(tabId, message, { frameId: f.frameId });
      return {
        frameId: f.frameId,
        parentFrameId: typeof f.parentFrameId === 'number' ? f.parentFrameId : -1,
        frameUrl: f.url,
        ok: true,
        ...res
      };
    } catch (error) {
      return {
        frameId: f.frameId,
        parentFrameId: typeof f.parentFrameId === 'number' ? f.parentFrameId : -1,
        frameUrl: f.url,
        ok: false,
        error: String(error)
      };
    }
  }));
};

// ========================================
// Event Listeners
// ========================================
browser.action.onClicked.addListener(async (tab) => {
  const newState = !settings.get('isFindCloseEnabled');
  await settings.set('isFindCloseEnabled', newState);

  await updateToolbarIcon(tab.id, newState);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    await updateToolbarIcon(tab?.id ?? null, settings.get('isFindCloseEnabled'));
  }
});

browser.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) return;
  
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  await updateToolbarIcon(activeTab?.id ?? null, settings.get('isFindCloseEnabled'));
});

browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'UPDATE_ICON') {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    await updateToolbarIcon(activeTab?.id ?? null, settings.get('isFindCloseEnabled'));

    return;
  }

  if (message.type === 'FINDCLOSE_SHAKE_START') {
    const tabId = sender?.tab?.id;
    if (!tabId) return;
    const senderFrameId = typeof sender?.frameId === 'number' ? sender.frameId : 0;

    if (DEBUG_FINDCLOSE) {
      await dumpAllFrames(tabId, 'shake-start');
    }

    const applyResults = await sendMessageToAllFrames(
      tabId,
      { type: 'FINDCLOSE_RUN_SHAKE_SCAN' },
      { excludeFrameIds: [senderFrameId] }
    );
    const okResults = applyResults.filter(r => r.ok);
    if (DEBUG_FINDCLOSE) {
      const errorFrames = applyResults
        .filter(r => !r.ok)
        .map(r => ({ frameId: r.frameId, frameUrl: r.frameUrl, error: r.error }))
        .slice(0, 8);

      const frameSummaries = okResults
        .map(r => ({
          frameId: r.frameId,
          frameUrl: r.frameUrl,
          frameHref: r.frameHref,
          foundCount: r.foundCount ?? 0,
          addedCount: r.addedCount ?? 0,
          totalActive: r.totalActive ?? 0,
          styleReady: r.styleReady,
          foundButtons: r.foundButtons ?? [],
          addedElements: r.addedElements ?? [],
        }))
        .filter(r => r.foundCount > 0 || r.addedCount > 0);

      console.debug('[FindClose][DEBUG] all-frame shake-start apply', {
        tabId,
        totalFrames: applyResults.length,
        okFrames: okResults.length,
        nonZeroFrames: frameSummaries.length,
        frameSummaries,
        errorFrames,
      });
    }
    return;
  }

  if (message.type === 'FINDCLOSE_SHAKE_END') {
    const tabId = sender?.tab?.id;
    if (!tabId) return;
    const senderFrameId = typeof sender?.frameId === 'number' ? sender.frameId : 0;

    const clearResults = await sendMessageToAllFrames(
      tabId,
      { type: 'FINDCLOSE_CLEAR_SHAKE_SCAN' },
      { excludeFrameIds: [senderFrameId] }
    );
    if (DEBUG_FINDCLOSE) {
      const okResults = clearResults.filter(r => r.ok);
      const frameSummaries = okResults
        .map(r => ({
          frameId: r.frameId,
          frameUrl: r.frameUrl,
          frameHref: r.frameHref,
          clearedCount: r.clearedCount ?? 0,
        }))
        .filter(r => r.clearedCount > 0);

      console.debug('[FindClose][DEBUG] all-frame shake-end clear', {
        tabId,
        totalFrames: clearResults.length,
        okFrames: okResults.length,
        nonZeroFrames: frameSummaries.length,
        frameSummaries,
      });
    }
  }
});

// ========================================
// Initialization
// ========================================
(async () => {
  try {
    await settings.load();

    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    await updateToolbarIcon(activeTab?.id ?? null, settings.get());

  } catch (error) {
    console.error('[FindCloseExtension] Failed to initialize:', error);
  }
})();

// debug
const dumpAllFrames = async (tabId, reason = 'manual') => {
  if (!DEBUG_FINDCLOSE) return;

  const results = await sendMessageToAllFrames(tabId, { type: 'DEBUG_DUMP_CLOSE_BUTTONS' });
  const okResults = results.filter(r => r.ok);
  const framesWithCloseBtn = okResults
    .filter(r => (
      (r.count ?? 0) > 0 ||
      r.hasCloseBtn ||
      (r.ogyIframeCount ?? 0) > 0 ||
      (typeof r.selfIframeId === 'string' && r.selfIframeId.startsWith('ogy-iframe-'))
    ))
    .map(r => ({
      frameId: r.frameId,
      parentFrameId: typeof r.parentFrameId === 'number' ? r.parentFrameId : -1,
      frameUrl: r.frameUrl,
      frameHref: r.frameHref,
      isTop: Boolean(r.isTop),
      selfIframeId: r.selfIframeId || '',
      hasCloseBtn: Boolean(r.hasCloseBtn),
      closeBtnCount: r.closeBtnCount ?? 0,
      closeBtnSamples: Array.isArray(r.closeBtnSamples) ? r.closeBtnSamples : [],
      ogyIframeCount: r.ogyIframeCount ?? 0,
      ogyIframeIds: Array.isArray(r.ogyIframeIds) ? r.ogyIframeIds : [],
      ogyIframeDetails: Array.isArray(r.ogyIframeDetails) ? r.ogyIframeDetails : [],
      foundButtonIds: Array.isArray(r.buttons)
        ? r.buttons.map(btn => btn.id || '').filter(Boolean).slice(0, 8)
        : [],
      foundButtonSamples: Array.isArray(r.buttons) ? r.buttons.slice(0, 3) : [],
      count: r.count ?? 0,
    }));

  console.debug('[FindClose][DEBUG] all-frame dump', {
    reason,
    tabId,
    totalFrames: results.length,
    okFrames: okResults.length,
    framesWithCloseBtn,
    results,
  });
};
