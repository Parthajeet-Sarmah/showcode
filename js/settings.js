import { encryptWithPublicKey } from './encryption.js';

const SETTINGS_KEY = 'showcode_app_settings';

// Default state including new providers and default selections
let currentSettings = {
	geminiEncrypted: '',
	openaiEncrypted: '',
	anthropicEncrypted: '',
	grokEncrypted: '',
	useLocalProvider: true,
	defaultCloudProvider: 'gemini', // Default selection
	defaultLocalProvider: 'ollama', // Default selection
	ollama: {
		url: 'http://localhost:11434',
		snippetModel: '',
		alignmentModel: '',
		status: false,
	},
	llama: {
		url: 'http://localhost:8080',
		snippetModel: '',
		alignmentModel: '',
		status: false,
	}
};

export function initSettings(container) {
	loadSettings();
	renderSettings(container);
	attachEventListeners();
}

function loadSettings() {
	const saved = localStorage.getItem(SETTINGS_KEY);
	if (saved) {
		const parsed = JSON.parse(saved);
		currentSettings = {
			...currentSettings,
			...parsed,
			ollama: { ...currentSettings.ollama, ...parsed.ollama },
			llama: { ...currentSettings.llama, ...parsed.llama }
		};
	}
}

async function saveSettings() {
	let hasError = false; // Track if any critical failure occurred

	const processKey = async (inputId, settingKey, pemContent = "") => {
		const rawInput = document.getElementById(inputId).value.trim();

		// Encrypt only if there is a new value (not just the placeholder bullets)
		if (rawInput && !rawInput.startsWith('•')) {

			// Check for PEM file BEFORE trying to encrypt
			if (!pemContent) {
				if (window.showToast) window.showToast(`Cannot save ${settingKey.replace('Encrypted', '')}: PEM file required.`, "error");
				hasError = true;
				return;
			}

			try {
				const encrypted = await encryptWithPublicKey(rawInput, pemContent);
				currentSettings[settingKey] = encrypted.ciphertext || encrypted;
				document.getElementById(inputId).value = "";
			} catch (e) {
				console.error(`Failed to encrypt ${settingKey}`, e);
				if (window.showToast) window.showToast(`Encryption failed for ${settingKey}`, "error");
				hasError = true;
			}
		}
	};

	if (window.showToast) window.showToast("Saving settings...", "info");

	// 1. Get PEM content globally
	let pemContent = "";
	const pemFileInput = document.getElementById('pem-key-file');
	if (pemFileInput && pemFileInput.files.length > 0) {
		const file = pemFileInput.files[0];
		pemContent = await new Promise((resolve) => {
			const reader = new FileReader();
			reader.onload = (e) => resolve(e.target.result);
			reader.readAsText(file);
		});
	}

	// 2. Process all cloud provider keys
	// The hasError flag will be updated inside these calls if something goes wrong
	await processKey('gemini-key', 'geminiEncrypted', pemContent);
	await processKey('openai-key', 'openaiEncrypted', pemContent);
	await processKey('anthropic-key', 'anthropicEncrypted', pemContent);
	await processKey('grok-key', 'grokEncrypted', pemContent);

	// [QoL Change] Auto-select default Cloud Provider if only one is configured
	const cloudProviders = ['gemini', 'openai', 'anthropic', 'grok'];
	const configuredCloud = cloudProviders.filter(p => currentSettings[p + 'Encrypted']);

	if (configuredCloud.length === 1) {
		currentSettings.defaultCloudProvider = configuredCloud[0];
	}
	else if (configuredCloud.length > 1 && !currentSettings[currentSettings.defaultCloudProvider + 'Encrypted']) {
		currentSettings.defaultCloudProvider = configuredCloud[0];
	}

	if (pemFileInput) pemFileInput.value = "";
	const display = document.getElementById('pem-file-display');
	if (display) { display.textContent = "No file selected"; display.classList.remove('has-file'); }

	// 3. Local Providers (Always save these)
	currentSettings.ollama.url = document.getElementById('ollama-url').value;
	currentSettings.llama.url = document.getElementById('llama-url').value;

	// Persist whatever valid state we have
	localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));

	// If errors occurred, we leave the save bar up and the inputs as-is so the user can fix them.
	if (!hasError) {
		if (window.showToast) window.showToast('Settings saved successfully', 'success');
		document.getElementById('save-bar').classList.remove('visible');

		// Re-render
		const openCardId = document.querySelector('.settings-card.open')?.id;
		renderSettings(document.getElementById('settings-view'));
		attachEventListeners();

		if (openCardId) {
			const card = document.getElementById(openCardId);
			if (card) card.classList.add('open');
		}
	}
}
function renderSettings(container) {
	if (!container) return;

	const renderKeyInput = (id, settingKey, placeholder) => {
		const isSaved = !!currentSettings[settingKey];
		const ph = isSaved ? "•••••••• [Encrypted Key Saved] ••••••••" : placeholder;
		const cls = isSaved ? "settings-input saved" : "settings-input";
		const clearStyle = isSaved ? "display:block" : "display:none";

		return `
            <div class="input-wrapper">
                <input type="password" id="${id}" class="${cls}" placeholder="${ph}">
                <button class="btn-action btn-clear" data-target="${settingKey}" data-input="${id}" style="${clearStyle}">Clear</button>
            </div>
            <p class="settings-helper-text">Key is encrypted in the browser before storage.</p>
        `;
	};

	container.innerHTML = `
        <div class="settings-container">
            
            <div class="settings-card" id="card-security">
                <div class="settings-header">
                    <div class="settings-header-left">
                        <div class="settings-icon" style="color: #475569; background: #f1f5f9;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        </div>
                        <div>
                            <h3 class="settings-title">Security & Encryption<span style="margin-left: 4px; color: red;">*</span></h3>
                            <span class="provider-type">Global Configuration</span>
                        </div>
                    </div>
                    <div class="accordion-controls">
                        <svg class="chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
                <div class="settings-body">
                    <div class="input-group">
                        <label class="input-label">Public Key (PEM File)</label>
                        <input type="file" id="pem-key-file" accept=".pem" class="hidden-file-input">
                        <label for="pem-key-file" class="file-upload-label">
                            <span id="pem-file-display" class="file-name-display">No file selected</span>
                            <span class="file-custom-btn">Browse PEM</span>
                        </label>
                        <p class="settings-helper-text">
                             <b>For Cloud Users</b>
														 <br>
														 Download a <code>.pem</code> file containing the RSA public key from <code style="padding: 0px 6px; border-radius: 2px; background-color: #f1f5f9"><a target="_blank" href="http://localhost:8000/.well-known/rsa-key">https://localhost:8000/.well-known/rsa-key</a> (Last Rotation on: 2025/12/25 11:19 A.M. UTC)</code>. This key is used to encrypt all Cloud Provider API keys before they are stored.
														 <br>
														 <br>
														 <b>For Self-Hosted Users</b>
														 <br>
														 Create a PKCS#1 RSA key pair via openssl: <code style="padding: 0px 6px; border-radius: 2px; background-color: #f1f5f9">
															openssl genrsa -out rsa_private.pem 4096 && openssl rsa -in rsa_private.pem -pubout -out rsa_public.pem</code>. Use the private key in the backend.
                        </p>
                    </div>
                </div>
            </div>
            
            <div class="settings-card" id="card-defaults">
                <div class="settings-header">
                    <div class="settings-header-left">
                        <div class="settings-icon" style="color: var(--primary); background: #eff6ff;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                        </div>
                        <div>
                            <h3 class="settings-title">Default Providers</h3>
                            <span class="provider-type">Preferred Model Selection</span>
                        </div>
                    </div>
                    <div class="accordion-controls">
                        <svg class="chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
                <div class="settings-body">
                    
                    <div class="input-group" style="flex-direction: row; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border); padding-bottom: 20px; margin-bottom: 20px;">
                        <div>
                            <label class="input-label" style="margin-bottom: 2px;">Use Local Provider</label>
                            <p class="settings-helper-text" style="margin: 0;">Prioritize local inference if available</p>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" id="use-local-toggle" ${currentSettings.useLocalProvider ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                    </div>
                    
                    <div class="input-group">
                        <label class="input-label">Primary Cloud Provider</label>
                        <div class="radio-options">
                            <label class="model-radio-label">
                                <input type="radio" name="defaultCloud" value="gemini" ${currentSettings.defaultCloudProvider === 'gemini' ? 'checked' : ''}>
                                <span>Gemini</span>
                            </label>
                            <label class="model-radio-label">
                                <input type="radio" name="defaultCloud" value="openai" ${currentSettings.defaultCloudProvider === 'openai' ? 'checked' : ''}>
                                <span>OpenAI</span>
                            </label>
                            <label class="model-radio-label">
                                <input type="radio" name="defaultCloud" value="anthropic" ${currentSettings.defaultCloudProvider === 'anthropic' ? 'checked' : ''}>
                                <span>Anthropic</span>
                            </label>
                            <label class="model-radio-label">
                                <input type="radio" name="defaultCloud" value="grok" ${currentSettings.defaultCloudProvider === 'grok' ? 'checked' : ''}>
                                <span>Grok</span>
                            </label>
                        </div>
                    </div>
                    <div class="input-group" style="margin-top: 15px;">
                        <label class="input-label">Primary Local Provider</label>
                        <div class="radio-options">
                            <label class="model-radio-label">
                                <input type="radio" name="defaultLocal" value="ollama" ${currentSettings.defaultLocalProvider === 'ollama' ? 'checked' : ''}>
                                <span>Ollama</span>
                            </label>
                            <label class="model-radio-label">
                                <input type="radio" name="defaultLocal" value="llama" ${currentSettings.defaultLocalProvider === 'llama' ? 'checked' : ''}>
                                <span>llama-server</span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            <div>
                <h4 style="padding-left: 5px; margin: 0; color: var(--text-sub);">Cloud Providers</h4>
            </div>

            <div class="settings-card" id="card-gemini" data-provider="gemini">
                <div class="settings-header">
                    <div class="settings-header-left">
                        <div class="settings-icon">
                            <img src="../assets/model_icons/gemini.svg" />
                        </div>
                        <div>
                            <h3 class="settings-title">Google (Gemini)</h3>
                            <span class="provider-type">Cloud Provider</span>
                        </div>
                    </div>
                    <div class="accordion-controls">
                        <span class="status-badge ${currentSettings.geminiEncrypted ? 'connected' : 'default'}">
                            ${currentSettings.geminiEncrypted ? 'Configured' : 'Not Configured'}
                        </span>
                        <svg class="chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
                <div class="settings-body">
                    <div class="input-group">
                        <label class="input-label">API Key</label>
                        ${renderKeyInput('gemini-key', 'geminiEncrypted', 'sk-...')}
                    </div>
                </div>
            </div>

            <div class="settings-card" id="card-openai" data-provider="openai">
                <div class="settings-header">
                    <div class="settings-header-left">
                        <div class="settings-icon">
                            <img src="../assets/model_icons/openai.svg" />
                        </div>
                        <div>
                            <h3 class="settings-title">OpenAI (ChatGPT)</h3>
                            <span class="provider-type">Cloud Provider</span>
                        </div>
                    </div>
                    <div class="accordion-controls">
                        <span class="status-badge ${currentSettings.openaiEncrypted ? 'connected' : 'default'}">
                            ${currentSettings.openaiEncrypted ? 'Configured' : 'Not Configured'}
                        </span>
                        <svg class="chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
                <div class="settings-body">
                    <div class="input-group">
                        <label class="input-label">API Key</label>
                        ${renderKeyInput('openai-key', 'openaiEncrypted', 'sk-...')}
                    </div>
                </div>
            </div>

            <div class="settings-card" id="card-anthropic" data-provider="anthropic">
                <div class="settings-header">
                    <div class="settings-header-left">
                        <div class="settings-icon">
                            <img src="../assets/model_icons/claude.svg" />
                        </div>
                        <div>
                            <h3 class="settings-title">Anthropic (Claude)</h3>
                            <span class="provider-type">Cloud Provider</span>
                        </div>
                    </div>
                    <div class="accordion-controls">
                        <span class="status-badge ${currentSettings.anthropicEncrypted ? 'connected' : 'default'}">
                            ${currentSettings.anthropicEncrypted ? 'Configured' : 'Not Configured'}
                        </span>
                        <svg class="chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
                <div class="settings-body">
                    <div class="input-group">
                        <label class="input-label">API Key</label>
                        ${renderKeyInput('anthropic-key', 'anthropicEncrypted', 'sk-ant-...')}
                    </div>
                </div>
            </div>

            <div class="settings-card" id="card-grok" data-provider="grok">
                <div class="settings-header">
                    <div class="settings-header-left">
                        <div class="settings-icon">
                            <img src="../assets/model_icons/grok.svg" />
                        </div>
                        <div>
                            <h3 class="settings-title">xAI (Grok)</h3>
                            <span class="provider-type">Cloud Provider</span>
                        </div>
                    </div>
                    <div class="accordion-controls">
                        <span class="status-badge ${currentSettings.grokEncrypted ? 'connected' : 'default'}">
                            ${currentSettings.grokEncrypted ? 'Configured' : 'Not Configured'}
                        </span>
                        <svg class="chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
                <div class="settings-body">
                    <div class="input-group">
                        <label class="input-label">API Key</label>
                        ${renderKeyInput('grok-key', 'grokEncrypted', 'xai-...')}
                    </div>
                </div>
            </div>

            <div>
                <h4 style="padding-left: 5px; margin: 0; color: var(--text-sub);">Local Providers</h4>
            </div>

            <div class="settings-card" id="card-ollama" data-provider="ollama">
                <div class="settings-header">
                    <div class="settings-header-left">
                        <div class="settings-icon">
                            <img src="../assets/model_icons/ollama.svg" />
                        </div>
                        <div>
                            <h3 class="settings-title">Ollama</h3>
                            <span class="provider-type">Local Inference</span>
                        </div>
                    </div>
                    <div class="accordion-controls">
                        <span id="ollama-status" class="status-badge default">Disconnected</span>
                        <svg class="chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
                <div class="settings-body">
                    <div class="input-group">
                        <label class="input-label">Server URL</label>
                        <div class="input-wrapper">
                            <input type="text" id="ollama-url" class="settings-input" placeholder="http://localhost:11434" value="${currentSettings.ollama.url}">
                            <button class="btn-action" id="btn-check-ollama">Connect</button>
                        </div>
                    </div>
                    <div id="ollama-models-area" class="model-selection-area">
                        <div class="radio-group-container">
                            <span class="radio-group-label">Snippet Analysis Model</span>
                            <div class="radio-options" id="ollama-snippet-options"></div>
                        </div>
                        <div class="radio-group-container">
                            <span class="radio-group-label">Alignment Analysis Model</span>
                            <div class="radio-options" id="ollama-alignment-options"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="settings-card" id="card-llama" data-provider="llama">
                <div class="settings-header">
                    <div class="settings-header-left">
                        <div class="settings-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                        </div>
                        <div>
                            <h3 class="settings-title">llama-server (llama.cpp)</h3>
                            <span class="provider-type">Local Inference</span>
                        </div>
                    </div>
                    <div class="accordion-controls">
                        <span id="llama-status" class="status-badge default">Disconnected</span>
                        <svg class="chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
                <div class="settings-body">
                    <div class="input-group">
                        <label class="input-label">Server URL</label>
                        <div class="input-wrapper">
                            <input type="text" id="llama-url" class="settings-input" placeholder="http://localhost:8080" value="${currentSettings.llama.url}">
                            <button class="btn-action" id="btn-check-llama">Connect</button>
                        </div>
                    </div>
                    <div id="llama-models-area" class="model-selection-area">
                        <div class="radio-group-container">
                            <span class="radio-group-label">Snippet Analysis Model</span>
                            <div class="radio-options" id="llama-snippet-options"></div>
                        </div>
                        <div class="radio-group-container">
                            <span class="radio-group-label">Alignment Analysis Model</span>
                            <div class="radio-options" id="llama-alignment-options"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div id="save-bar" class="save-bar">
            <span>You have unsaved changes</span>
            <button id="btn-save-settings" class="btn-save">Save Changes</button>
        </div>
    `;

	if (currentSettings.ollama.url) checkConnection('ollama', currentSettings.ollama.url, true);
	if (currentSettings.llama.url) checkConnection('llama', currentSettings.llama.url, true);
}

