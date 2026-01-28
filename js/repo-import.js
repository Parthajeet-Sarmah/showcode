/**
 * Repository Import Module
 * Analyzes a GitHub repository and generates a Showcode project configuration.
 */

import { getRepoContents, getBranches, getRepo } from './github.js';

// File type to category mapping
const FILE_CATEGORIES = {
	frontend: {
		extensions: ['html', 'css', 'scss', 'less', 'jsx', 'tsx', 'vue', 'svelte'],
		directories: ['src', 'components', 'pages', 'views', 'public', 'static', 'assets', 'styles'],
		label: 'Frontend',
		nodeType: 'process',
	},
	backend: {
		extensions: ['py', 'go', 'rs', 'java', 'rb', 'php', 'cs'],
		directories: ['api', 'server', 'backend', 'services', 'handlers', 'controllers'],
		label: 'Backend',
		nodeType: 'process',
	},
	config: {
		extensions: ['json', 'yaml', 'yml', 'toml', 'ini', 'env'],
		directories: ['config', 'configs', 'settings'],
		files: ['package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'],
		label: 'Configuration',
		nodeType: 'process',
	},
	infrastructure: {
		extensions: ['dockerfile', 'tf', 'hcl'],
		directories: ['infra', 'infrastructure', 'deploy', 'deployment', 'k8s', 'kubernetes', 'terraform'],
		files: ['docker-compose.yml', 'docker-compose.yaml', 'Dockerfile', 'nginx.conf'],
		label: 'Infrastructure',
		nodeType: 'end',
	},
	database: {
		extensions: ['sql', 'prisma'],
		directories: ['db', 'database', 'migrations', 'models', 'schemas'],
		label: 'Database',
		nodeType: 'end',
	},
	tests: {
		extensions: ['test.js', 'test.ts', 'spec.js', 'spec.ts', '_test.go', '_test.py'],
		directories: ['test', 'tests', '__tests__', 'spec', 'specs'],
		label: 'Tests',
		nodeType: 'process',
	},
	docs: {
		extensions: ['md', 'mdx', 'rst', 'txt'],
		directories: ['docs', 'documentation'],
		files: ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md'],
		label: 'Documentation',
		nodeType: 'end',
	},
};

// Language detection by extension
const EXTENSION_TO_LANGUAGE = {
	js: 'javascript',
	jsx: 'javascript',
	ts: 'typescript',
	tsx: 'typescript',
	py: 'python',
	go: 'golang',
	rs: 'rust',
	java: 'java',
	rb: 'ruby',
	php: 'php',
	cs: 'csharp',
	html: 'html',
	css: 'css',
	scss: 'scss',
	less: 'less',
	json: 'json',
	yaml: 'yaml',
	yml: 'yaml',
	toml: 'toml',
	md: 'markdown',
	sql: 'sql',
	sh: 'bash',
	bash: 'bash',
	dockerfile: 'dockerfile',
	vue: 'vue',
	svelte: 'svelte',
};

/**
 * Import a repository and generate Showcode project configuration.
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branch - Branch name
 * @returns {Promise<Object>} Generated project configuration
 */
export async function importRepository(owner, repo, branch) {
	// Fetch repo info
	const repoInfo = await getRepo(owner, repo);

	// Fetch complete file tree
	const fileTree = await fetchFileTree(owner, repo, '', branch);

	// Categorize files
	const categorizedFiles = categorizeFiles(fileTree, owner, repo, branch);

	// Generate flow diagram
	const flow = generateFlowDiagram(categorizedFiles);

	// Generate data sections with snippets
	const data = generateDataSections(categorizedFiles, owner, repo, branch);

	return {
		project: repoInfo.name || repo,
		flow,
		data,
	};
}

/**
 * Recursively fetch the file tree of a repository.
 */
