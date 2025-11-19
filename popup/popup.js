import {
  loadLastCapture,
  saveLastCapture,
  clearLastCapture,
  withUpdatedTimestamp,
  loadSettings,
  SETTINGS_STORAGE_KEY
} from '../shared/storage.js';

const state = {
  mode: 'text',
  capture: null,
  analyzing: false,
  instructions: '',
  capturing: false,
  endpoint: ''
};

const ui = {
  modeButtons: Array.from(document.querySelectorAll('.mode-button')),
  captureButton: document.getElementById('captureButton'),
  analyzeButton: document.getElementById('analyzeButton'),
  captureTypeLabel: document.getElementById('captureTypeLabel'),
  timestampLabel: document.getElementById('timestampLabel'),
  detailsContent: document.getElementById('detailsContent'),
  imageMeta: document.getElementById('imageMeta'),
  instructionsInput: document.getElementById('instructionsInput'),
  statusLabel: document.getElementById('statusLabel'),
  resultPayload: document.getElementById('resultPayload'),
  copyButton: document.getElementById('copyResultButton'),
  clearCaptureButton: document.getElementById('clearCaptureButton'),
  clearInstructionsButton: document.getElementById('clearInstructionsButton'),
  settingsButton: document.getElementById('openSettingsButton')
};

init();

async function init() {
  ui.modeButtons.forEach((button) =>
    button.addEventListener('click', () => setMode(button.dataset.mode))
  );
  ui.captureButton.addEventListener('click', handleCapture);
  ui.analyzeButton.addEventListener('click', handleAnalyze);
  ui.instructionsInput.addEventListener('input', handleInstructionsInput);
  ui.clearCaptureButton.addEventListener('click', handleClearCapture);
  ui.clearInstructionsButton.addEventListener('click', handleClearInstructions);
  ui.copyButton.addEventListener('click', handleCopyResult);
  ui.settingsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());

  await hydrateSettings();
  await restoreState();
  chrome.storage.onChanged.addListener(handleStorageChange);
}

async function restoreState() {
  const saved = await loadLastCapture();
  if (saved) {
    state.capture = saved;
    state.instructions = saved.instructions ?? '';
    ui.instructionsInput.value = state.instructions;
    renderCaptureDetails();
  }
  syncAnalyzeButton();
  syncCaptureButton();
  syncClearButtons();
}

function setMode(mode) {
  state.mode = mode;
  ui.modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

async function handleCapture() {
  if (!ensureEndpointConfigured()) {
    return;
  }

  ui.captureButton.disabled = true;
  state.capturing = true;
  setStatus('Capturing…');
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_CAPTURE',
      mode: state.mode,
      instructions: state.instructions
    });

    if (!response?.ok) {
      console.warn('[popup] Capture failed response', response);
      throw new Error(response?.error || 'Capture failed.');
    }

    state.capture = response.capture;
    renderCaptureDetails();
    setStatus('Capture saved.', 'success');
  } catch (error) {
    console.error('[popup] Capture error', error);
    setStatus(error.message || 'Capture failed.', 'error');
  } finally {
    state.capturing = false;
    syncCaptureButton();
    syncAnalyzeButton();
  }
}