function attachEventListeners() {
	const saveBar = document.getElementById('save-bar');
	const showSave = () => saveBar.classList.add('visible');

	// Accordion Logic
	document.querySelectorAll('.settings-header').forEach(header => {
		header.addEventListener('click', (e) => {
			if (e.target.closest('button') || e.target.closest('input')) return;
			const card = header.closest('.settings-card');
			const isOpen = card.classList.contains('open');
			document.querySelectorAll('.settings-card').forEach(c => c.classList.remove('open'));
			if (!isOpen) {
				card.classList.add('open');
			}
		});
	});

	const localToggle = document.getElementById('use-local-toggle');
	if (localToggle) {
		localToggle.addEventListener('change', (e) => {
			currentSettings.useLocalProvider = e.target.checked;
			showSave();
		});
	}

	// Default Provider Listeners
	document.querySelectorAll('input[name="defaultCloud"]').forEach(radio => {
		radio.addEventListener('change', (e) => {
			currentSettings.defaultCloudProvider = e.target.value;
			showSave();
		});
	});

	document.querySelectorAll('input[name="defaultLocal"]').forEach(radio => {
		radio.addEventListener('change', (e) => {
			currentSettings.defaultLocalProvider = e.target.value;
			showSave();
		});
	});

	// Dynamic Clear Buttons
	document.querySelectorAll('.btn-clear').forEach(btn => {
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			const targetKey = btn.dataset.target;
			const inputId = btn.dataset.input;

			currentSettings[targetKey] = "";
			const input = document.getElementById(inputId);
			if (input) {
				input.value = "";
				input.classList.remove('saved');
				input.placeholder = "Enter API Key";
			}
			btn.style.display = 'none';
			showSave();
		});
	});

	// Input Listeners
	const inputs = ['gemini-key', 'openai-key', 'anthropic-key', 'grok-key'];
	inputs.forEach(id => {
		const el = document.getElementById(id);
		if (el) el.addEventListener('input', showSave);
	});

	// Global PEM File Listener
	const pemInput = document.getElementById('pem-key-file');
	const pemDisplay = document.getElementById('pem-file-display');
	if (pemInput) {
		pemInput.addEventListener('change', (e) => {
			if (e.target.files.length > 0) {
				pemDisplay.textContent = e.target.files[0].name;
				pemDisplay.classList.add('has-file');
			} else {
				pemDisplay.textContent = "No file selected";
				pemDisplay.classList.remove('has-file');
			}
			showSave();
		});
	}

	// Local Provider Connect Buttons
	const setupConnect = (type) => {
		const btn = document.getElementById(`btn-check-${type}`);
		if (btn) {
			btn.addEventListener('click', async (e) => {
				e.stopPropagation();
				const url = document.getElementById(`${type}-url`).value.trim();
				currentSettings[type].url = url;
				let hasConnected = await checkConnection(type, url);
				if (hasConnected) showSave();
			});
		}
	};
	setupConnect('ollama');
	setupConnect('llama');

	document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
}

