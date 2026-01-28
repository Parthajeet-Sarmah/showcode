/**
 * Diff Viewer Component
 * Display side-by-side and unified diff views.
 */

import { getFileDiff, truncateCommitMessage, formatRelativeTime } from './github.js';

let currentState = {
    owner: null,
    repo: null,
    path: null,
    base: null,
    head: null,
    diff: null,
    baseContent: null,
    headContent: null,
    viewMode: 'split', // 'split' or 'unified'
    loading: false,
};

let containerElement = null;

/**
 * Initialize the diff viewer.
 * @param {HTMLElement} container - Container element for the viewer
 */
export function initDiffViewer(container) {
    containerElement = container;
    render(container);
}

/**
 * Load and display diff between two commits.
 * @param {Object} diffInfo - Diff information
 * @param {string} diffInfo.owner - Repository owner
 * @param {string} diffInfo.repo - Repository name
 * @param {string} diffInfo.path - File path
 * @param {Object} diffInfo.base - Base commit info (sha, commit)
 * @param {Object} diffInfo.head - Head commit info (sha, commit)
 */
export async function loadDiff(diffInfo) {
    currentState = {
        ...currentState,
        owner: diffInfo.owner,
        repo: diffInfo.repo,
        path: diffInfo.path,
        base: diffInfo.base,
        head: diffInfo.head,
        diff: null,
        loading: true,
    };

    render(containerElement);
    showViewer();

    try {
        const result = await getFileDiff(
            diffInfo.owner,
            diffInfo.repo,
            diffInfo.path,
            diffInfo.base.sha,
            diffInfo.head.sha
        );

        currentState.diff = result.diff;
        currentState.baseContent = result.base_content;
        currentState.headContent = result.head_content;
    } catch (error) {
        console.error('Failed to load diff:', error);
        if (window.showToast) window.showToast('Failed to load diff', 'error');
    }

    currentState.loading = false;
    render(containerElement);
}

/**
 * Show the diff viewer.
 */
export function showViewer() {
    if (containerElement) {
        containerElement.classList.add('open');
    }
}

/**
 * Hide the diff viewer.
 */
export function hideViewer() {
    if (containerElement) {
        containerElement.classList.remove('open');
    }
}

function setViewMode(mode) {
    currentState.viewMode = mode;
    render(containerElement);
}

function render(container) {
    if (!container) return;

    container.innerHTML = `
        <div class="diff-viewer-modal">
            <div class="diff-viewer-content">
                <div class="diff-viewer-header">
                    <div class="diff-header-left">
                        <h3>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"></path>
                            </svg>
                            File Diff
                        </h3>
                        ${currentState.path ? `<span class="diff-path">${currentState.path}</span>` : ''}
                    </div>
                    <div class="diff-header-controls">
                        <div class="diff-view-toggle">
                            <button class="view-toggle-btn ${currentState.viewMode === 'split' ? 'active' : ''}"
                                    data-mode="split" title="Split view">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                    <line x1="12" y1="3" x2="12" y2="21"></line>
                                </svg>
                            </button>
                            <button class="view-toggle-btn ${currentState.viewMode === 'unified' ? 'active' : ''}"
                                    data-mode="unified" title="Unified view">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                </svg>
                            </button>
                        </div>
                        <button class="diff-viewer-close" title="Close">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
                ${renderCommitInfo()}
                <div class="diff-viewer-body">
                    ${currentState.loading ? `
                        <div class="diff-loading">
                            <div class="spinner"></div>
                            <span>Loading diff...</span>
                        </div>
                    ` : currentState.diff ? (
                        currentState.viewMode === 'split'
                            ? renderSplitView()
                            : renderUnifiedView()
                    ) : `
                        <div class="diff-empty">
                            <p>No changes detected</p>
                        </div>
                    `}
                </div>
            </div>
        </div>
    `;

    // Attach event listeners
    container.querySelector('.diff-viewer-close')?.addEventListener('click', hideViewer);

    container.querySelector('.diff-viewer-modal')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('diff-viewer-modal')) {
            hideViewer();
        }
    });

    container.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setViewMode(btn.dataset.mode);
        });
    });
}

