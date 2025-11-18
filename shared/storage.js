const STORAGE_KEY = 'pq:lastCapture';

export async function loadLastCapture() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] ?? null;
}

export async function saveLastCapture(capture) {
  await chrome.storage.local.set({ [STORAGE_KEY]: capture });
}

export async function clearLastCapture() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

export function withUpdatedTimestamp(capture) {
  return {
    ...(capture ?? {}),
    updatedAt: new Date().toISOString()
  };
}
