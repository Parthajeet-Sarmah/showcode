import { API_BASE_URL } from './config.js';
import { encryptWithPublicKey } from './encryption.js';
import { getAuthState, onAuthStateChange, login as githubLogin, logout as githubLogout } from './github.js';
import { openRepoBrowser } from './repo-browser.js';

const SETTINGS_KEY = 'showcode_app_settings';

let currentSettings = {
	geminiEncrypted: {},
	openaiEncrypted: {},
	anthropicEncrypted: {},
	grokEncrypted: {},
	useLocalProvider: true,
	defaultCloudProvider: 'gemini',
	defaultLocalProvider: 'ollama',
	ollama: {
		url: 'http://localhost:11434',
		snippetModel: '',
		alignmentModel: '',
		status: false,
	},
	srvllama: {
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
			srvllama: { ...currentSettings.srvllama, ...parsed.srvllama }
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
				currentSettings[settingKey] = encrypted;
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
	currentSettings.srvllama.url = document.getElementById('srvllama-url').value;

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
		const isSaved = !!Object.entries(currentSettings[settingKey]).length;
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
														 Download a <code>.pem</code> file containing the RSA public key from <code style="padding: 0px 6px; border-radius: 2px; background-color: #f1f5f9"><a target="_blank" href="${API_BASE_URL}/.well-known/rsa-key">${API_BASE_URL}/.well-known/rsa-key</a> (Last Rotation on: 2025/12/25 11:19 A.M. UTC)</code>. This key is used to encrypt all Cloud Provider API keys before they are stored.
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

            <div class="settings-card" id="card-github">
                <div class="settings-header">
                    <div class="settings-header-left">
                        <div class="settings-icon" style="color: #24292f; background: #f6f8fa;">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                            </svg>
                        </div>
                        <div>
                            <h3 class="settings-title">GitHub Integration</h3>
                            <span class="provider-type">Repository Access</span>
                        </div>
                    </div>
                    <div class="accordion-controls">
                        <span id="github-status" class="status-badge default">Not Connected</span>
                        <svg class="chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
                <div class="settings-body">
                    <div class="github-auth-container" id="github-auth-container">
                        <div class="github-auth-loading">
                            <div class="spinner"></div>
                            <span>Checking authentication...</span>
                        </div>
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
                                <input type="radio" name="defaultLocal" value="srvllama" ${currentSettings.defaultLocalProvider === 'srvllama' ? 'checked' : ''}>
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
                        <span class="status-badge ${Object.entries(currentSettings.geminiEncrypted).length > 0 ? 'connected' : 'default'}">
                            ${Object.entries(currentSettings.geminiEncrypted).length > 0 ? 'Configured' : 'Not Configured'}
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
                        <span class="status-badge ${Object.entries(currentSettings.openaiEncrypted).length > 0 ? 'connected' : 'default'}">
                            ${Object.entries(currentSettings.openaiEncrypted).length > 0 ? 'Configured' : 'Not Configured'}
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
                        <span class="status-badge ${Object.entries(currentSettings.anthropicEncrypted).length > 0 ? 'connected' : 'default'}">
                            ${Object.entries(currentSettings.anthropicEncrypted).length > 0 ? 'Configured' : 'Not Configured'}
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
                        <span class="status-badge ${Object.entries(currentSettings.grokEncrypted).length > 0 ? 'connected' : 'default'}">
                            ${Object.entries(currentSettings.grokEncrypted).length > 0 ? 'Configured' : 'Not Configured'}
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

            <div class="settings-card" id="card-srvllama" data-provider="srvllama">
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
                        <span id="srvllama-status" class="status-badge default">Disconnected</span>
                        <svg class="chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
                <div class="settings-body">
                    <div class="input-group">
                        <label class="input-label">Server URL</label>
                        <div class="input-wrapper">
                            <input type="text" id="srvllama-url" class="settings-input" placeholder="http://localhost:8080" value="${currentSettings.srvllama.url}">
                            <button class="btn-action" id="btn-check-srvllama">Connect</button>
                        </div>
                    </div>
                    <div id="srvllama-models-area" class="model-selection-area">
                        <div class="radio-group-container">
                            <span class="radio-group-label">Snippet Analysis Model</span>
                            <div class="radio-options" id="srvllama-snippet-options"></div>
                        </div>
                        <div class="radio-group-container">
                            <span class="radio-group-label">Alignment Analysis Model</span>
                            <div class="radio-options" id="srvllama-alignment-options"></div>
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
	if (currentSettings.srvllama.url) checkConnection('srvllama', currentSettings.srvllama.url, true);

	// Setup GitHub auth state listener
	onAuthStateChange(renderGitHubAuth);
}

function renderGitHubAuth(authState) {
	const container = document.getElementById('github-auth-container');
	const statusBadge = document.getElementById('github-status');

	if (!container) return;

	if (authState.loading) {
		container.innerHTML = `
			<div class="github-auth-loading">
				<div class="spinner"></div>
				<span>Checking authentication...</span>
			</div>
		`;
		if (statusBadge) {
			statusBadge.textContent = 'Checking...';
			statusBadge.className = 'status-badge default';
		}
		return;
	}

	if (authState.authenticated && authState.user) {
		container.innerHTML = `
			<div class="github-auth-connected">
				<div class="github-user-info">
					<img src="${authState.user.avatar_url}" alt="${authState.user.login}" class="github-avatar">
					<div class="github-user-details">
						<span class="github-username">${authState.user.name || authState.user.login}</span>
						<span class="github-login">@${authState.user.login}</span>
					</div>
				</div>
				<div class="github-auth-actions">
					<button class="btn-action btn-github-browse">Browse Repositories</button>
					<a href="${authState.user.html_url}" target="_blank" class="btn-action btn-github-profile">View Profile</a>
					<button class="btn-action btn-github-disconnect">Disconnect</button>
				</div>
			</div>
			<p class="settings-helper-text">
				Connected to GitHub. You can now browse private repositories, view commit history, and track changes.
			</p>
		`;
		if (statusBadge) {
			statusBadge.textContent = 'Connected';
			statusBadge.className = 'status-badge connected';
		}

		// Attach browse repositories handler
		container.querySelector('.btn-github-browse')?.addEventListener('click', () => {
			openRepoBrowser();
		});

		// Attach disconnect handler
		container.querySelector('.btn-github-disconnect')?.addEventListener('click', async () => {
			await githubLogout();
			if (window.showToast) window.showToast('Disconnected from GitHub', 'info');
		});
	} else {
		container.innerHTML = `
			<div class="github-auth-disconnected">
				<p class="github-auth-description">
					Connect your GitHub account to access private repositories, view commit history, compare versions, and receive webhook notifications.
				</p>
				<button class="btn-action btn-github-connect">
					<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
						<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
					</svg>
					Connect to GitHub
				</button>
			</div>
			<p class="settings-helper-text">
				This will redirect you to GitHub to authorize the application. We request access to read your repositories and manage webhooks.
			</p>
		`;
		if (statusBadge) {
			statusBadge.textContent = 'Not Connected';
			statusBadge.className = 'status-badge default';
		}

		// Attach connect handler
		container.querySelector('.btn-github-connect')?.addEventListener('click', () => {
			githubLogin(window.location.pathname);
		});
	}
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

			currentSettings[targetKey] = {};
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
	setupConnect('srvllama');

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

		const otherType = type === 'ollama' ? 'srvllama' : 'ollama';
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

	if (!models.includes(currentSettings[type]['snippetModel'])) currentSettings[type]['snippetModel'] = '';
	if (!models.includes(currentSettings[type]['alignmentModel'])) currentSettings[type]['alignmentModel'] = '';

	const createRadio = (modelName, category) => {
		const label = document.createElement('label');
		label.className = 'model-radio-label';

		const input = document.createElement('input');
		input.type = 'radio';
		input.name = `${type}-${category}`;
		input.value = modelName;

		if (currentSettings[type][`${category}Model`] === '') {
			input.checked = true;
			currentSettings[type][`${category}Model`] = modelName;
		}
		else if (currentSettings[type][`${category}Model`] === modelName) {
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
		'X-Default-Cloud-Provider': currentSettings.defaultCloudProvider,
		'X-Default-Local-Provider': currentSettings.defaultLocalProvider
	};

	// Only attach the key for the cloud provider currently set as default
	const cloudKeyMap = {
		'gemini': 'geminiEncrypted',
		'openai': 'openaiEncrypted',
		'anthropic': 'anthropicEncrypted',
		'grok': 'grokEncrypted'
	};

	const activeCloudKey = cloudKeyMap[currentSettings.defaultCloudProvider];
	if (activeCloudKey && Object.entries(currentSettings[activeCloudKey]).length) {
		headers['X-Cloud-Api-Key'] = currentSettings[activeCloudKey].ciphertext; // Use a generic header name
		headers['X-Cloud-Encrypted-Key'] = currentSettings[activeCloudKey].encryptedKey;
		headers['X-Cloud-IV'] = currentSettings[activeCloudKey].iv;
	}

	// Attach the active local provider URL
	if (currentSettings.defaultLocalProvider === 'ollama') {
		headers['X-Local-Url'] = currentSettings.ollama.url;
		headers['X-Local-Snippet-Model'] = currentSettings.ollama.snippetModel;
		headers['X-Local-Alignment-Model'] = currentSettings.ollama.alignmentModel;
	} else if (currentSettings.defaultLocalProvider === 'srvllama') {
		headers['X-Local-Url'] = currentSettings.srvllama.url;
		headers['X-Local-Snippet-Model'] = currentSettings.srvllama.snippetModel;
		headers['X-Local-Alignment-Model'] = currentSettings.srvllama.alignmentModel;
	}

	headers['X-Use-Local-Provider'] = currentSettings.useLocalProvider;

	return headers;
}
