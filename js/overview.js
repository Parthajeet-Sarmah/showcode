import { openModal } from './main.js';

export function renderOverview(container, dataArray) {
	if (!dataArray || dataArray.length === 0) {
		container.innerHTML = '<div style="padding:20px;">No data available.</div>';
		return;
	}

	container.innerHTML = ``;

	// Check if any item has a groupLabel
	const hasGroups = dataArray.some(item => item.groupLabel);

	if (!hasGroups) {
		renderItems(container, dataArray);
	} else {
		const groups = new Map();
		const noGroupKey = '__ungrouped__';

		dataArray.forEach(item => {
			const key = item.groupLabel || noGroupKey;
			if (!groups.has(key)) {
				groups.set(key, []);
			}
			groups.get(key).push(item);
		});

		groups.forEach((items, key) => {
			if (key !== noGroupKey) {
				const header = document.createElement('div');
				header.className = 'group-header';
				header.textContent = key;
				container.appendChild(header);
			}
			renderItems(container, items);
		});
	}
}

function renderItems(container, items) {
	items.forEach((section, idx) => {
		const item = document.createElement('div');
		item.className = 'accordion-item';

		item.innerHTML = `
            <div class="accordion-header">
                <div class="header-left">
                    <span class="header-title">${idx + 1}. ${section.title}</span>
                    <span class="header-description">${section.description || ''}</span>
                </div>
                <div class="accordion-icon">
                    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </div>
            <div class="accordion-content">
								<div class="accordion-inner">
		                <div class="snippets-track"></div>
								</div>
            </div>
        `;

		const header = item.querySelector('.accordion-header');
		const track = item.querySelector('.snippets-track');

		header.addEventListener('click', () => { item.classList.toggle('active'); });

		if (section.snippets && section.snippets.length > 0) {
			section.snippets.forEach((snippet, sIdx) => {
				const block = document.createElement('div');
				block.className = 'snippet-block-btn';
				const displayTitle = snippet.label || `Snippet ${sIdx + 1}`;

				block.innerHTML = `
                    <div class="block-title">${displayTitle}</div>
                    <span class="header-file">${snippet.file}</span>
                    <div class="block-lang">${snippet.language}</div>
                `;

				block.addEventListener('click', (e) => {
					e.stopPropagation();
					openModal(snippet);
				});
				track.appendChild(block);
			});
		} else {
			track.innerHTML = `<div style="padding:10px; color:#999; font-style:italic">No snippets available.</div>`;
		}
		container.appendChild(item);
	});
}