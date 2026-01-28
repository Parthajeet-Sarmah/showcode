import { initSettings } from './settings.js';
import { renderOverview } from './overview.js';
import { initFlow } from './flow.js';
import { renderAlignmentView } from './alignment.js';
import { callSnippetAnalysisApi } from './code.js';
import { getAuthState, parseGitHubUrl, getFileContent } from './github.js';
import { initRepoBrowser, openRepoBrowser } from './repo-browser.js';
import { initCommitHistory, loadHistory as loadCommitHistory, showPanel as showCommitPanel } from './commit-history.js';
import { initDiffViewer, loadDiff } from './diff-viewer.js';

let appData = null;
const urlParams = new URLSearchParams(window.location.search);
const projectParam = urlParams.get('project');
let currentProjectIndex = projectParam !== null && !isNaN(parseInt(projectParam)) 
	? parseInt(projectParam) 
	: (localStorage.getItem("currentProjectIndex") || 0);

document.addEventListener('DOMContentLoaded', async () => {
	appData = await fetchData();

	if (appData && appData.collection && appData.collection.length > 0) {
		// Track original collection length for imported project detection
		originalCollectionLength = appData.collection.length;

		// Load any previously imported projects
		const importedProjects = loadImportedProjects();
		if (importedProjects.length > 0) {
			appData.collection.push(...importedProjects);
		}

		const allFlows = appData.collection.map((p) => p.flow);
		sessionStorage.setItem("flowData", JSON.stringify(allFlows));

		initSettings(document.getElementById('settings-view'));
		setupTabs();

		renderCarousel();

		loadProject(parseInt(currentProjectIndex) || 0);

	} else {
		document.body.innerHTML = `<h3 style="text-align:center; color:red; margin-top:50px;">Failed to load content.json or empty collection</h3>`;
	}

	setupModal();
	setupSelectionLogic();
	setupGitHubComponents();
});

const flowView = document.getElementById("flow-view");
const observer = new MutationObserver((ml) => {
	for (const mutation of ml) {
		if (mutation.type == "attributes" && mutation.attributeName == "class" && mutation.target.classList.contains("active")) {
			const allFlows = JSON.parse(sessionStorage.getItem("flowData"));
			if (allFlows && allFlows[currentProjectIndex]) {
				initFlow(allFlows[currentProjectIndex]);
			}
		}
	}
});
observer.observe(flowView, { attributes: true });

async function fetchData() {
	try {
		const res = await fetch('content.json');
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.json();
	} catch (err) {
		console.error("Error fetching data:", err);
		return null;
	}
}

function loadProject(index) {
	if (!appData || !appData.collection[index]) return;

	currentProjectIndex = index;

	const url = new URL(window.location);
	url.searchParams.set('project', index);
	window.history.replaceState({}, '', url);

	const projectData = appData.collection[index];

	const header = document.getElementById('header-container');
	if (projectData.project) {
		header.innerHTML = `<h1 class="project-title">${projectData.project}</h1>`;
	}

	renderOverview(document.getElementById('overview-view'), projectData.data);
	renderAlignmentView(document.getElementById('alignment-view'), projectData.data);

	updateCarouselUI();

	if (document.getElementById('flow-view').classList.contains('active')) {
		const allFlows = JSON.parse(sessionStorage.getItem("flowData"));
		if (allFlows && allFlows[index]) {
			initFlow(allFlows[index]);
		}
	}
}

function renderCarousel() {
	const container = document.getElementById('project-carousel');
	container.innerHTML = '';

	appData.collection.forEach((project, index) => {
		const dot = document.createElement('div');
		dot.className = 'carousel-dot';
		if (project._imported) {
			dot.classList.add('imported');
		}
		dot.title = project.project || `Project ${index + 1}`;

		dot.addEventListener('click', () => {
			loadProject(index);
			localStorage.setItem("currentProjectIndex", index);
		});

		// Right-click to remove imported projects
		if (project._imported) {
			dot.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				if (confirm(`Remove imported project "${project.project}"?`)) {
					removeImportedProject(index);
				}
			});
		}

		container.appendChild(dot);
	});

	updateCarouselUI();
}

