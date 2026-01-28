/**
 * Core GitHub Integration Module
 * Handles authentication state, API calls, and utility functions.
 */

import { API_BASE_URL } from './config.js';

const GITHUB_AUTH_KEY = 'showcode_github_auth';

// Auth state
let authState = {
	authenticated: false,
	user: null,
	loading: true,
};

// Event listeners for auth state changes
const authListeners = new Set();

/**
 * Subscribe to auth state changes.
 * @param {Function} callback - Called with new auth state
 * @returns {Function} Unsubscribe function
 */
export function onAuthStateChange(callback) {
	authListeners.add(callback);
	// Immediately call with current state
	callback(authState);
	return () => authListeners.delete(callback);
}

/**
 * Notify all listeners of auth state change.
 */
function notifyAuthListeners() {
	authListeners.forEach(cb => cb(authState));
}

/**
 * Check authentication status with backend.
 */
export async function checkAuthStatus() {
	authState.loading = true;
	notifyAuthListeners();

	try {
		const response = await fetch(`${API_BASE_URL}/auth/github/status`, {
			credentials: 'include',
		});

		if (response.ok) {
			const data = await response.json();
			authState = {
				authenticated: data.authenticated,
				user: data.user || null,
				loading: false,
			};

			// Cache auth state
			if (data.authenticated) {
				localStorage.setItem(GITHUB_AUTH_KEY, JSON.stringify({
					authenticated: true,
					user: data.user,
				}));
			} else {
				localStorage.removeItem(GITHUB_AUTH_KEY);
			}
		} else {
			authState = { authenticated: false, user: null, loading: false };
			localStorage.removeItem(GITHUB_AUTH_KEY);
		}
	} catch (error) {
		console.error('Failed to check GitHub auth status:', error);
		// Try to use cached state
		const cached = localStorage.getItem(GITHUB_AUTH_KEY);
		if (cached) {
			const parsed = JSON.parse(cached);
			authState = { ...parsed, loading: false };
		} else {
			authState = { authenticated: false, user: null, loading: false };
		}
	}

	notifyAuthListeners();
	return authState;
}

/**
 * Get current auth state.
 */
export function getAuthState() {
	return authState;
}

/**
 * Initiate GitHub OAuth login.
 * @param {string} redirectAfter - URL to redirect to after login
 */
export function login(redirectAfter = window.location.pathname) {
	const loginUrl = `${API_BASE_URL}/auth/github/login?redirect_after=${encodeURIComponent(redirectAfter)}`;
	window.location.href = loginUrl;
}

/**
 * Logout from GitHub.
 */
export async function logout() {
	try {
		await fetch(`${API_BASE_URL}/auth/github/logout`, {
			method: 'POST',
			credentials: 'include',
		});
	} catch (error) {
		console.error('Logout request failed:', error);
	}

	authState = { authenticated: false, user: null, loading: false };
	localStorage.removeItem(GITHUB_AUTH_KEY);
	notifyAuthListeners();
}

/**
 * GitHub API wrapper with error handling.
 * @param {string} endpoint - API endpoint (without base URL)
 * @param {Object} options - Fetch options
 */
async function githubFetch(endpoint, options = {}) {
	const url = `${API_BASE_URL}${endpoint}`;

	const response = await fetch(url, {
		...options,
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...options.headers,
		},
	});

	if (!response.ok) {
		if (response.status === 401) {
			// Auth expired, refresh state
			await checkAuthStatus();
			throw new Error('Authentication required');
		}
		const error = await response.json().catch(() => ({ detail: 'Request failed' }));
		throw new Error(error.detail || 'Request failed');
	}

	return response.json();
}

// ============ Repository API ============

/**
 * List user's repositories.
 */
export async function listRepos(options = {}) {
	const params = new URLSearchParams({
		visibility: options.visibility || 'all',
		sort: options.sort || 'updated',
		per_page: options.perPage || 30,
		page: options.page || 1,
	});

	return githubFetch(`/github/repos?${params}`);
}

/**
 * Search repositories.
 */
export async function searchRepos(query, options = {}) {
	const params = new URLSearchParams({
		q: query,
		per_page: options.perPage || 30,
		page: options.page || 1,
	});

	return githubFetch(`/github/repos/search?${params}`);
}

/**
 * Get repository details.
 */
export async function getRepo(owner, repo) {
	return githubFetch(`/github/repos/${owner}/${repo}`);
}

/**
 * Get repository contents (file tree).
 */
export async function getRepoContents(owner, repo, path = '', ref = null) {
	const params = new URLSearchParams({ path });
	if (ref) params.set('ref', ref);

	return githubFetch(`/github/repos/${owner}/${repo}/contents?${params}`);
}

/**
 * Get repository branches.
 */
export async function getBranches(owner, repo) {
	return githubFetch(`/github/repos/${owner}/${repo}/branches`);
}

