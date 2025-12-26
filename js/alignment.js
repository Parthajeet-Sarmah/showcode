import { callCodeAnalysisApi } from "./code.js";

export function renderAlignmentView(container, dataArray) {
	if (!dataArray || dataArray.length === 0) {
		container.innerHTML = '<div style="padding:20px;">No data available.</div>';
		return;
	}

	dataArray.forEach((section, idx) => {
		const item = document.createElement('div');
		item.className = 'alignment-accordion-item';

		item.innerHTML = `
            <div class="alignment-accordion-header">
                <div class="alignment-header-left">
                    <div class="alignment-header-title-container">
                    <span class="alignment-header-title">${idx + 1}. ${section.title}</span>
                    <span class="alignment-mean-industry-score">(Mean Score: 0)</span>
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
                <div class="alignment-snippets-track"></div>
            </div>
        `;

		const header = item.querySelector('.alignment-accordion-header');
		const track = item.querySelector('.alignment-snippets-track');
		const meanScoreSpan = item.querySelector('.alignment-mean-industry-score');
		const snippetsCount = section.snippets.length;

		header.addEventListener('click', (e) => {
			item.classList.toggle('active');
		});

		if (section.snippets && section.snippets.length > 0) {
			section.snippets.forEach((snippet, sIdx) => {
				const wrapper = document.createElement('div');
				wrapper.className = 'alignment-snippet-wrapper';

				const displayTitle = snippet.label || `Snippet ${sIdx + 1}`;

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
                             <button class="alignment-start-button">Check AI Alignment</button>
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

				industryScore.style.border = `2px solid grey`;

				innerHeader.addEventListener('click', () => {
					if (outputDiv.innerHTML.trim() !== "") {
						wrapper.classList.toggle('open');
					}
				});

				btn.addEventListener('click', async (e) => {
					e.stopPropagation();

					btn.classList.add('loading');
					btn.textContent = 'Analyzing...';
					statusText.textContent = '';

					try {
						const res = await fetch(snippet.repoUrl);
						if (!res.ok) throw new Error('Network error');
						const rawCode = await res.text();
						const score = await callCodeAnalysisApi(rawCode, outputDiv, () => {
							wrapper.classList.toggle('open');
						});

						if (score > 0) {
							let borderColor = "grey";

							if (score >= 80) borderColor = "#34A853";
							else if (score >= 50) borderColor = "#FBBC04";
							else borderColor = "#EA4335";

							industryScore.style.border = `2px solid ${borderColor}`;
							var prevScore = meanScoreSpan.textContent.match(/(\d+)/);

							if (prevScore) {
								prevScore = parseInt(prevScore[1]);
							}

							meanScoreSpan.textContent = `(Mean Score: ${parseInt(prevScore + score / snippetsCount)})`;
						}

						btn.classList.remove('loading');
						btn.textContent = 'Re-Check';
						btn.style.background = '#e2e8f0'; // Visual cue that it's done
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
