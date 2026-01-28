/**
 * Repository Browser Component
 * Browse GitHub repositories and select files.
 */

import {
    getAuthState,
    listRepos,
    searchRepos,
    getRepoContents,
    getBranches,
    getFileContent,
    getFileExtension,
    getLanguageFromExtension,
    formatRelativeTime,
} from './github.js';
import { importRepository, showImportPreview } from './repo-import.js';

let currentState = {
    repos: [],
    selectedRepo: null,
    contents: [],
    currentPath: '',
    branches: [],
    selectedBranch: null,
    loading: false,
    searchQuery: '',
    breadcrumbs: [],
    importing: false,
};

let onFileSelectCallback = null;
let onImportCallback = null;
let modalElement = null;

/**
 * Initialize the repository browser.
 * @param {HTMLElement} container - Container element for the browser
 * @param {Function} onFileSelect - Callback when a file is selected
 * @param {Function} onImport - Callback when a repository is imported
 */
export function initRepoBrowser(container, onFileSelect, onImport) {
    onFileSelectCallback = onFileSelect;
    onImportCallback = onImport;
    modalElement = container;
    render(container);
    loadRepos();
}

/**
 * Open the repository browser modal.
 */
export function openRepoBrowser() {
    if (modalElement) {
        modalElement.classList.add('open');
        loadRepos();
    }
}

/**
 * Close the repository browser modal.
 */
export function closeRepoBrowser() {
    if (modalElement) {
        modalElement.classList.remove('open');
        resetState();
    }
}

function resetState() {
    currentState = {
        repos: [],
        selectedRepo: null,
        contents: [],
        currentPath: '',
        branches: [],
        selectedBranch: null,
        loading: false,
        searchQuery: '',
        breadcrumbs: [],
        importing: false,
    };
}

async function loadRepos() {
    const auth = getAuthState();
    if (!auth.authenticated) return;

    currentState.loading = true;
    renderRepoList();

    try {
        const result = await listRepos({ perPage: 50 });
        currentState.repos = result.repos || [];
    } catch (error) {
        console.error('Failed to load repos:', error);
        currentState.repos = [];
    }

    currentState.loading = false;
    renderRepoList();
}

async function searchReposHandler(query) {
    currentState.searchQuery = query;
    currentState.loading = true;
    renderRepoList();

    try {
        if (query.trim()) {
            const result = await searchRepos(query, { perPage: 30 });
            currentState.repos = result.repos || [];
        } else {
            await loadRepos();
            return;
        }
    } catch (error) {
        console.error('Failed to search repos:', error);
    }

    currentState.loading = false;
    renderRepoList();
}

async function selectRepo(repo) {
    currentState.selectedRepo = repo;
    currentState.currentPath = '';
    currentState.breadcrumbs = [{ name: repo.name, path: '' }];
    currentState.loading = true;
    renderFileBrowser();

    try {
        // Load branches
        const branchResult = await getBranches(repo.full_name.split('/')[0], repo.name);
        currentState.branches = branchResult.branches || [];
        currentState.selectedBranch = repo.default_branch;

        // Load root contents
        await loadContents('');
    } catch (error) {
        console.error('Failed to load repo:', error);
    }

    currentState.loading = false;
    renderFileBrowser();
}

async function loadContents(path) {
    if (!currentState.selectedRepo) return;

    currentState.loading = true;
    currentState.currentPath = path;
    updateBreadcrumbs(path);
    renderFileBrowser();

    try {
        const [owner, repo] = currentState.selectedRepo.full_name.split('/');
        const result = await getRepoContents(owner, repo, path, currentState.selectedBranch);
        currentState.contents = result.contents || [];
    } catch (error) {
        console.error('Failed to load contents:', error);
        currentState.contents = [];
    }

    currentState.loading = false;
    renderFileBrowser();
}

function updateBreadcrumbs(path) {
    const parts = path.split('/').filter(p => p);
    currentState.breadcrumbs = [
        { name: currentState.selectedRepo.name, path: '' }
    ];

    let currentPath = '';
    for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        currentState.breadcrumbs.push({ name: part, path: currentPath });
    }
}

async function selectItem(item) {
    if (item.type === 'dir') {
        await loadContents(item.path);
    } else if (item.type === 'file') {
        await selectFile(item);
    }
}

