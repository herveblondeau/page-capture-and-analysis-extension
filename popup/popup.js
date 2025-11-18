import {
  loadLastCapture,
  saveLastCapture,
  clearLastCapture,
  withUpdatedTimestamp
} from '../shared/storage.js';

const state = {
  mode: 'text',
  capture: null,
  analyzing: false,
  instructions: ''
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
  clearButton: document.getElementById('clearCaptureButton')
};

init();

function init() {
  ui.modeButtons.forEach((button) =>
    button.addEventListener('click', () => setMode(button.dataset.mode))
  );
  ui.captureButton.addEventListener('click', handleCapture);
  ui.analyzeButton.addEventListener('click', handleAnalyze);
  ui.instructionsInput.addEventListener('input', handleInstructionsInput);
  ui.clearButton.addEventListener('click', handleClearCapture);

  restoreState();
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
}

function setMode(mode) {
  state.mode = mode;
  ui.modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

async function handleCapture() {
  ui.captureButton.disabled = true;
  setStatus('Capturing…');
  try {
    console.log('[popup] Starting capture', { mode: state.mode });
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
    console.log('[popup] Capture success', state.capture);
    renderCaptureDetails();
    setStatus('Capture saved.', 'success');
  } catch (error) {
    console.error('[popup] Capture error', error);
    setStatus(error.message || 'Capture failed.', 'error');
  } finally {
    ui.captureButton.disabled = false;
    syncAnalyzeButton();
  }
}

async function handleAnalyze() {
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

    console.log('[popup] Sending analyze request', body);
    const response = await fetch('http://localhost:3000/analysis', {
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

    console.log('[popup] Analyze response', state.capture.analyzeResult);
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
    ui.clearButton.disabled = true;
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

  ui.clearButton.disabled = false;
}

function syncAnalyzeButton() {
  ui.analyzeButton.disabled = !state.capture?.type || state.analyzing;
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
  } else {
    ui.resultPayload.textContent = '';
    ui.resultPayload.classList.add('hidden');
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
  state.instructions = '';
  ui.instructionsInput.value = '';
  await clearLastCapture();
  renderCaptureDetails();
  syncAnalyzeButton();
  setStatus('Capture cleared.');
}

function renderResult() {
  if (!state.capture?.analyzeResult) {
    setStatus(state.capture ? 'Ready' : 'Idle', 'neutral');
    return;
  }

  const { analyzeResult } = state.capture;
  if (analyzeResult.success) {
    setStatus('Analysis complete.', 'success', analyzeResult.payload);
  } else {
    setStatus(analyzeResult.message, 'error');
  }
}