async function fetchFileTree(owner, repo, path, branch, depth = 0, maxDepth = 3) {
	if (depth > maxDepth) return [];

	try {
		const result = await getRepoContents(owner, repo, path, branch);
		const contents = result.contents || [];

		let files = [];

		for (const item of contents) {
			if (item.type === 'file') {
				files.push({
					name: item.name,
					path: item.path,
					type: 'file',
					size: item.size,
				});
			} else if (item.type === 'dir') {
				// Skip common non-essential directories
				const skipDirs = ['node_modules', '.git', 'dist', 'build', 'vendor', '__pycache__', '.next', 'coverage'];
				if (skipDirs.includes(item.name)) continue;

				const subFiles = await fetchFileTree(owner, repo, item.path, branch, depth + 1, maxDepth);
				files.push({
					name: item.name,
					path: item.path,
					type: 'dir',
					children: subFiles,
				});
			}
		}

		return files;
	} catch (error) {
		console.error(`Failed to fetch contents for ${path}:`, error);
		return [];
	}
}

/**
 * Categorize files into logical groups.
 */
function categorizeFiles(fileTree, owner, repo, branch) {
	const categories = {};

	// Initialize categories
	Object.keys(FILE_CATEGORIES).forEach(key => {
		categories[key] = {
			...FILE_CATEGORIES[key],
			files: [],
		};
	});
	categories.other = {
		label: 'Other',
		nodeType: 'process',
		files: [],
	};

	// Flatten and categorize
	const flatFiles = flattenFileTree(fileTree);

	for (const file of flatFiles) {
		const category = detectCategory(file);
		if (categories[category]) {
			categories[category].files.push({
				...file,
				language: detectLanguage(file.name),
				repoUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`,
				githubFileUrl: `https://github.com/${owner}/${repo}/blob/${branch}/${file.path}`,
			});
		}
	}

	// Remove empty categories
	Object.keys(categories).forEach(key => {
		if (categories[key].files.length === 0) {
			delete categories[key];
		}
	});

	return categories;
}

/**
 * Flatten nested file tree to a flat array.
 */
function flattenFileTree(tree, basePath = '') {
	let files = [];

	for (const item of tree) {
		if (item.type === 'file') {
			files.push(item);
		} else if (item.type === 'dir' && item.children) {
			files = files.concat(flattenFileTree(item.children, item.path));
		}
	}

	return files;
}

/**
 * Detect the category of a file based on its path and extension.
 */
function detectCategory(file) {
	const ext = getExtension(file.name);
	const pathParts = file.path.toLowerCase().split('/');
	const fileName = file.name.toLowerCase();

	for (const [category, config] of Object.entries(FILE_CATEGORIES)) {
		// Check if file matches specific files list
		if (config.files && config.files.some(f => fileName === f.toLowerCase())) {
			return category;
		}

		// Check directory match
		if (config.directories) {
			for (const dir of config.directories) {
				if (pathParts.some(p => p === dir.toLowerCase())) {
					return category;
				}
			}
		}

		// Check extension match
		if (config.extensions && config.extensions.includes(ext)) {
			return category;
		}
	}

	return 'other';
}

/**
 * Detect programming language from filename.
 */
function detectLanguage(filename) {
	const ext = getExtension(filename);
	return EXTENSION_TO_LANGUAGE[ext] || ext || 'plaintext';
}

/**
 * Get file extension.
 */
function getExtension(filename) {
	const parts = filename.toLowerCase().split('.');
	if (parts.length > 1) {
		// Handle special cases like .test.js, .spec.ts
		if (parts.length > 2) {
			const lastTwo = parts.slice(-2).join('.');
			if (['test.js', 'test.ts', 'spec.js', 'spec.ts'].includes(lastTwo)) {
				return lastTwo;
			}
		}
		return parts.pop();
	}
	// Handle files like Dockerfile
	return filename.toLowerCase();
}

/**
 * Generate flow diagram from categorized files.
 */
