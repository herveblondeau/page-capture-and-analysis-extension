import { loadLastCapture, saveLastCapture, withUpdatedTimestamp } from './shared/storage.js';

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
    case 'CAPTURE_REGION_IMAGE': {
      handleRegionImageCapture(message)
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    case 'SAVE_CAPTURE': {
      persistCapture(message.capture)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    default:
      break;
  }
});

async function persistCapture(capture) {
  if (!capture) {
    throw new Error('Capture payload missing');
  }
  await saveLastCapture(withUpdatedTimestamp(capture));
}

async function handleRegionImageCapture(message) {
  const { tabId, region } = message;
  if (typeof tabId !== 'number') {
    throw new Error('tabId missing');
  }
  if (!region) {
    throw new Error('Region missing');
  }

  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: 'png'
  });

  const cropped = await cropDataUrlToRegion(dataUrl, region);
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
