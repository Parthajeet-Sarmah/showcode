import { initSettings } from './settings.js';
import { renderOverview } from './overview.js';
import { initFlow } from './flow.js';
import { renderAlignmentView } from './alignment.js';
import { callCodeAnalysisApi, callSnippetAnalysisApi } from './code.js';


document.addEventListener('DOMContentLoaded', async () => {
	const appData = await fetchData();
	if (appData) {
		sessionStorage.setItem("flowData", JSON.stringify(appData.flow, null, 2));


		const header = document.getElementById('header-container');
		if (appData.project) {
			header.innerHTML = `<h1 class="project-title">${appData.project}</h1>`;
		}


		renderOverview(document.getElementById('overview-view'), appData.data);
		renderAlignmentView(document.getElementById('alignment-view'), appData.data);

		initSettings(document.getElementById('settings-view'));

		setupTabs();
	} else {
		document.body.innerHTML = `<h3 style="text-align:center; color:red; margin-top:50px;">Failed to load content.json</h3>`;
	}


	setupModal();
	setupSelectionLogic();
});


const flowView = document.getElementById("flow-view");
const observer = new MutationObserver((ml) => {
	for (const mutation of ml) {
		if (mutation.type == "attributes" && mutation.attributeName == "class" && mutation.target.classList.contains("active")) {
			const flowData = JSON.parse(sessionStorage.getItem("flowData"));
			if (flowData) initFlow(flowData);
			sessionStorage.removeItem("flowData");
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

function setupTabs() {
	const tabs = document.querySelectorAll('.tab-btn, .settings-btn');
	tabs.forEach(btn => {
		btn.addEventListener('click', () => {
			const target = btn.dataset.tab;
			tabs.forEach(t => t.classList.remove('active'));
			btn.classList.add('active');
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
		container.innerHTML = `<div style="color:red; padding:10px;">Error generating analysis.</div>`;
	}
}




export async function openModal(snippet) {
	const modal = document.getElementById('codeModal');
	const title = document.getElementById('modalTitle');
	const body = document.getElementById('modalBody');

	title.textContent = snippet.label || snippet.file;
	modal.classList.add('open');
	body.innerHTML = `<div class="loading-text">Fetching ${snippet.file}...</div>`;

	try {
		const res = await fetch(snippet.repoUrl);
		if (!res.ok) throw new Error('Network error');
		const rawCode = await res.text();

		const markdownString = "```" + snippet.language + "\n" + rawCode + "\n```";
		const parsedHtml = marked.parse(markdownString);

		body.innerHTML = `
            <div class="snippet-view-meta">
                <div class="meta-left">
                    <span>${snippet.file}</span>
                    <a target="_blank" class="snippet-github-link" href="${snippet.githubFileUrl}">
                        <i class="devicon-github-original"></i> GitHub
                    </a>
                </div>
                <span>${snippet.language.toUpperCase()}</span>
            </div>
            <div class="markdown-body" id="code-content-area">${parsedHtml}</div>
        `;

		body.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
	} catch (error) {
		body.innerHTML = `<div class="loading-text" style="color:red">Error: ${error.message}</div>`;
	}
}
