import { loadSettings, saveSettings, loadProviders, saveProviders } from '../shared/storage.js';

const form = document.getElementById('settingsForm');
const endpointInput = document.getElementById('endpointInput');
const apiKeyInput = document.getElementById('apiKeyInput');
const statusLabel = document.getElementById('optionsStatus');
const saveButton = document.getElementById('saveSettingsButton');

const refreshModelsButton = document.getElementById('refreshModelsButton');
const modelsStatus = document.getElementById('modelsStatus');
const providerSelect = document.getElementById('providerSelect');
const modelSelect = document.getElementById('modelSelect');

let currentEndpoint = '';
let currentApiKey = '';

init();

async function init() {
  const settings = await loadSettings();
  currentEndpoint = settings?.endpoint ?? '';
  currentApiKey = settings?.apiKey ?? '';
  endpointInput.value = currentEndpoint;
  apiKeyInput.value = currentApiKey;
  updateSaveState();

  const providers = await loadProviders();
  if (providers) {
    populateProviderDropdown(providers, settings?.providerId ?? '');
    const provider = providers.find(p => p.id === settings?.providerId);
    if (provider) {
      populateModelDropdown(provider.models, settings?.modelId ?? '');
    }
  }
}

form.addEventListener('input', () => {
  clearStatus();
  updateSaveState();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const endpoint = endpointInput.value.trim();
  if (!endpoint) {
    showStatus('Endpoint is required.', 'error');
    return;
  }

  const apiKey = apiKeyInput.value.trim();
  saveButton.disabled = true;
  try {
    const settings = await loadSettings();
    await saveSettings({ ...(settings ?? {}), endpoint, apiKey });
    currentEndpoint = endpoint;
    currentApiKey = apiKey;
    showStatus('Settings saved.', 'success');
  } catch (error) {
    console.error('[options] Failed to save settings', error);
    showStatus('Unable to save. See console for details.', 'error');
  } finally {
    updateSaveState();
  }
});

refreshModelsButton.addEventListener('click', async () => {
  const endpoint = endpointInput.value.trim() || currentEndpoint;
  if (!endpoint) {
    showModelsStatus('Set the endpoint first.', 'error');
    return;
  }

  refreshModelsButton.disabled = true;
  showModelsStatus('Loading…');

  try {
    const apiKey = apiKeyInput.value.trim() || currentApiKey;
    const headers = apiKey ? { 'X-Api-Key': apiKey } : {};
    const base = endpoint.replace(/\/+$/, '');
    const response = await fetch(`${base}/system/models`, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const providers = await response.json();
    await saveProviders(providers);

    const settings = await loadSettings();
    populateProviderDropdown(providers, settings?.providerId ?? '');
    const provider = providers.find(p => p.id === settings?.providerId);
    if (provider) {
      populateModelDropdown(provider.models, settings?.modelId ?? '');
    } else {
      resetModelDropdown();
    }
    showModelsStatus('Models updated.', 'success');
  } catch (error) {
    console.error('[options] Failed to refresh models', error);
    showModelsStatus(error.message || 'Failed to load models.', 'error');
  } finally {
    refreshModelsButton.disabled = false;
  }
});

providerSelect.addEventListener('change', async () => {
  const providers = await loadProviders();
  const provider = providers?.find(p => p.id === providerSelect.value);
  if (provider) {
    populateModelDropdown(provider.models, '');
  } else {
    resetModelDropdown();
  }
  await saveSelection(providerSelect.value, '');
});

modelSelect.addEventListener('change', async () => {
  await saveSelection(providerSelect.value, modelSelect.value);
});

function populateProviderDropdown(providers, selectedId) {
  providerSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— select a provider —';
  providerSelect.appendChild(placeholder);

  providers.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.label;
    providerSelect.appendChild(option);
  });

  providerSelect.value = selectedId || '';
  providerSelect.disabled = providers.length === 0;
}

function populateModelDropdown(models, selectedId) {
  modelSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— select a model —';
  modelSelect.appendChild(placeholder);

  models.forEach(m => {
    const option = document.createElement('option');
    option.value = m.id;
    option.textContent = m.label;
    modelSelect.appendChild(option);
  });

  modelSelect.value = selectedId || '';
  modelSelect.disabled = models.length === 0;
}

function resetModelDropdown() {
  modelSelect.innerHTML = '<option value="">— select a provider first —</option>';
  modelSelect.disabled = true;
}

async function saveSelection(providerId, modelId) {
  const settings = await loadSettings();
  await saveSettings({ ...(settings ?? {}), providerId, modelId });
}

function updateSaveState() {
  const endpoint = endpointInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  saveButton.disabled = !endpoint || (endpoint === currentEndpoint && apiKey === currentApiKey);
}

function showStatus(message, tone = 'neutral') {
  statusLabel.textContent = message;
  statusLabel.classList.toggle('success', tone === 'success');
  statusLabel.classList.toggle('error', tone === 'error');
}

function clearStatus() {
  statusLabel.textContent = '';
  statusLabel.classList.remove('success', 'error');
}

function showModelsStatus(message, tone = 'neutral') {
  modelsStatus.textContent = message;
  modelsStatus.classList.toggle('success', tone === 'success');
  modelsStatus.classList.toggle('error', tone === 'error');
}
