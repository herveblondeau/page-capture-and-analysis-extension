import {
  loadLastCapture,
  saveLastCapture,
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
  statusLabel: document.getElementById('statusLabel')
};

init();

function init() {
  ui.modeButtons.forEach((button) =>
    button.addEventListener('click', () => setMode(button.dataset.mode))
  );
  ui.captureButton.addEventListener('click', handleCapture);
  ui.analyzeButton.addEventListener('click', handleAnalyze);
  ui.instructionsInput.addEventListener('input', handleInstructionsInput);

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
    const tab = await getActiveTab();
    if (!tab?.id) {
      throw new Error('No active tab found.');
    }

    let capture;
    if (state.mode === 'text') {
      capture = await captureSelectedText(tab);
    } else {
      capture = await captureRegionImage(tab);
    }

    state.capture = {
      ...capture,
      instructions: state.instructions,
      source: {
        url: tab.url,
        title: tab.title
      },
      timestamp: new Date().toISOString()
    };

    await saveLastCapture(withUpdatedTimestamp(state.capture));
    renderCaptureDetails();
    setStatus('Capture saved.', 'success');
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Capture failed.', 'error');
  } finally {
    ui.captureButton.disabled = false;
    syncAnalyzeButton();
  }
}

async function captureSelectedText(tab) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.getSelection()?.toString() ?? ''
  });
  const text = (result?.result || '').trim();
  if (!text) {
    throw new Error('Select some text on the page first.');
  }
  return {
    type: 'text',
    text
  };
}

async function captureRegionImage(tab) {
  const regionResponse = await requestRegionCapture(tab.id);
  if (!regionResponse?.ok) {
    throw new Error(regionResponse?.error || 'Region capture cancelled.');
  }

  const captureResponse = await chrome.runtime.sendMessage({
    type: 'CAPTURE_REGION_IMAGE',
    tabId: tab.id,
    region: regionResponse.region
  });

  if (!captureResponse?.ok) {
    throw new Error(captureResponse?.error || 'Unable to capture image.');
  }

  return captureResponse.payload;
}

async function requestRegionCapture(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: 'START_REGION_CAPTURE'
    });
  } catch (error) {
    const missingReceiver =
      error?.message && error.message.includes('Receiving end does not exist');
    if (!missingReceiver) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/regionCapture.js']
    });

    return chrome.tabs.sendMessage(tabId, {
      type: 'START_REGION_CAPTURE'
    });
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
    const message = payload?.message || (success ? 'Analysis complete.' : 'Analysis failed.');

    state.capture = {
      ...state.capture,
      analyzeResult: {
        success,
        message
      }
    };
    await saveLastCapture(withUpdatedTimestamp(state.capture));

    renderCaptureDetails();
    setStatus(message, success ? 'success' : 'error');
  } catch (error) {
    console.error(error);
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
    state.capture = {
      ...(state.capture || {}),
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

  if (state.capture.analyzeResult) {
    const result = document.createElement('div');
    result.className = 'analysis-result';
    result.style.marginTop = '8px';
    result.style.fontSize = '12px';
    result.style.color = state.capture.analyzeResult.success
      ? 'var(--success)'
      : 'var(--error)';
    result.textContent = state.capture.analyzeResult.message;
    ui.detailsContent.appendChild(result);
  }
}

function syncAnalyzeButton() {
  ui.analyzeButton.disabled = !state.capture?.type || state.analyzing;
}

function setStatus(message, type = 'neutral') {
  ui.statusLabel.textContent = message;
  ui.statusLabel.parentElement.classList.remove('success', 'error');
  if (type === 'success') {
    ui.statusLabel.parentElement.classList.add('success');
  } else if (type === 'error') {
    ui.statusLabel.parentElement.classList.add('error');
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
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab;
}
