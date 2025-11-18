import { loadSettings, saveSettings } from '../shared/storage.js';

const form = document.getElementById('settingsForm');
const endpointInput = document.getElementById('endpointInput');
const statusLabel = document.getElementById('optionsStatus');
const saveButton = document.getElementById('saveSettingsButton');

let currentValue = '';

init();

async function init() {
  const settings = await loadSettings();
  currentValue = settings?.endpoint ?? '';
  endpointInput.value = currentValue;
  updateSaveState();
}

form.addEventListener('input', () => {
  clearStatus();
  updateSaveState();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = endpointInput.value.trim();
  if (!value) {
    showStatus('Endpoint is required.', 'error');
    return;
  }

  saveButton.disabled = true;
  try {
    await saveSettings({ endpoint: value });
    currentValue = value;
    showStatus('Settings saved.', 'success');
  } catch (error) {
    console.error('[options] Failed to save settings', error);
    showStatus('Unable to save. See console for details.', 'error');
  } finally {
    updateSaveState();
  }
});

function updateSaveState() {
  const trimmed = endpointInput.value.trim();
  saveButton.disabled = !trimmed || trimmed === currentValue;
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