function removeImportedProject(index) {
	const project = appData.collection[index];
	if (!project || !project._imported) return;

	appData.collection.splice(index, 1);

	// Update flow data
	const allFlows = appData.collection.map((p) => p.flow);
	sessionStorage.setItem("flowData", JSON.stringify(allFlows));

	// Save updated imported projects
	saveImportedProjects();

	// Adjust current index if needed
	if (currentProjectIndex >= appData.collection.length) {
		currentProjectIndex = Math.max(0, appData.collection.length - 1);
	} else if (currentProjectIndex > index) {
		currentProjectIndex--;
	}

	renderCarousel();
	loadProject(currentProjectIndex);
	localStorage.setItem("currentProjectIndex", currentProjectIndex);

	if (window.showToast) {
		window.showToast(`Removed "${project.project}"`, 'info');
	}
}

function updateCarouselUI() {
	const dots = document.querySelectorAll('.carousel-dot');
	dots.forEach((dot, idx) => {
		if (idx === currentProjectIndex) {
			dot.classList.add('active');
		} else {
			dot.classList.remove('active');
		}
	});
}

function setupTabs() {
	const tabs = document.querySelectorAll('.tab-btn, .settings-btn');
	tabs.forEach(btn => {
		btn.addEventListener('click', () => {
			const target = btn.dataset.tab;
			tabs.forEach(t => t.classList.remove('active'));
			btn.classList.add('active');

			const carousel = document.getElementById("project-carousel");
			carousel.style.opacity = target === "settings" ? 0 : 1;

			document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
			document.getElementById(`${target}-view`).classList.add('active');
		});
	});
}

function setupModal() {
	const modal = document.getElementById('codeModal');
	const closeBtn = document.getElementById('modalCloseBtn');

	const closeModal = () => {
		modal.classList.remove('open');
		document.getElementById('modalBody').innerHTML = '';
		hideSelectionButton();
	};

	modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
	closeBtn.addEventListener('click', closeModal);
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

let selectionBtn = null;

function setupSelectionLogic() {
	selectionBtn = document.createElement('button');
	selectionBtn.id = 'selection-popup-btn';
	selectionBtn.textContent = 'Analyse Snippet';
	document.body.appendChild(selectionBtn);

	const modalBody = document.getElementById('modalBody');
	modalBody.addEventListener('mouseup', handleSelection);
	modalBody.addEventListener('keyup', handleSelection);

	document.addEventListener('mousedown', (e) => {
		if (e.target !== selectionBtn) {
			hideSelectionButton();
		}
	});

	selectionBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const selection = window.getSelection();
		const selectedText = selection.toString();

		if (selectedText) {
			const rect = selectionBtn.getBoundingClientRect();
			createFloatingWindow(selectedText, rect.left, rect.top);
			hideSelectionButton();
			selection.removeAllRanges();
		}
	});
}

function handleSelection() {
	const selection = window.getSelection();
	const text = selection.toString().trim();
	const modalBody = document.getElementById('modalBody');

	if (text.length > 0 && modalBody.contains(selection.anchorNode)) {
		const range = selection.getRangeAt(0);
		const rect = range.getBoundingClientRect();

		const btnHeight = 40;
		const btnWidth = 140;

		selectionBtn.style.top = `${rect.top - btnHeight}px`;
		selectionBtn.style.left = `${rect.left + (rect.width / 2) - (btnWidth / 2)}px`;
		selectionBtn.style.display = 'block';
	} else {
		hideSelectionButton();
	}
}

function hideSelectionButton() {
	if (selectionBtn) selectionBtn.style.display = 'none';
}

