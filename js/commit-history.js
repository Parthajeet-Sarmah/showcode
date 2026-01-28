/**
 * Commit History Panel Component
 * View commit history and select versions for comparison.
 */

import {
    getCommits,
    getCommit,
    getFileContent,
    formatRelativeTime,
    truncateCommitMessage,
} from './github.js';

let currentState = {
    owner: null,
    repo: null,
    path: null,
    ref: null,
    commits: [],
    selectedCommits: [],
    loading: false,
    page: 1,
    hasMore: true,
};

let onVersionSelectCallback = null;
let onCompareCallback = null;
let panelElement = null;

/**
 * Initialize the commit history panel.
 * @param {HTMLElement} container - Container element for the panel
 * @param {Object} options - Configuration options
 * @param {Function} options.onVersionSelect - Callback when a version is selected
 * @param {Function} options.onCompare - Callback when compare is initiated
 */
export function initCommitHistory(container, options = {}) {
    onVersionSelectCallback = options.onVersionSelect;
    onCompareCallback = options.onCompare;
    panelElement = container;
    render(container);
}

/**
 * Load commit history for a file.
 * @param {Object} fileInfo - File information
 * @param {string} fileInfo.owner - Repository owner
 * @param {string} fileInfo.repo - Repository name
 * @param {string} fileInfo.path - File path
 * @param {string} fileInfo.ref - Current ref (branch/tag/sha)
 */
export async function loadHistory(fileInfo) {
    currentState = {
        owner: fileInfo.owner,
        repo: fileInfo.repo,
        path: fileInfo.path,
        ref: fileInfo.ref,
        commits: [],
        selectedCommits: [],
        loading: true,
        page: 1,
        hasMore: true,
    };

    render(panelElement);

    try {
        await fetchCommits();
    } catch (error) {
        console.error('Failed to load commit history:', error);
    }

    currentState.loading = false;
    render(panelElement);
}

async function fetchCommits() {
    if (!currentState.owner || !currentState.repo) return;

    try {
        const result = await getCommits(currentState.owner, currentState.repo, {
            path: currentState.path,
            sha: currentState.ref,
            perPage: 20,
            page: currentState.page,
        });

        const newCommits = result.commits || [];
        currentState.commits = [...currentState.commits, ...newCommits];
        currentState.hasMore = newCommits.length === 20;
    } catch (error) {
        console.error('Failed to fetch commits:', error);
        currentState.hasMore = false;
    }
}

async function loadMore() {
    if (!currentState.hasMore || currentState.loading) return;

    currentState.loading = true;
    currentState.page += 1;
    render(panelElement);

    await fetchCommits();

    currentState.loading = false;
    render(panelElement);
}

function toggleCommitSelection(sha) {
    const index = currentState.selectedCommits.indexOf(sha);

    if (index > -1) {
        // Remove from selection
        currentState.selectedCommits.splice(index, 1);
    } else if (currentState.selectedCommits.length < 2) {
        // Add to selection (max 2)
        currentState.selectedCommits.push(sha);
    } else {
        // Replace oldest selection
        currentState.selectedCommits.shift();
        currentState.selectedCommits.push(sha);
    }

    render(panelElement);
}

async function viewVersion(commit) {
    if (!onVersionSelectCallback) return;

    try {
        const fileData = await getFileContent(
            currentState.owner,
            currentState.repo,
            currentState.path,
            commit.sha
        );

        onVersionSelectCallback({
            commit,
            content: fileData.content,
            path: currentState.path,
        });
    } catch (error) {
        console.error('Failed to load file version:', error);
        if (window.showToast) window.showToast('Failed to load file version', 'error');
    }
}

function initiateCompare() {
    if (currentState.selectedCommits.length !== 2 || !onCompareCallback) return;

    const [base, head] = currentState.selectedCommits;
    const baseCommit = currentState.commits.find(c => c.sha === base);
    const headCommit = currentState.commits.find(c => c.sha === head);

    onCompareCallback({
        owner: currentState.owner,
        repo: currentState.repo,
        path: currentState.path,
        base: { sha: base, commit: baseCommit },
        head: { sha: head, commit: headCommit },
    });
}

