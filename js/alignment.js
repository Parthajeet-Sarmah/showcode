import { callCodeAnalysisApi } from "./code.js";
import { API_BASE_URL } from "./config.js";

export async function renderAlignmentView(container, dataArray) {
	if (!dataArray || dataArray.length === 0) {
		container.innerHTML = '<div style="padding:20px;">No data available.</div>';
		return;
	}

	container.innerHTML = ``;

	// Fetch existing alignments
	let alignmentsMap = {};
	try {
		const res = await fetch(`${API_BASE_URL}/alignments`);
		if (res.ok) {
			alignmentsMap = await res.json();
		}
	} catch (e) {
		console.warn("Failed to load alignments:", e);
	}

	dataArray.forEach((section, idx) => {
		const item = document.createElement('div');
		item.className = 'alignment-accordion-item';

		item.innerHTML = `
            <div class="alignment-accordion-header">
                <div class="alignment-header-left">
                    <div class="alignment-header-title-container">
                    <span class="alignment-header-title">${idx + 1}. ${section.title}</span>
                    </div>
                    <span class="alignment-header-description">${section.description || ''}</span>
                </div>
                <div class="alignment-accordion-icon">
                    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </div>
            <div class="alignment-accordion-content">
								<div class="alignment-accordion-inner">
		                <div class="alignment-snippets-track"></div>
								</div>
            </div>
        `;

		const header = item.querySelector('.alignment-accordion-header');
		const track = item.querySelector('.alignment-snippets-track');
		const snippetsCount = section.snippets.length;

		header.addEventListener('click', (e) => {
			item.classList.toggle('active');
		});

		let totalSectionScore = 0;
		let ratedSnippetsCount = 0;

		if (section.snippets && section.snippets.length > 0) {
			section.snippets.forEach((snippet, sIdx) => {
				const wrapper = document.createElement('div');
				wrapper.className = 'alignment-snippet-wrapper';

				const displayTitle = snippet.label || `Snippet ${sIdx + 1}`;
				// Generate signature
				const signature = `${snippet.repoUrl}|${snippet.lineStart || ''}|${snippet.lineEnd || ''}`;

				wrapper.innerHTML = `
                    <div class="alignment-inner-header">
                        <div class="alignment-snippet-block-container">
                            <span class="alignment-industry-score"></span>
                            <div class="alignment-block-title">${displayTitle}</div>
                            <span class="alignment-header-file">${snippet.file}</span>
                            <div class="alignment-block-lang">${snippet.language}</div>
                        </div>
                        <div class="alignment-actions">
                             <span class="alignment-status-text"></span>
                             <button type="button" class="alignment-start-button">Check AI Alignment</button>
                        </div>
                    </div>
                    <div class="alignment-inner-content">
                        <div class="alignment-llm-output markdown-body"></div>
                    </div>
                `;

				const btn = wrapper.querySelector('.alignment-start-button');
				const innerHeader = wrapper.querySelector('.alignment-inner-header');
				const outputDiv = wrapper.querySelector('.alignment-llm-output');
				const statusText = wrapper.querySelector('.alignment-status-text');
				const industryScore = wrapper.querySelector('.alignment-industry-score');

				// Default styling
				industryScore.style.backgroundColor = `grey`;
				industryScore.textContent = 'UNKNOWN';

				// Check for existing alignment
				if (alignmentsMap[signature]) {
					const savedContent = alignmentsMap[signature];
					try {
						const htmlContent = marked.parse(savedContent, { renderer: window.markedRenderer });
						outputDiv.innerHTML = htmlContent;
						outputDiv.querySelectorAll('pre code').forEach((block) => {
							if (window.hljs) hljs.highlightElement(block);
						});

						const m = htmlContent.match(/(\d+)\/\d+/);
						if (m) {
							const score = parseInt(m[1]);
							if (score > 0) {
								let borderColor = "grey";
								let label = "UNKNOWN";

								if (score >= 80) {
									borderColor = "#34A853";
									label = "ROBUST";
								}
								else if (score >= 50) {
									borderColor = "#FBBC04";
									label = "MID-LEVEL";
								}
								else {
									borderColor = "#EA4335";
									label = "INSECURE";
								}
								industryScore.style.backgroundColor = `${borderColor}`;
								industryScore.textContent = label;
								totalSectionScore += score;
								ratedSnippetsCount++;
							}
						}

						btn.textContent = 'Re-Check';
						btn.style.background = '#e2e8f0';
					} catch (e) {
						console.error("Error parsing saved alignment:", e);
					}
				}

				innerHeader.addEventListener('click', () => {
					if (outputDiv.innerHTML.trim() !== "") {
						wrapper.classList.toggle('open');
					}
				});

				function trimLines(code, startLine, endLine) {
					const lines = code.split(/\r?\n/); // handles \n and \r\n
					return lines.slice(startLine - 1, endLine).join('\n');
				}

				btn.addEventListener('click', async (e) => {
					e.preventDefault();
					e.stopPropagation();

					btn.classList.add('loading');
					btn.textContent = 'Analyzing...';
					statusText.textContent = '';

					try {
						const res = await fetch(snippet.repoUrl);
						if (!res.ok) throw new Error('Network error');
						var rawCode = await res.text();

						if (snippet.lineStart && snippet.lineEnd) {
							rawCode = trimLines(rawCode, snippet.lineStart, snippet.lineEnd);
						}

						// Pass signature to API
						const score = await callCodeAnalysisApi(rawCode, outputDiv, () => {
							wrapper.classList.toggle('open');
						}, null, signature);

						if (score > 0) {
							let borderColor = "grey";
							let label = "UNKNOWN";

							if (score >= 80) {
								borderColor = "#34A853";
								label = "ROBUST";
							}
							else if (score >= 50) {
								borderColor = "#FBBC04";
								label = "MID-LEVEL";
							}
							else {
								borderColor = "#EA4335";
								label = "INSECURE";
							}

							industryScore.style.backgroundColor = `${borderColor}`;
							industryScore.textContent = label;
						}

						btn.classList.remove('loading');
						btn.textContent = 'Re-Check';
						btn.style.background = '#e2e8f0';
					} catch (err) {
						btn.classList.remove('loading');
						btn.textContent = 'Error';
						console.error(err);
					}
				});

				track.appendChild(wrapper);
			});
		} else {
			track.innerHTML = `<div style="padding:10px; color:#999; font-style:italic">No snippets available.</div>`;
		}

		container.appendChild(item);
	});
}