/**
 * Get file content.
 */
export async function getFileContent(owner, repo, path, ref = null) {
	const params = new URLSearchParams({ path });
	if (ref) params.set('ref', ref);

	return githubFetch(`/github/repos/${owner}/${repo}/file?${params}`);
}

// ============ Commit API ============

/**
 * Get commit history.
 */
export async function getCommits(owner, repo, options = {}) {
	const params = new URLSearchParams({
		per_page: options.perPage || 30,
		page: options.page || 1,
	});

	if (options.sha) params.set('sha', options.sha);
	if (options.path) params.set('path', options.path);

	return githubFetch(`/github/repos/${owner}/${repo}/commits?${params}`);
}

/**
 * Get single commit details.
 */
export async function getCommit(owner, repo, sha) {
	return githubFetch(`/github/repos/${owner}/${repo}/commits/${sha}`);
}

/**
 * Compare two commits.
 */
export async function compareCommits(owner, repo, base, head) {
	return githubFetch(`/github/repos/${owner}/${repo}/compare/${base}...${head}`);
}

/**
 * Get file diff between two commits.
 */
export async function getFileDiff(owner, repo, path, base, head) {
	const params = new URLSearchParams({ path, base, head });
	return githubFetch(`/github/repos/${owner}/${repo}/file-diff?${params}`);
}

// ============ Tracking API ============

/**
 * Start tracking a repository.
 */
export async function startTracking(owner, repo) {
	return githubFetch(`/github/repos/${owner}/${repo}/track`, {
		method: 'POST',
	});
}

/**
 * Stop tracking a repository.
 */
export async function stopTracking(owner, repo) {
	return githubFetch(`/github/repos/${owner}/${repo}/track`, {
		method: 'DELETE',
	});
}

/**
 * List tracked repositories.
 */
export async function listTracked() {
	return githubFetch('/github/tracked');
}

// ============ Utility Functions ============

/**
 * Parse a GitHub URL to extract owner, repo, and path.
 * @param {string} url - GitHub URL (raw or regular)
 * @returns {Object|null} Parsed info or null if invalid
 */
export function parseGitHubUrl(url) {
	if (!url) return null;

	// Raw URL: https://raw.githubusercontent.com/owner/repo/ref/path
	const rawMatch = url.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)/);
	if (rawMatch) {
		return {
			owner: rawMatch[1],
			repo: rawMatch[2],
			ref: rawMatch[3],
			path: rawMatch[4],
		};
	}

	// Regular URL: https://github.com/owner/repo/blob/ref/path
	const blobMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/);
	if (blobMatch) {
		return {
			owner: blobMatch[1],
			repo: blobMatch[2],
			ref: blobMatch[3],
			path: blobMatch[4],
		};
	}

	// Just owner/repo
	const repoMatch = url.match(/github\.com\/([^/]+)\/([^/]+)/);
	if (repoMatch) {
		return {
			owner: repoMatch[1],
			repo: repoMatch[2],
			ref: null,
			path: null,
		};
	}

	return null;
}

/**
 * Get file extension from path.
 */
export function getFileExtension(path) {
	const parts = path.split('.');
	return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

/**
 * Get language from file extension.
 */
export function getLanguageFromExtension(ext) {
	const langMap = {
		js: 'javascript',
		jsx: 'javascript',
		ts: 'typescript',
		tsx: 'typescript',
		py: 'python',
		rb: 'ruby',
		rs: 'rust',
		go: 'go',
		java: 'java',
		kt: 'kotlin',
		swift: 'swift',
		c: 'c',
		cpp: 'cpp',
		h: 'c',
		hpp: 'cpp',
		cs: 'csharp',
		php: 'php',
		html: 'html',
		css: 'css',
		scss: 'scss',
		less: 'less',
		json: 'json',
		yaml: 'yaml',
		yml: 'yaml',
		xml: 'xml',
		md: 'markdown',
		sh: 'bash',
		bash: 'bash',
		zsh: 'bash',
		sql: 'sql',
		dockerfile: 'dockerfile',
	};

	return langMap[ext] || ext || 'plaintext';
}

/**
 * Format date for display.
 */
export function formatDate(dateString) {
	if (!dateString) return '';
	const date = new Date(dateString);
	return date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

/**
 * Format relative time.
 */
export function formatRelativeTime(dateString) {
	if (!dateString) return '';
	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now - date;
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) return 'just now';
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 30) return `${diffDays}d ago`;

	return formatDate(dateString);
}

/**
 * Truncate commit message to first line.
 */
export function truncateCommitMessage(message, maxLength = 72) {
	if (!message) return '';
	const firstLine = message.split('\n')[0];
	if (firstLine.length <= maxLength) return firstLine;
	return firstLine.slice(0, maxLength - 3) + '...';
}

// Initialize auth check on load
checkAuthStatus();