async function checkConnection(type, url, silent = false) {
	const statusBadge = document.getElementById(`${type}-status`);
	const area = document.getElementById(`${type}-models-area`);

	if (!statusBadge || !area) return false;

	statusBadge.textContent = "Connecting...";
	statusBadge.className = "status-badge default";

	try {
		let endpoint = type === 'ollama' ? '/api/tags' : '/v1/models';
		const cleanUrl = url.replace(/\/$/, '');

		const res = await fetch(`${cleanUrl}${endpoint}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();

		let models = [];
		if (type === 'ollama') {
			models = data.models?.map(m => m.name) || [];
		} else {
			models = data.data?.map(m => m.id) || [];
		}

		statusBadge.textContent = "Connected";
		statusBadge.className = "status-badge connected";
		area.classList.add('active');

		currentSettings[type].status = true;

		renderModelRadios(type, models);

		const otherType = type === 'ollama' ? 'llama' : 'ollama';
		const isDefaultProviderPresentAndThis = currentSettings.defaultLocalProvider && currentSettings.defaultLocalProvider === type

		if (currentSettings[type].status && (isDefaultProviderPresentAndThis || !currentSettings[otherType].status)) {
			currentSettings.defaultLocalProvider = type;
			const radio = document.querySelector(`input[name="defaultLocal"][value="${type}"]`);
			if (radio) radio.checked = true;
		}

		if (!silent && window.showToast) window.showToast(`Connected to ${type}`, 'success');

		return true;

	} catch (err) {
		console.error(err);
		currentSettings[type].status = false;
		statusBadge.textContent = "Connection Failed";
		statusBadge.className = "status-badge error";
		area.classList.remove('active');
		if (!silent && window.showToast) window.showToast(`Could not connect to ${type}`, 'error');
		return false;
	}
}

function renderModelRadios(type, models) {
	const snippetContainer = document.getElementById(`${type}-snippet-options`);
	const alignContainer = document.getElementById(`${type}-alignment-options`);

	if (!snippetContainer || !alignContainer) return;

	const createRadio = (modelName, category) => {
		const label = document.createElement('label');
		label.className = 'model-radio-label';

		const input = document.createElement('input');
		input.type = 'radio';
		input.name = `${type}-${category}`;
		input.value = modelName;

		if (currentSettings[type][`${category}Model`] === modelName) {
			input.checked = true;
		}

		input.addEventListener('change', () => {
			currentSettings[type][`${category}Model`] = modelName;
			document.getElementById('save-bar').classList.add('visible');
		});

		const span = document.createElement('span');
		span.textContent = modelName;

		label.appendChild(input);
		label.appendChild(span);
		return label;
	};

	snippetContainer.innerHTML = '';
	alignContainer.innerHTML = '';

	if (models.length === 0) {
		snippetContainer.innerHTML = '<span style="font-size:0.8rem; color:var(--text-sub)">No models found</span>';
		return;
	}

	models.forEach(m => {
		snippetContainer.appendChild(createRadio(m, 'snippet'));
		alignContainer.appendChild(createRadio(m, 'alignment'));
	});
}

export function getSettingsHeaders() {
	const headers = {
		'x-default-cloud-provider': currentSettings.defaultCloudProvider,
		'x-default-local-provider': currentSettings.defaultLocalProvider
	};

	// Only attach the key for the cloud provider currently set as default
	const cloudKeyMap = {
		'gemini': 'geminiEncrypted',
		'openai': 'openaiEncrypted',
		'anthropic': 'anthropicEncrypted',
		'grok': 'grokEncrypted'
	};

	const activeCloudKey = cloudKeyMap[currentSettings.defaultCloudProvider];
	if (activeCloudKey && currentSettings[activeCloudKey]) {
		headers['x-cloud-api-key'] = currentSettings[activeCloudKey]; // Use a generic header name
	}

	// Attach the active local provider URL
	if (currentSettings.defaultLocalProvider === 'ollama') {
		headers['x-local-url'] = currentSettings.ollama.url;
		headers['x-local-snippet-model'] = currentSettings.ollama.snippetModel;
		headers['x-local-alignment-model'] = currentSettings.ollama.alignmentModel;
	} else if (currentSettings.defaultLocalProvider === 'llama') {
		headers['x-local-url'] = currentSettings.llama.url;
		headers['x-local-snippet-model'] = currentSettings.llama.snippetModel;
		headers['x-local-alignment-model'] = currentSettings.llama.alignmentModel;
	}

	headers['x-use-local-provider'] = currentSettings.useLocalProvider;

	return headers;
}