async function selectFile(item) {
    if (!currentState.selectedRepo || !onFileSelectCallback) return;

    currentState.loading = true;
    renderFileBrowser();

    try {
        const [owner, repo] = currentState.selectedRepo.full_name.split('/');
        const fileData = await getFileContent(owner, repo, item.path, currentState.selectedBranch);

        const ext = getFileExtension(item.path);
        const language = getLanguageFromExtension(ext);

        const snippetData = {
            owner,
            repo,
            path: item.path,
            ref: currentState.selectedBranch,
            content: fileData.content,
            language,
            file: item.name,
            repoUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${currentState.selectedBranch}/${item.path}`,
            githubFileUrl: fileData.html_url,
            github: {
                owner,
                repo,
                path: item.path,
                ref: currentState.selectedBranch,
                requiresAuth: currentState.selectedRepo.private,
            },
        };

        onFileSelectCallback(snippetData);
        closeRepoBrowser();
    } catch (error) {
        console.error('Failed to load file:', error);
        if (window.showToast) window.showToast('Failed to load file', 'error');
    }

    currentState.loading = false;
    renderFileBrowser();
}

async function changeBranch(branch) {
    currentState.selectedBranch = branch;
    await loadContents(currentState.currentPath);
}

function goBack() {
    if (currentState.selectedRepo && currentState.currentPath === '') {
        // Go back to repo list
        currentState.selectedRepo = null;
        currentState.contents = [];
        currentState.breadcrumbs = [];
        renderRepoList();
    } else if (currentState.currentPath) {
        // Go up one directory
        const parts = currentState.currentPath.split('/');
        parts.pop();
        loadContents(parts.join('/'));
    }
}

function render(container) {
    container.innerHTML = `
        <div class="repo-browser-modal">
            <div class="repo-browser-content">
                <div class="repo-browser-header">
                    <h3>Import from GitHub</h3>
                    <button class="repo-browser-close">&times;</button>
                </div>
                <div class="repo-browser-body">
                    <div id="repo-list-view" class="repo-browser-view active"></div>
                    <div id="file-browser-view" class="repo-browser-view"></div>
                </div>
            </div>
        </div>
    `;

    container.querySelector('.repo-browser-close').addEventListener('click', closeRepoBrowser);
    container.querySelector('.repo-browser-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('repo-browser-modal')) {
            closeRepoBrowser();
        }
    });

    renderRepoList();
}

function renderRepoList() {
    const container = document.getElementById('repo-list-view');
    if (!container) return;

    const auth = getAuthState();
    if (!auth.authenticated) {
        container.innerHTML = `
            <div class="repo-browser-empty">
                <p>Connect to GitHub to browse repositories</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="repo-search-bar">
            <input type="text" class="repo-search-input" placeholder="Search repositories..." value="${currentState.searchQuery}">
        </div>
        <div class="repo-list">
            ${currentState.loading ? `
                <div class="repo-browser-loading">
                    <div class="spinner"></div>
                    <span>Loading repositories...</span>
                </div>
            ` : currentState.repos.length === 0 ? `
                <div class="repo-browser-empty">
                    <p>No repositories found</p>
                </div>
            ` : currentState.repos.map(repo => `
                <div class="repo-item" data-repo="${repo.full_name}">
                    <div class="repo-item-icon">
                        ${repo.private ? `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                        ` : `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                        `}
                    </div>
                    <div class="repo-item-info">
                        <div class="repo-item-name">${repo.full_name}</div>
                        <div class="repo-item-meta">
                            ${repo.language ? `<span class="repo-lang">${repo.language}</span>` : ''}
                            <span class="repo-updated">${formatRelativeTime(repo.updated_at)}</span>
                        </div>
                    </div>
                    <div class="repo-item-chevron">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // Attach event listeners
    const searchInput = container.querySelector('.repo-search-input');
    let searchTimeout;
    searchInput?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => searchReposHandler(e.target.value), 300);
    });

    container.querySelectorAll('.repo-item').forEach(item => {
        item.addEventListener('click', () => {
            const repoName = item.dataset.repo;
            const repo = currentState.repos.find(r => r.full_name === repoName);
            if (repo) {
                document.getElementById('repo-list-view').classList.remove('active');
                document.getElementById('file-browser-view').classList.add('active');
                selectRepo(repo);
            }
        });
    });
}

function renderFileBrowser() {
    const container = document.getElementById('file-browser-view');
    if (!container || !currentState.selectedRepo) return;

    const repo = currentState.selectedRepo;
    const isAtRoot = currentState.currentPath === '';

    container.innerHTML = `
        ${isAtRoot ? `
            <div class="repo-import-bar">
                <div class="repo-import-info">
                    <span class="repo-import-name">${repo.full_name}</span>
                    <span class="repo-import-meta">
                        ${repo.language || 'Unknown'} • ${formatRelativeTime(repo.updated_at)}
                    </span>
                </div>
                <button class="btn-import-repo" ${currentState.importing ? 'disabled' : ''}>
                    ${currentState.importing ? `
                        <div class="spinner" style="width:16px;height:16px;border-width:2px;"></div>
                        Analyzing...
                    ` : `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        Import to Showcode
                    `}
                </button>
            </div>
        ` : ''}
        <div class="file-browser-toolbar">
            <button class="file-browser-back">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
            <div class="file-browser-breadcrumbs">
                ${currentState.breadcrumbs.map((crumb, i) => `
                    <span class="breadcrumb-item ${i === currentState.breadcrumbs.length - 1 ? 'current' : ''}"
                          data-path="${crumb.path}">
                        ${crumb.name}
                    </span>
                    ${i < currentState.breadcrumbs.length - 1 ? '<span class="breadcrumb-sep">/</span>' : ''}
                `).join('')}
            </div>
            <div class="file-browser-branch">
                <select class="branch-select">
                    ${currentState.branches.map(b => `
                        <option value="${b.name}" ${b.name === currentState.selectedBranch ? 'selected' : ''}>
                            ${b.name}
                        </option>
                    `).join('')}
                </select>
            </div>
        </div>
        <div class="file-list">
            ${currentState.loading ? `
                <div class="repo-browser-loading">
                    <div class="spinner"></div>
                    <span>Loading...</span>
                </div>
            ` : currentState.contents.length === 0 ? `
                <div class="repo-browser-empty">
                    <p>Empty directory</p>
                </div>
            ` : currentState.contents.map(item => `
                <div class="file-item" data-path="${item.path}" data-type="${item.type}">
                    <div class="file-item-icon">
                        ${item.type === 'dir' ? `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                        ` : `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                            </svg>
                        `}
                    </div>
                    <div class="file-item-name">${item.name}</div>
                    ${item.type === 'dir' ? `
                        <div class="file-item-chevron">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    `;

    // Attach event listeners
    container.querySelector('.file-browser-back').addEventListener('click', goBack);

    container.querySelectorAll('.breadcrumb-item:not(.current)').forEach(crumb => {
        crumb.addEventListener('click', () => {
            loadContents(crumb.dataset.path);
        });
    });

    container.querySelector('.branch-select')?.addEventListener('change', (e) => {
        changeBranch(e.target.value);
    });

    container.querySelectorAll('.file-item').forEach(item => {
        item.addEventListener('click', () => {
            const path = item.dataset.path;
            const type = item.dataset.type;
            const contentItem = currentState.contents.find(c => c.path === path);
            if (contentItem) {
                selectItem(contentItem);
            }
        });
    });

    // Import button handler
    container.querySelector('.btn-import-repo')?.addEventListener('click', handleImportRepo);
}

async function handleImportRepo() {
    if (currentState.importing || !currentState.selectedRepo) return;

    const repo = currentState.selectedRepo;
    const [owner, repoName] = repo.full_name.split('/');

    currentState.importing = true;
    renderFileBrowser();

    try {
        const config = await importRepository(owner, repoName, currentState.selectedBranch);

        currentState.importing = false;
        renderFileBrowser();

        // Show preview modal
        showImportPreview(config, (finalConfig) => {
            if (onImportCallback) {
                onImportCallback(finalConfig);
                closeRepoBrowser();
                if (window.showToast) {
                    window.showToast(`Imported "${finalConfig.project}" successfully!`, 'success');
                }
            }
        });
    } catch (error) {
        console.error('Failed to import repository:', error);
        currentState.importing = false;
        renderFileBrowser();
        if (window.showToast) {
            window.showToast('Failed to analyze repository', 'error');
        }
    }
}