function createFloatingWindow(selectedText, startX, startY) {
	const win = document.createElement('div');
	win.className = 'floating-analysis-window';
	win.style.left = `${startX}px`;
	win.style.top = `${startY}px`;

	win.innerHTML = `
        <div class="floating-header">
            <span class="floating-title">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/><path d="M9 12l2 2 4-4"/></svg>
                AI Analysis
            </span>
            <button class="floating-close-btn">&times;</button>
        </div>
        <div class="floating-content">
            <div class="analysis-loading">
                <div class="spinner"></div>
                <span>Analyzing Code...</span>
            </div>
        </div>
    `;

	document.body.appendChild(win);

	win.querySelector('.floating-close-btn').addEventListener('click', () => {
		win.remove();
	});

	const header = win.querySelector('.floating-header');
	let isDragging = false;
	let offsetX, offsetY;

	header.addEventListener('mousedown', (e) => {
		isDragging = true;
		offsetX = e.clientX - win.getBoundingClientRect().left;
		offsetY = e.clientY - win.getBoundingClientRect().top;
		header.style.cursor = 'grabbing';
	});

	document.addEventListener('mousemove', (e) => {
		if (!isDragging) return;
		win.style.left = `${e.clientX - offsetX}px`;
		win.style.top = `${e.clientY - offsetY}px`;
	});

	document.addEventListener('mouseup', () => {
		isDragging = false;
		header.style.cursor = 'move';
	});

	fetchAnalysis(selectedText, win.querySelector('.floating-content'));
}

async function fetchAnalysis(codeSnippet, container) {
	try {
		await callSnippetAnalysisApi(codeSnippet, container);
	} catch (err) {
		console.log(err);
		container.innerHTML = `<div style="color:red; padding:10px;">Error generating analysis.</div>`;
	}
}

// Store current snippet for GitHub features
let currentSnippet = null;

function setupGitHubComponents() {
	// Initialize Repository Browser
	const repoBrowserModal = document.getElementById('repoBrowserModal');
	if (repoBrowserModal) {
		initRepoBrowser(repoBrowserModal, handleFileSelected, handleProjectImport);
	}

	// Initialize Commit History Panel
	const commitHistoryPanel = document.getElementById('commitHistoryPanel');
	if (commitHistoryPanel) {
		initCommitHistory(commitHistoryPanel, {
			onVersionSelect: handleVersionSelect,
			onCompare: handleCompareVersions,
		});
	}

	// Initialize Diff Viewer
	const diffViewerModal = document.getElementById('diffViewerModal');
	if (diffViewerModal) {
		initDiffViewer(diffViewerModal);
	}
}

function handleProjectImport(projectConfig) {
	if (!appData) {
		appData = { collection: [] };
	}

	// Mark as imported for persistence
	projectConfig._imported = true;

	// Add the new project to the collection
	appData.collection.push(projectConfig);

	// Update flow data in session storage
	const allFlows = appData.collection.map((p) => p.flow);
	sessionStorage.setItem("flowData", JSON.stringify(allFlows));

	// Save to localStorage for persistence
	saveImportedProjects();

	// Re-render carousel with new project
	renderCarousel();

	// Switch to the newly imported project
	const newIndex = appData.collection.length - 1;
	loadProject(newIndex);
	localStorage.setItem("currentProjectIndex", newIndex);
}

function saveImportedProjects() {
	// Save imported projects to localStorage
	// This allows persistence across page reloads
	const toSave = appData.collection.filter(p => p._imported);
	if (toSave.length > 0) {
		localStorage.setItem('showcode_imported_projects', JSON.stringify(toSave));
	} else {
		localStorage.removeItem('showcode_imported_projects');
	}
}

function loadImportedProjects() {
	const saved = localStorage.getItem('showcode_imported_projects');
	if (saved) {
		try {
			const imported = JSON.parse(saved);
			if (Array.isArray(imported) && imported.length > 0) {
				return imported;
			}
		} catch (e) {
			console.error('Failed to load imported projects:', e);
		}
	}
	return [];
}

let originalCollectionLength = 0;

function getOriginalCollectionLength() {
	return originalCollectionLength;
}

function handleFileSelected(snippetData) {
	// Handle file selected from repository browser
	openModal(snippetData);
}

