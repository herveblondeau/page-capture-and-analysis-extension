import {
  loadLastCapture,
  saveLastCapture,
  withUpdatedTimestamp
} from './shared/storage.js';

const WINDOW_DIMENSIONS = {
  width: 420,
  height: 620
};

let captureWindowId = null;
let latestPageTabId = null;

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await loadLastCapture();
  if (!existing) {
    await saveLastCapture(
      withUpdatedTimestamp({
        status: 'idle'
      })
    );
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  switch (message.type) {
    case 'START_CAPTURE': {
      console.log('[background] START_CAPTURE received', {
        sender: sender?.id,
        mode: message.mode,
        tabId: message.tabId
      });
      handleStartCapture(message)
        .then((capture) => sendResponse({ ok: true, capture }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    default:
      break;
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  trackPotentialPageTab(tab);
  if (captureWindowId) {
    try {
      await chrome.windows.update(captureWindowId, { focused: true });
      return;
    } catch (error) {
      console.warn('[background] Failed to focus capture window, reopening', error);
    }
  }
  await openCaptureWindow();
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === captureWindowId) {
    captureWindowId = null;
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    trackPotentialPageTab(tab);
  } catch (error) {
    console.warn('[background] Failed to inspect activated tab', error);
  }
});

async function openCaptureWindow() {
  const url = chrome.runtime.getURL('popup/index.html');
  const window = await chrome.windows.create({
    url,
    type: 'popup',
    width: WINDOW_DIMENSIONS.width,
    height: WINDOW_DIMENSIONS.height
  });
  captureWindowId = window.id ?? null;
  console.log('[background] Capture window opened', captureWindowId);
}

function trackPotentialPageTab(tab) {
  if (!isPageTab(tab)) {
    return;
  }
  latestPageTabId = tab.id;
}

function isPageTab(tab) {
  if (!tab || typeof tab.id !== 'number') {
    return false;
  }
  if (!tab.url) {
    return true;
  }
  return !tab.url.startsWith('chrome-extension://');
}

async function resolveTargetTabId(requestedTabId) {
  if (typeof requestedTabId === 'number') {
    return requestedTabId;
  }
  if (latestPageTabId) {
    try {
      const tab = await chrome.tabs.get(latestPageTabId);
      if (isPageTab(tab)) {
        return tab.id;
      }
    } catch (error) {
      console.warn('[background] Failed to use cached tab id', error);
    }
  }

  const lastFocused = await chrome.windows.getLastFocused({ populate: true });
  if (lastFocused?.tabs) {
    const candidate = lastFocused.tabs.find((t) => t.active && isPageTab(t));
    if (candidate) {
      latestPageTabId = candidate.id;
      return candidate.id;
    }
  }

  const activeNormals = await chrome.tabs.query({ active: true, windowType: 'normal' });
  const fallback = activeNormals.find((t) => isPageTab(t));
  if (fallback) {
    latestPageTabId = fallback.id;
    return fallback.id;
  }

  throw new Error('No suitable tab to capture. Focus a webpage and try again.');
}

async function persistCapture(capture) {
  if (!capture) {
    throw new Error('Capture payload missing');
  }
  console.log('[background] Persisting capture', {
    type: capture.type,
    timestamp: capture.timestamp
  });
  await saveLastCapture(withUpdatedTimestamp(capture));
}

async function handleStartCapture(message) {
  const { mode, tabId: requestedTabId, instructions } = message;
  const targetTabId = await resolveTargetTabId(requestedTabId);
  const tab = await chrome.tabs.get(targetTabId);
  if (!tab) {
    throw new Error('Tab unavailable');
  }

  console.log('[background] Beginning capture', {
    mode,
    tabId: targetTabId,
    url: tab.url
  });

  let capturePayload;
  if (mode === 'image') {
    await chrome.tabs.update(targetTabId, { active: true });
    const region = await requestRegionCapture(targetTabId);
    if (!region?.ok) {
      console.warn('[background] Region capture failed response', region);
      throw new Error(region?.error || 'Region capture cancelled.');
    }
    console.log('[background] Region capture resolved', region.region);
    capturePayload = await handleRegionImageCapture(tab, region.region);
  } else {
    await chrome.tabs.update(targetTabId, { active: true });
    capturePayload = await captureSelectedText(targetTabId);
  }

  const record = {
    ...capturePayload,
    instructions: instructions ?? '',
    source: {
      url: tab.url,
      title: tab.title
    },
    timestamp: new Date().toISOString()
  };

  console.log('[background] Capture payload ready', {
    type: record.type,
    hasImage: Boolean(record.imageDataUrl),
    textLength: record.text?.length
  });
  await persistCapture(record);
  return record;
}

async function captureSelectedText(tabId) {
  console.log('[background] Capturing selected text');
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.getSelection()?.toString() ?? ''
  });
  const text = (result?.result || '').trim();
  if (!text) {
    throw new Error('Select some text on the page first.');
  }
  console.log('[background] Selected text length', text.length);
  return {
    type: 'text',
    text
  };
}

async function requestRegionCapture(tabId) {
  try {
    console.log('[background] Requesting region capture');
    return await chrome.tabs.sendMessage(tabId, {
      type: 'START_REGION_CAPTURE'
    });
  } catch (error) {
    console.warn('[background] Region capture message failed, retrying', error);
    const missingReceiver =
      error?.message && error.message.includes('Receiving end does not exist');
    if (!missingReceiver) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/regionCapture.js']
    });
    console.log('[background] Region capture script injected, retrying');

    return chrome.tabs.sendMessage(tabId, {
      type: 'START_REGION_CAPTURE'
    });
  }
}

async function handleRegionImageCapture(tab, region) {
  if (!region) {
    throw new Error('Region missing');
  }

  console.log('[background] Capturing visible tab', {
    windowId: tab.windowId,
    region
  });
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: 'png'
  });

  const cropped = await cropDataUrlToRegion(dataUrl, region);
  console.log('[background] Image cropped', {
    cssWidth: region.width,
    cssHeight: region.height,
    pixelWidth: cropped.pixelWidth,
    pixelHeight: cropped.pixelHeight
  });
  return {
    type: 'image',
    imageDataUrl: cropped.dataUrl,
    cssWidth: region.width,
    cssHeight: region.height,
    pixelWidth: cropped.pixelWidth,
    pixelHeight: cropped.pixelHeight
  };
}

async function cropDataUrlToRegion(dataUrl, region) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const scale = region.devicePixelRatio || 1;
  const sx = region.x * scale;
  const sy = region.y * scale;
  const sw = Math.max(1, region.width * scale);
  const sh = Math.max(1, region.height * scale);

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  const croppedDataUrl = await blobToDataUrl(croppedBlob);

  console.log('[background] cropDataUrlToRegion complete', {
    sw,
    sh
  });
  return {
    dataUrl: croppedDataUrl,
    pixelWidth: sw,
    pixelHeight: sh
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
