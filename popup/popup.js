import {
  loadLastCapture,
  saveLastCapture,
  clearLastCapture,
  withUpdatedTimestamp,
  loadSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY
} from '../shared/storage.js';

const state = {
  mode: 'text',
  capture: null,
  analyzing: false,
  instructions: '',
  capturing: false,
  endpoint: '',
  language: 'auto',
  abortController: null,
  accordion: {
    selection: true,
    instructions: true,
    result: false
  }
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
  settingsButton: document.getElementById('openSettingsButton'),
  languageSelect: document.getElementById('languageSelect'),
  accordionSections: {
    selection: document.querySelector('[data-section="selection"]'),
    instructions: document.querySelector('[data-section="instructions"]'),
    result: document.querySelector('[data-section="result"]')
  }
};

init();

async function init() {
  ui.modeButtons.forEach((button) =>
    button.addEventListener('click', () => setMode(button.dataset.mode))
  );
  ui.captureButton.addEventListener('click', handleCapture);
  ui.analyzeButton.addEventListener('click', () => {
    if (state.analyzing) {
      handleCancelAnalyze();
    } else {
      handleAnalyze();
    }
  });
  ui.instructionsInput.addEventListener('input', handleInstructionsInput);
  ui.clearCaptureButton.addEventListener('click', (e) => {
    e.stopPropagation();
    handleClearCapture();
  });
  ui.clearInstructionsButton.addEventListener('click', handleClearInstructions);
  ui.copyButton.addEventListener('click', handleCopyResult);
  ui.settingsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());
  ui.languageSelect.addEventListener('change', handleLanguageChange);

  // Prevent accordion toggle when interacting with language select
  ['mousedown', 'click', 'change'].forEach(eventType => {
    ui.languageSelect.addEventListener(eventType, (e) => {
      e.stopPropagation();
    });
  });

  const headerActions = document.querySelector('.accordion-header-actions');
  if (headerActions) {
    ['mousedown', 'click'].forEach(eventType => {
      headerActions.addEventListener(eventType, (e) => {
        e.stopPropagation();
      });
    });
  }

  Object.entries(ui.accordionSections).forEach(([key, section]) => {
    const header = section.querySelector('.accordion-header');
    if (header) {
      header.addEventListener('click', () => toggleAccordion(key));
    }
  });

  await hydrateSettings();
  await restoreState();
  syncAccordionState();
  syncCaptureButton();
  syncAnalyzeButton();
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

  const settings = await loadSettings();
  if (settings?.language) {
    state.language = settings.language;
    ui.languageSelect.value = settings.language;
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
  syncCaptureButton();
  syncAnalyzeButton();
}

function toggleAccordion(section) {
  state.accordion[section] = !state.accordion[section];
  syncAccordionState();
}

function syncAccordionState() {
  Object.entries(ui.accordionSections).forEach(([key, section]) => {
    if (state.accordion[key]) {
      section.classList.remove('collapsed');
    } else {
      section.classList.add('collapsed');
    }
  });
}

async function handleCapture() {
  if (!ensureEndpointConfigured()) {
    return;
  }

  await handleCaptureForAnalyze();
  if (state.capture?.type) {
    setStatus('Capture saved.', 'success');
  }
}