function generateFlowDiagram(categories) {
	const nodes = [];
	const edges = [];

	const categoryKeys = Object.keys(categories);
	const nodeCount = categoryKeys.length;

	// Generate node positions in a grid layout
	const cols = Math.ceil(Math.sqrt(nodeCount));
	const spacing = { x: 300, y: 200 };
	const startX = -((cols - 1) * spacing.x) / 2;
	const startY = -150;

	categoryKeys.forEach((key, index) => {
		const category = categories[key];
		const col = index % cols;
		const row = Math.floor(index / cols);

		nodes.push({
			id: key,
			label: category.label,
			x: startX + col * spacing.x,
			y: startY + row * spacing.y,
			info: `${category.files.length} files in this category`,
			type: category.nodeType || 'process',
			linkedDataIndex: index,
		});
	});

	// Generate logical edges based on common patterns
	const edgePatterns = [
		{ from: 'frontend', to: 'backend', label: 'API Calls' },
		{ from: 'backend', to: 'database', label: 'Data Access' },
		{ from: 'config', to: 'backend', label: 'Configures' },
		{ from: 'infrastructure', to: 'backend', label: 'Deploys' },
		{ from: 'tests', to: 'backend', label: 'Tests' },
		{ from: 'tests', to: 'frontend', label: 'Tests' },
	];

	for (const pattern of edgePatterns) {
		if (categories[pattern.from] && categories[pattern.to]) {
			edges.push({
				from: pattern.from,
				to: pattern.to,
				label: pattern.label,
			});
		}
	}

	// If no edges were created, create a simple chain
	if (edges.length === 0 && nodes.length > 1) {
		for (let i = 0; i < nodes.length - 1; i++) {
			edges.push({
				from: nodes[i].id,
				to: nodes[i + 1].id,
				label: '',
			});
		}
	}

	return { nodes, edges };
}

/**
 * Generate data sections with snippets from categorized files.
 */
function generateDataSections(categories, owner, repo, branch) {
	const data = [];

	for (const [key, category] of Object.entries(categories)) {
		// Group files by their parent directory for better organization
		const filesByDir = groupFilesByDirectory(category.files);

		// Create snippets (limit to most relevant files)
		const snippets = category.files
			.filter(f => isRelevantFile(f))
			.slice(0, 10) // Limit snippets per category
			.map(file => ({
				label: generateSnippetLabel(file),
				file: file.path,
				language: file.language,
				repoUrl: file.repoUrl,
				githubFileUrl: file.githubFileUrl,
			}));

		if (snippets.length > 0) {
			data.push({
				title: category.label,
				groupLabel: category.label.substring(0, 10),
				description: generateDescription(key, category.files.length),
				snippets,
			});
		}
	}

	return data;
}

/**
 * Group files by their immediate parent directory.
 */
function groupFilesByDirectory(files) {
	const groups = {};

	for (const file of files) {
		const parts = file.path.split('/');
		const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root';

		if (!groups[dir]) {
			groups[dir] = [];
		}
		groups[dir].push(file);
	}

	return groups;
}

/**
 * Check if a file is relevant for display (filter out noise).
 */
function isRelevantFile(file) {
	const irrelevant = [
		'.gitignore', '.gitattributes', '.editorconfig', '.prettierrc',
		'.eslintrc', '.eslintignore', 'package-lock.json', 'yarn.lock',
		'.npmrc', '.nvmrc', 'LICENSE', 'license', '.env.example',
	];

	return !irrelevant.some(name => file.name.toLowerCase() === name.toLowerCase());
}

/**
 * Generate a human-readable label for a snippet.
 */