async function handleVersionSelect({ commit, content, path }) {
	// Show the selected version content
	const body = document.getElementById('modalBody');
	if (!body || !currentSnippet) return;

	const language = currentSnippet.language || 'plaintext';
	const markdownString = "```" + language + "\n" + content + "\n```";
	const parsedHtml = marked.parse(markdownString);

	body.innerHTML = `
		<div class="snippet-view-meta">
			<div class="meta-left">
				<span>${path}</span>
				<span class="version-badge">Version: ${commit.sha.slice(0, 7)}</span>
			</div>
			<span>${language.toUpperCase()}</span>
		</div>
		<div class="markdown-body" id="code-content-area">${parsedHtml}</div>
	`;

	body.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
}

function handleCompareVersions(diffInfo) {
	// Load and show diff viewer
	loadDiff(diffInfo);
}

export async function openModal(snippet) {
	const modal = document.getElementById('codeModal');
	const title = document.getElementById('modalTitle');
	const body = document.getElementById('modalBody');

	currentSnippet = snippet;
	title.textContent = snippet.label || snippet.file;
	modal.classList.add('open');
	body.innerHTML = `<div class="loading-text">Fetching ${snippet.file}...</div>`;

	function trimLines(code, startLine, endLine) {
		const lines = code.split(/\r?\n/); // handles \n and \r\n
		return lines.slice(startLine - 1, endLine).join('\n');
	}

	// Determine if we can use GitHub API features
	const authState = getAuthState();
	const githubInfo = snippet.github || parseGitHubUrl(snippet.repoUrl);
	const canUseGitHubFeatures = authState.authenticated && githubInfo;

	try {
		let rawCode;

		// Try GitHub API if authenticated and available
		if (canUseGitHubFeatures && snippet.github?.requiresAuth) {
			const fileData = await getFileContent(
				githubInfo.owner,
				githubInfo.repo,
				githubInfo.path,
				githubInfo.ref
			);
			rawCode = fileData.content;
		} else {
			// Fall back to raw URL
			const res = await fetch(snippet.repoUrl);
			if (!res.ok) throw new Error('Network error');
			rawCode = await res.text();
		}

		if (snippet.lineStart && snippet.lineEnd) {
			rawCode = trimLines(rawCode, snippet.lineStart, snippet.lineEnd);
		}

		const markdownString = "```" + snippet.language + "\n" + rawCode + "\n```";
		const parsedHtml = marked.parse(markdownString);

		// Build GitHub actions if available
		let githubActions = '';
		if (canUseGitHubFeatures) {
			githubActions = `
				<div class="github-actions">
					<button class="btn-github-action" id="btnShowHistory" title="View commit history">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
							<circle cx="12" cy="12" r="4"></circle>
							<line x1="1.05" y1="12" x2="7" y2="12"></line>
							<line x1="17.01" y1="12" x2="22.96" y2="12"></line>
						</svg>
						History
					</button>
				</div>
			`;
		}

		body.innerHTML = `
            <div class="snippet-view-meta">
                <div class="meta-left">
                    <span>${snippet.file} ${snippet.lineStart && snippet.lineEnd ? `(Lines ${snippet.lineStart}-${snippet.lineEnd})` : ``}</span>
                    <a target="_blank" class="snippet-github-link" href="${snippet.githubFileUrl}">
                        <i class="devicon-github-original"></i> GitHub
                    </a>
					${githubActions}
                </div>
                <span>${snippet.language.toUpperCase()}</span>
            </div>
            <div class="markdown-body" id="code-content-area">${parsedHtml}</div>
        `;

		body.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));

		// Attach history button handler
		const historyBtn = document.getElementById('btnShowHistory');
		if (historyBtn && githubInfo) {
			historyBtn.addEventListener('click', () => {
				loadCommitHistory({
					owner: githubInfo.owner,
					repo: githubInfo.repo,
					path: githubInfo.path,
					ref: githubInfo.ref || 'main',
				});
				showCommitPanel();
			});
		}
	} catch (error) {
		body.innerHTML = `<div class="loading-text" style="color:red">Error: ${error.message}</div>`;
	}
}