async function handleCaptureForAnalyze() {
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
      throw new Error(response?.error || 'Capture failed.');
    }

    state.capture = response.capture;
    state.accordion.selection = true;
    state.accordion.result = false;
    syncAccordionState();
    renderCaptureDetails();
  } catch (error) {
    // Clear capture on failure to prevent using stale data
    state.capture = null;
    renderCaptureDetails();
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

  // For text and URL modes, always capture fresh content first
  if (state.mode === 'text' || state.mode === 'url') {
    await handleCaptureForAnalyze();
    // If capture failed, stop here
    if (!state.capture?.type) {
      return;
    }
  } else if (!state.capture?.type) {
    // For image mode, require existing capture
    setStatus('Capture something first.', 'error');
    return;
  }

  state.analyzing = true;
  state.abortController = new AbortController();
  syncAnalyzeButton();
  syncCaptureButton();
  setStatus('Analyzing…');

  // Expand result section and collapse selection section immediately
  state.accordion.selection = false;
  state.accordion.result = true;
  syncAccordionState();

  try {
    let response;

    if (state.capture.type === 'text') {
      // Text analysis: send as JSON to /text endpoint
      const body = {
        instructions: (state.instructions || '').trim(),
        language: state.language === 'auto' ? null : state.language,
        text: state.capture.text
      };

      response = await fetch(buildEndpoint('/text'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: state.abortController.signal
      });
    } else if (state.capture.type === 'url') {
      // URL analysis: send as JSON to /text endpoint (treating URL as text)
      const body = {
        instructions: (state.instructions || '').trim(),
        language: state.language === 'auto' ? null : state.language,
        text: state.capture.url
      };

      response = await fetch(buildEndpoint('/url'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: state.abortController.signal
      });
    } else {
      // Image analysis: send as multipart/form-data to /image endpoint
      const imageBlob = await dataUrlToBlob(state.capture.imageDataUrl);

      const metadata = {
        instructions: (state.instructions || '').trim(),
        language: state.language === 'auto' ? null : state.language,
        cssWidth: state.capture.cssWidth,
        cssHeight: state.capture.cssHeight,
        pixelWidth: state.capture.pixelWidth,
        pixelHeight: state.capture.pixelHeight
      };

      const formData = new FormData();
      formData.append('metadata', JSON.stringify(metadata));
      formData.append('image', imageBlob, 'capture.png');

      response = await fetch(buildEndpoint('/image'), {
        method: 'POST',
        body: formData,
        signal: state.abortController.signal
      });
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const success = payload?.success === true;
    const result =
      payload?.result || (success ? 'Analysis complete.' : 'Analysis failed.');

    state.capture = {
      ...state.capture,
      analyzeResult: {
        success,
        result,
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
    // Don't show error if it was a user cancellation
    if (error.name === 'AbortError') {
      setStatus('Analysis cancelled.', 'warning');
    } else {
      setStatus(error.message || 'Analyze failed.', 'error');
    }
  } finally {
    state.analyzing = false;
    state.abortController = null;
    syncAnalyzeButton();
    syncCaptureButton();
  }
}

function handleCancelAnalyze() {
  if (state.abortController) {
    state.abortController.abort();
  }
  // State will be reset in the finally block of handleAnalyze
}

function handleInstructionsInput(event) {
  state.instructions = event.target.value;
  syncClearButtons();
  persistInstructions();
}

async function handleLanguageChange(event) {
  state.language = event.target.value;
  const settings = await loadSettings();
  await saveSettings({
    ...(settings || {}),
    language: state.language
  });
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
    ui.captureTypeLabel.textContent = 'Selection';
    ui.timestampLabel.textContent = '';
    ui.detailsContent.textContent =
      'Select text on the page, capture a screenshot region, or capture the page URL to get started.';
    ui.detailsContent.classList.add('empty');
    ui.imageMeta.classList.add('hidden');
    syncClearButtons();
    renderResult();
    return;
  }

  if (state.capture.type === 'text') {
    ui.captureTypeLabel.textContent = 'Text selection';
  } else if (state.capture.type === 'image') {
    ui.captureTypeLabel.textContent = 'Screenshot';
  } else if (state.capture.type === 'url') {
    ui.captureTypeLabel.textContent = 'URL';
  }
  ui.timestampLabel.textContent = formatTimestamp(state.capture.timestamp);

  ui.detailsContent.classList.remove('empty');
  ui.detailsContent.innerHTML = '';

  if (state.capture.type === 'text') {
    const textNode = document.createElement('pre');
    textNode.textContent = state.capture.text || '';
    ui.detailsContent.appendChild(textNode);
    ui.imageMeta.classList.add('hidden');
  } else if (state.capture.type === 'url') {
    const urlNode = document.createElement('div');
    urlNode.style.wordBreak = 'break-all';
    urlNode.style.fontFamily = 'inherit';
    const link = document.createElement('a');
    link.href = state.capture.url;
    link.textContent = state.capture.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.color = 'var(--accent)';
    urlNode.appendChild(link);
    ui.detailsContent.appendChild(urlNode);
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
  if (state.analyzing) {
    ui.analyzeButton.textContent = 'Cancel';
    ui.analyzeButton.disabled = false;
    ui.analyzeButton.classList.add('cancel');
  } else {
    ui.analyzeButton.textContent = 'Analyze';
    // For text/URL modes, analyze button is enabled if endpoint is configured
    // For image mode, need a capture first
    const needsCapture = state.mode === 'image' && !state.capture?.type;
    ui.analyzeButton.disabled = needsCapture || !hasEndpointConfigured() || state.capturing;
    ui.analyzeButton.classList.remove('cancel');
  }
}

function syncCaptureButton() {
  // Hide capture button for text and URL modes
  const shouldShow = state.mode === 'image';
  ui.captureButton.style.display = shouldShow ? '' : 'none';
  ui.captureButton.disabled = state.capturing || state.analyzing || !hasEndpointConfigured();
}

function setStatus(message, type = 'neutral', payload = null) {
  ui.statusLabel.textContent = message;
  const resultSection = ui.accordionSections.result;
  resultSection.classList.remove('success', 'error', 'warning');
  if (type === 'success') {
    resultSection.classList.add('success');
  } else if (type === 'error') {
    resultSection.classList.add('error');
  } else if (type === 'warning') {
    resultSection.classList.add('warning');
  }

  if (type === 'success' && payload) {
    const result = payload.result;
    if (result !== undefined) {
      if (typeof result === 'string') {
        // Render as markdown - it handles plain text fine
        if (typeof marked !== 'undefined') {
          // Store original text for copying
          ui.resultPayload.dataset.originalText = result;
          // Render markdown with line breaks preserved
          ui.resultPayload.innerHTML = marked.parse(result, {
            breaks: true, // Convert single line breaks to <br>
            gfm: true     // GitHub Flavored Markdown
          });
        } else {
          // Fallback: preserve line breaks if marked not available
          ui.resultPayload.style.whiteSpace = 'pre-wrap';
          ui.resultPayload.textContent = result;
          ui.resultPayload.dataset.originalText = result;
        }
      } else {
        // For objects, use JSON with preserved formatting
        const jsonText = JSON.stringify(result, null, 2);
        ui.resultPayload.style.whiteSpace = 'pre-wrap';
        ui.resultPayload.textContent = jsonText;
        ui.resultPayload.dataset.originalText = jsonText;
      }
    } else {
      ui.resultPayload.textContent = '';
      ui.resultPayload.dataset.originalText = '';
    }
    ui.resultPayload.classList.remove('hidden');
    ui.copyButton.disabled = false;
  } else {
    ui.resultPayload.textContent = '';
    ui.resultPayload.innerHTML = '';
    ui.resultPayload.dataset.originalText = '';
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

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return await response.blob();
}

function buildEndpoint(path) {
  const base = state.endpoint.replace(/\/+$/, '');
  return new URL(base + path);
}

async function getActiveTab() {
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
  if (ui.copyButton.disabled || !ui.resultPayload.dataset.originalText) {
    return;
  }
  try {
    // Copy the original text (not the rendered HTML)
    await navigator.clipboard.writeText(ui.resultPayload.dataset.originalText);
    setStatus('Result copied.', 'success', state.capture?.analyzeResult?.payload);
  } catch (error) {
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