function renderCommitInfo() {
    if (!currentState.base || !currentState.head) return '';

    const baseCommit = currentState.base.commit;
    const headCommit = currentState.head.commit;

    return `
        <div class="diff-commit-info">
            <div class="diff-commit base">
                <span class="diff-commit-label">Base</span>
                <span class="diff-commit-sha">${currentState.base.sha.slice(0, 7)}</span>
                ${baseCommit ? `
                    <span class="diff-commit-message">${truncateCommitMessage(baseCommit.message, 40)}</span>
                    <span class="diff-commit-date">${formatRelativeTime(baseCommit.author?.date)}</span>
                ` : ''}
            </div>
            <div class="diff-commit-arrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
            </div>
            <div class="diff-commit head">
                <span class="diff-commit-label">Head</span>
                <span class="diff-commit-sha">${currentState.head.sha.slice(0, 7)}</span>
                ${headCommit ? `
                    <span class="diff-commit-message">${truncateCommitMessage(headCommit.message, 40)}</span>
                    <span class="diff-commit-date">${formatRelativeTime(headCommit.author?.date)}</span>
                ` : ''}
            </div>
        </div>
    `;
}

function renderSplitView() {
    if (!currentState.diff) return '';

    const baseLines = (currentState.baseContent || '').split('\n');
    const headLines = (currentState.headContent || '').split('\n');

    // Build aligned rows for split view
    const rows = buildSplitRows(currentState.diff, baseLines, headLines);

    return `
        <div class="diff-split-view">
            <div class="diff-pane base-pane">
                <div class="diff-pane-header">
                    <span class="pane-label">Base</span>
                    <span class="pane-sha">${currentState.base?.sha?.slice(0, 7) || ''}</span>
                </div>
                <div class="diff-pane-content">
                    <pre><code>${rows.map(row => renderSplitBaseLine(row)).join('\n')}</code></pre>
                </div>
            </div>
            <div class="diff-pane head-pane">
                <div class="diff-pane-header">
                    <span class="pane-label">Head</span>
                    <span class="pane-sha">${currentState.head?.sha?.slice(0, 7) || ''}</span>
                </div>
                <div class="diff-pane-content">
                    <pre><code>${rows.map(row => renderSplitHeadLine(row)).join('\n')}</code></pre>
                </div>
            </div>
        </div>
    `;
}

function buildSplitRows(diff, baseLines, headLines) {
    const rows = [];
    let baseIndex = 0;
    let headIndex = 0;

    for (const entry of diff) {
        if (entry.type === 'hunk') {
            rows.push({ type: 'hunk', content: entry.content });
            continue;
        }

        if (entry.type === 'context') {
            rows.push({
                type: 'context',
                baseLine: entry.base_line,
                headLine: entry.head_line,
                content: entry.content,
            });
        } else if (entry.type === 'removed') {
            rows.push({
                type: 'removed',
                baseLine: entry.base_line,
                content: entry.content,
            });
        } else if (entry.type === 'added') {
            rows.push({
                type: 'added',
                headLine: entry.head_line,
                content: entry.content,
            });
        }
    }

    return rows;
}

function renderSplitBaseLine(row) {
    if (row.type === 'hunk') {
        return `<span class="diff-line hunk">${escapeHtml(row.content)}</span>`;
    }
    if (row.type === 'added') {
        return `<span class="diff-line empty"></span>`;
    }

    const lineNum = row.baseLine || '';
    const cssClass = row.type === 'removed' ? 'removed' : 'context';

    return `<span class="diff-line ${cssClass}"><span class="line-num">${lineNum}</span>${escapeHtml(row.content)}</span>`;
}

function renderSplitHeadLine(row) {
    if (row.type === 'hunk') {
        return `<span class="diff-line hunk">${escapeHtml(row.content)}</span>`;
    }
    if (row.type === 'removed') {
        return `<span class="diff-line empty"></span>`;
    }

    const lineNum = row.headLine || '';
    const cssClass = row.type === 'added' ? 'added' : 'context';

    return `<span class="diff-line ${cssClass}"><span class="line-num">${lineNum}</span>${escapeHtml(row.content)}</span>`;
}

function renderUnifiedView() {
    if (!currentState.diff) return '';

    return `
        <div class="diff-unified-view">
            <pre><code>${currentState.diff.map(entry => {
                if (entry.type === 'hunk') {
                    return `<span class="diff-line hunk">${escapeHtml(entry.content)}</span>`;
                }

                const baseNum = entry.base_line || '';
                const headNum = entry.head_line || '';
                const prefix = entry.type === 'added' ? '+' : entry.type === 'removed' ? '-' : ' ';
                const cssClass = entry.type;

                return `<span class="diff-line ${cssClass}"><span class="line-nums"><span class="base-num">${baseNum}</span><span class="head-num">${headNum}</span></span><span class="prefix">${prefix}</span>${escapeHtml(entry.content)}</span>`;
            }).join('\n')}</code></pre>
        </div>
    `;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Get current state.
 */
export function getState() {
    return { ...currentState };
}