/**
 * Show the commit history panel.
 */
export function showPanel() {
    if (panelElement) {
        panelElement.classList.add('open');
    }
}

/**
 * Hide the commit history panel.
 */
export function hidePanel() {
    if (panelElement) {
        panelElement.classList.remove('open');
    }
}

function render(container) {
    if (!container) return;

    const hasSelection = currentState.selectedCommits.length === 2;

    container.innerHTML = `
        <div class="commit-history-panel">
            <div class="commit-history-header">
                <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                        <circle cx="12" cy="12" r="4"></circle>
                        <line x1="1.05" y1="12" x2="7" y2="12"></line>
                        <line x1="17.01" y1="12" x2="22.96" y2="12"></line>
                    </svg>
                    Commit History
                </h4>
                <button class="commit-history-close" title="Close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            ${currentState.path ? `
                <div class="commit-history-path">
                    <span class="path-label">File:</span>
                    <span class="path-value">${currentState.path}</span>
                </div>
            ` : ''}
            ${hasSelection ? `
                <div class="commit-compare-bar">
                    <span>Comparing ${currentState.selectedCommits.length} commits</span>
                    <button class="btn-compare">View Diff</button>
                </div>
            ` : ''}
            <div class="commit-list">
                ${currentState.commits.length === 0 && !currentState.loading ? `
                    <div class="commit-list-empty">
                        <p>No commits found</p>
                    </div>
                ` : currentState.commits.map(commit => {
                    const isSelected = currentState.selectedCommits.includes(commit.sha);
                    const selectionIndex = currentState.selectedCommits.indexOf(commit.sha);
                    return `
                        <div class="commit-item ${isSelected ? 'selected' : ''}" data-sha="${commit.sha}">
                            <div class="commit-select-indicator">
                                <input type="checkbox"
                                       class="commit-checkbox"
                                       ${isSelected ? 'checked' : ''}
                                       title="Select for comparison">
                                ${isSelected ? `<span class="selection-order">${selectionIndex + 1}</span>` : ''}
                            </div>
                            <div class="commit-info">
                                <div class="commit-message">${truncateCommitMessage(commit.message)}</div>
                                <div class="commit-meta">
                                    <span class="commit-sha">${commit.sha.slice(0, 7)}</span>
                                    <span class="commit-author">${commit.author.name}</span>
                                    <span class="commit-date">${formatRelativeTime(commit.author.date)}</span>
                                </div>
                            </div>
                            <button class="commit-view-btn" title="View this version">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            </button>
                        </div>
                    `;
                }).join('')}
                ${currentState.loading ? `
                    <div class="commit-list-loading">
                        <div class="spinner"></div>
                        <span>Loading commits...</span>
                    </div>
                ` : ''}
                ${!currentState.loading && currentState.hasMore ? `
                    <button class="commit-load-more">Load more commits</button>
                ` : ''}
            </div>
        </div>
    `;

    // Attach event listeners
    container.querySelector('.commit-history-close')?.addEventListener('click', hidePanel);

    container.querySelector('.btn-compare')?.addEventListener('click', initiateCompare);

    container.querySelector('.commit-load-more')?.addEventListener('click', loadMore);

    container.querySelectorAll('.commit-item').forEach(item => {
        const sha = item.dataset.sha;

        item.querySelector('.commit-checkbox')?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCommitSelection(sha);
        });

        item.querySelector('.commit-view-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const commit = currentState.commits.find(c => c.sha === sha);
            if (commit) viewVersion(commit);
        });

        // Click on the item itself toggles selection
        item.addEventListener('click', (e) => {
            if (!e.target.closest('.commit-checkbox') && !e.target.closest('.commit-view-btn')) {
                toggleCommitSelection(sha);
            }
        });
    });
}

/**
 * Get current selection state.
 */
export function getSelection() {
    return {
        commits: currentState.selectedCommits,
        canCompare: currentState.selectedCommits.length === 2,
    };
}

/**
 * Clear selection.
 */
export function clearSelection() {
    currentState.selectedCommits = [];
    render(panelElement);
}