async function handleAnalyze() {
  if (!ensureEndpointConfigured()) {
    return;
  }
  if (!state.capture?.type) {
    setStatus('Capture something first.', 'error');
    return;
  }

  state.analyzing = true;
  syncAnalyzeButton();
  setStatus('Analyzing…');

  try {
    const body = {
      type: state.capture.type,
      instructions: (state.instructions || '').trim(),
      source: state.capture.source,
      content:
        state.capture.type === 'text'
          ? { text: state.capture.text }
          : {
              imageDataUrl: state.capture.imageDataUrl,
              cssWidth: state.capture.cssWidth,
              cssHeight: state.capture.cssHeight,
              pixelWidth: state.capture.pixelWidth,
              pixelHeight: state.capture.pixelHeight
            }
    };

    const response = await fetch(state.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const success = payload?.success === true;
    const message =
      payload?.message || (success ? 'Analysis complete.' : 'Analysis failed.');

    state.capture = {
      ...state.capture,
      analyzeResult: {
        success,
        message,
        payload
      }
    };
    await saveLastCapture(withUpdatedTimestamp(state.capture));

    renderCaptureDetails();
    setStatus(
      success ? 'Analysis complete.' : message,
      success ? 'success' : 'error',
      payload
    );
  } catch (error) {
    console.error('[popup] Analyze error', error);
    setStatus(error.message || 'Analyze failed.', 'error');
  } finally {
    state.analyzing = false;
    syncAnalyzeButton();
  }
}

function handleInstructionsInput(event) {
  state.instructions = event.target.value;
  syncClearButtons();
  persistInstructions();
}

let instructionsSaveHandle;
function persistInstructions() {
  window.clearTimeout(instructionsSaveHandle);
  instructionsSaveHandle = window.setTimeout(async () => {
    if (!state.capture) {
      return;
    }
    state.capture = {
      ...state.capture,
      instructions: state.instructions
    };
    await saveLastCapture(withUpdatedTimestamp(state.capture));
    renderCaptureDetails();
  }, 400);
}

function renderCaptureDetails() {
  if (!state.capture?.type) {
    ui.captureTypeLabel.textContent = 'No capture yet';
    ui.timestampLabel.textContent = '';
    ui.detailsContent.textContent =
      'Select text on the page or capture a screenshot region to get started.';
    ui.detailsContent.classList.add('empty');
    ui.imageMeta.classList.add('hidden');
    syncClearButtons();
    renderResult();
    return;
  }

  ui.captureTypeLabel.textContent =
    state.capture.type === 'text' ? 'Text selection' : 'Screenshot';
  ui.timestampLabel.textContent = formatTimestamp(state.capture.timestamp);

  ui.detailsContent.classList.remove('empty');
  ui.detailsContent.innerHTML = '';

  if (state.capture.type === 'text') {
    const textNode = document.createElement('pre');
    textNode.textContent = state.capture.text || '';
    ui.detailsContent.appendChild(textNode);
    ui.imageMeta.classList.add('hidden');
  } else {
    const img = document.createElement('img');
    img.src = state.capture.imageDataUrl;
    img.alt = 'Captured screenshot';
    ui.detailsContent.appendChild(img);
    ui.imageMeta.textContent = `${state.capture.cssWidth}×${state.capture.cssHeight}px (${state.capture.pixelWidth}×${state.capture.pixelHeight} physical)`;
    ui.imageMeta.classList.remove('hidden');
  }

  renderResult();

  syncClearButtons();
}

function syncClearButtons() {
  ui.clearCaptureButton.disabled = !state.capture?.type;
  ui.clearInstructionsButton.disabled = !state.instructions.trim();
}

function syncAnalyzeButton() {
  ui.analyzeButton.disabled =
    !state.capture?.type || state.analyzing || !hasEndpointConfigured();
}

function syncCaptureButton() {
  ui.captureButton.disabled = state.capturing || !hasEndpointConfigured();
}

function setStatus(message, type = 'neutral', payload = null) {
  ui.statusLabel.textContent = message;
  const container = ui.statusLabel.parentElement;
  container.classList.remove('success', 'error');
  if (type === 'success') {
    container.classList.add('success');
  } else if (type === 'error') {
    container.classList.add('error');
  }

  if (type === 'success' && payload) {
    ui.resultPayload.textContent = JSON.stringify(payload, null, 2);
    ui.resultPayload.classList.remove('hidden');
    ui.copyButton.disabled = false;
  } else {
    ui.resultPayload.textContent = '';
    ui.resultPayload.classList.add('hidden');
    ui.copyButton.disabled = true;
  }
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

async function getActiveTab() {
  console.warn('[popup] getActiveTab should not be called in window mode');
  return null;
}

async function handleClearCapture() {
  if (!state.capture) {
    return;
  }
  state.capture = null;
  await clearLastCapture();
  renderCaptureDetails();
  syncAnalyzeButton();
  syncClearButtons();
  setStatus('Capture cleared.');
}

async function handleClearInstructions() {
  if (!state.instructions.trim()) {
    return;
  }
  state.instructions = '';
  ui.instructionsInput.value = '';
  if (state.capture) {
    state.capture = {
      ...state.capture,
      instructions: ''
    };
    await saveLastCapture(withUpdatedTimestamp(state.capture));
  }
  syncClearButtons();
  setStatus('Instructions cleared.');
}

function renderResult() {
  if (!state.capture?.analyzeResult) {
    if (hasEndpointConfigured()) {
      setStatus(state.capture ? 'Ready' : 'Idle', 'neutral');
    } else {
      setStatus('Set the analysis endpoint in Settings to begin.', 'error');
    }
    return;
  }

  const { analyzeResult } = state.capture;
  if (analyzeResult.success) {
    setStatus('Analysis complete.', 'success', analyzeResult.payload);
  } else {
    setStatus(analyzeResult.message, 'error');
  }
}

async function handleCopyResult() {
  if (ui.copyButton.disabled || !ui.resultPayload.textContent) {
    return;
  }
  try {
    await navigator.clipboard.writeText(ui.resultPayload.textContent);
    setStatus('Result copied.', 'success', state.capture?.analyzeResult?.payload);
  } catch (error) {
    console.error('[popup] Copy failed', error);
    setStatus('Unable to copy result.', 'error');
  }
}

function hasEndpointConfigured() {
  return Boolean(state.endpoint);
}

function ensureEndpointConfigured() {
  if (hasEndpointConfigured()) {
    return true;
  }
  setStatus('Set the analysis endpoint in Settings to begin.', 'error');
  return false;
}

async function hydrateSettings() {
  const settings = await loadSettings();
  state.endpoint = settings?.endpoint?.trim() || '';
  syncCaptureButton();
  syncAnalyzeButton();
  if (!hasEndpointConfigured()) {
    setStatus('Set the analysis endpoint in Settings to begin.', 'error');
  }
}

function handleStorageChange(changes, areaName) {
  if (areaName !== 'local') {
    return;
  }
  if (changes[SETTINGS_STORAGE_KEY]) {
    hydrateSettings();
  }
}
