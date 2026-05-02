const CAPTURE_STORAGE_KEY = 'pq:lastCapture';
export const SETTINGS_STORAGE_KEY = 'pq:settings';
const PROVIDERS_STORAGE_KEY = 'pq:providers';
const WINDOW_STATE_STORAGE_KEY = 'pq:windowState';

export async function loadLastCapture() {
  const stored = await chrome.storage.local.get(CAPTURE_STORAGE_KEY);
  return stored[CAPTURE_STORAGE_KEY] ?? null;
}

export async function saveLastCapture(capture) {
  await chrome.storage.local.set({ [CAPTURE_STORAGE_KEY]: capture });
}

export async function clearLastCapture() {
  await chrome.storage.local.remove(CAPTURE_STORAGE_KEY);
}

export function withUpdatedTimestamp(capture) {
  return {
    ...(capture ?? {}),
    updatedAt: new Date().toISOString()
  };
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  return stored[SETTINGS_STORAGE_KEY] ?? null;
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
}

export async function loadProviders() {
  const stored = await chrome.storage.local.get(PROVIDERS_STORAGE_KEY);
  return stored[PROVIDERS_STORAGE_KEY] ?? null;
}

export async function saveProviders(providers) {
  await chrome.storage.local.set({ [PROVIDERS_STORAGE_KEY]: providers });
}

export async function loadWindowState() {
  const stored = await chrome.storage.local.get(WINDOW_STATE_STORAGE_KEY);
  return stored[WINDOW_STATE_STORAGE_KEY] ?? null;
}

export async function saveWindowState(windowState) {
  await chrome.storage.local.set({ [WINDOW_STATE_STORAGE_KEY]: windowState });
}