function generateSnippetLabel(file) {
	// Remove extension and convert to title case
	const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');

	// Handle common naming patterns
	const label = nameWithoutExt
		.replace(/[-_]/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase to spaces
		.replace(/\b\w/g, c => c.toUpperCase()); // Title case

	return label;
}

/**
 * Generate a description for a data section.
 */
function generateDescription(category, fileCount) {
	const descriptions = {
		frontend: `Frontend components and UI code. Contains ${fileCount} files including views, components, and styles.`,
		backend: `Backend services and API logic. Contains ${fileCount} files handling server-side operations.`,
		config: `Configuration files for the project. Contains ${fileCount} configuration and settings files.`,
		infrastructure: `Infrastructure and deployment configuration. Contains ${fileCount} files for CI/CD and containerization.`,
		database: `Database schemas, migrations, and models. Contains ${fileCount} database-related files.`,
		tests: `Test suites and specifications. Contains ${fileCount} test files.`,
		docs: `Project documentation. Contains ${fileCount} documentation files.`,
		other: `Additional project files. Contains ${fileCount} miscellaneous files.`,
	};

	return descriptions[category] || `Contains ${fileCount} files.`;
}

/**
 * Preview import configuration in a modal.
 */
export function showImportPreview(config, onConfirm) {
	const modal = document.createElement('div');
	modal.className = 'import-preview-modal open';
	modal.innerHTML = `
		<div class="import-preview-content">
			<div class="import-preview-header">
				<h3>Import Repository: ${config.project}</h3>
				<button class="import-preview-close">&times;</button>
			</div>
			<div class="import-preview-body">
				<div class="import-summary">
					<div class="summary-item">
						<span class="summary-label">Project Name</span>
						<input type="text" class="summary-input" id="import-project-name" value="${config.project}">
					</div>
					<div class="summary-item">
						<span class="summary-label">Flow Nodes</span>
						<span class="summary-value">${config.flow.nodes.length}</span>
					</div>
					<div class="summary-item">
						<span class="summary-label">Data Sections</span>
						<span class="summary-value">${config.data.length}</span>
					</div>
					<div class="summary-item">
						<span class="summary-label">Total Snippets</span>
						<span class="summary-value">${config.data.reduce((sum, d) => sum + d.snippets.length, 0)}</span>
					</div>
				</div>
				<div class="import-sections">
					<h4>Sections to Import:</h4>
					${config.data.map((section, i) => `
						<div class="import-section-item">
							<label>
								<input type="checkbox" checked data-section-index="${i}">
								<span>${section.title}</span>
								<span class="section-count">(${section.snippets.length} snippets)</span>
							</label>
						</div>
					`).join('')}
				</div>
			</div>
			<div class="import-preview-footer">
				<button class="btn-action btn-cancel">Cancel</button>
				<button class="btn-action btn-confirm">Import Project</button>
			</div>
		</div>
	`;

	document.body.appendChild(modal);

	// Event handlers
	const close = () => {
		modal.classList.remove('open');
		setTimeout(() => modal.remove(), 200);
	};

	modal.querySelector('.import-preview-close').addEventListener('click', close);
	modal.querySelector('.btn-cancel').addEventListener('click', close);
	modal.querySelector('.import-preview-content').addEventListener('click', e => e.stopPropagation());
	modal.addEventListener('click', close);

	modal.querySelector('.btn-confirm').addEventListener('click', () => {
		// Get updated project name
		const projectName = document.getElementById('import-project-name').value.trim() || config.project;

		// Get selected sections
		const checkboxes = modal.querySelectorAll('input[data-section-index]');
		const selectedIndices = [];
		checkboxes.forEach(cb => {
			if (cb.checked) {
				selectedIndices.push(parseInt(cb.dataset.sectionIndex));
			}
		});

		// Filter config based on selection
		const filteredData = config.data.filter((_, i) => selectedIndices.includes(i));

		// Update flow nodes to match selected sections
		const selectedCategories = new Set(filteredData.map(d => d.title.toLowerCase().replace(/\s+/g, '')));
		const filteredNodes = config.flow.nodes.filter((_, i) => selectedIndices.includes(i));
		const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
		const filteredEdges = config.flow.edges.filter(e =>
			filteredNodeIds.has(e.from) && filteredNodeIds.has(e.to)
		);

		// Reindex linkedDataIndex
		filteredNodes.forEach((node, i) => {
			node.linkedDataIndex = i;
		});

		const finalConfig = {
			project: projectName,
			flow: {
				nodes: filteredNodes,
				edges: filteredEdges,
			},
			data: filteredData,
		};

		close();
		onConfirm(finalConfig);
	});
}
