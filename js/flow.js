import { initFlowEditor } from './editor.js';

let flowState = { nodes: [], edges: [] };

let selectedNodeIds = new Set();
let isSelecting = false;
let selectionStart = { x: 0, y: 0 };
let selectionRect = { x: 0, y: 0, width: 0, height: 0 };

let isDraggingNode = false;
let dragOffsets = new Map();

let isPanning = false;
let viewX = 0;
let viewY = 0;
let scale = 1;
let panStartX = 0;
let panStartY = 0;

let timeout;

const ZOOM_SENSITIVITY = 0.001;
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;

const hoverTooltip = document.getElementById("hover-tooltip");

hoverTooltip.addEventListener("mouseenter", () => {
	if (timeout) clearTimeout(timeout);
})

hoverTooltip.addEventListener("mouseleave", () => {
	timeout = setTimeout(() => {
		hoverTooltip.style.scale = "0%"
	}, 100);
})

export function initFlow(flowData) {
	if (!flowData) return;
	flowState = flowData;

	const canvas = document.getElementById('flowCanvas');

	viewX = canvas.offsetWidth / 2;
	viewY = canvas.offsetHeight / 2;

	document.getElementById('nodesContainer').style.transformOrigin = '0 0';

	const svgLayer = document.getElementById('svgLayer');

	if (!document.getElementById('selection-marquee')) {
		const marquee = document.createElement('div');
		marquee.id = 'selection-marquee';
		canvas.appendChild(marquee);
	}

	svgLayer.innerHTML = `
        <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
            </marker>
        </defs>
        <g id="edgeGroup"></g> 
    `;

	renderNodes();
	drawEdges();
	updateView();

	initFlowEditor({
		container: canvas,
		selectedNodeIds: selectedNodeIds,
		flowState: flowState
	});

	canvas.addEventListener('mousedown', handleCanvasMouseDown);
	canvas.addEventListener('wheel', onWheel, { passive: false });

	document.addEventListener('mousemove', onGlobalMouseMove);
	document.addEventListener('mouseup', onGlobalMouseUp);

	window.addEventListener('resize', () => {
		viewX = canvas.offsetWidth / 2;
		viewY = canvas.offsetHeight / 2;
		updateView();
	});

	// Event Listeners
	document.getElementById('btn-export-flow').addEventListener('click', exportFlowToPNG);
	document.getElementById('btn-save-flow').addEventListener('click', saveFlowLayout);

	// Export Modal Close Logic
	const closeBtn = document.getElementById('exportModalCloseBtn');
	if (closeBtn) {
		closeBtn.addEventListener('click', () => {
			document.getElementById('exportModal').classList.remove('open');
		});
	}
}

function renderNodes() {
	const container = document.getElementById('nodesContainer');
	container.innerHTML = '';

	const canvas = document.getElementById('flowCanvas');
	const PADDING = 80;
	var minX = -(canvas.offsetWidth / 2) + PADDING, maxX = 0;
	var minY = -(canvas.offsetHeight / 2) + PADDING, maxY = canvas.offsetHeight / 2 - PADDING;

	flowState.nodes.forEach(node => {
		const el = document.createElement('div');
		el.className = 'flow-node';
		if (selectedNodeIds.has(node.id)) el.classList.add('selected');

		el.id = node.id;

		node.x = node.x !== undefined && node.x !== null ? node.x : Math.floor(Math.random() * (maxX - minX + 1)) + minX;
		node.y = node.y !== undefined && node.y !== null ? node.y : Math.floor(Math.random() * (maxY - minY + 1)) + minY;

		minX = node.x + 200;

		el.style.left = `${node.x}px`;
		el.style.top = `${node.y}px`;
		el.setAttribute('data-type', node.type || 'process');

		el.innerHTML = `
            <div class="handle top"></div>
            <div class="handle left"></div>
            <div class="node-header">
                <span class="node-title">${node.label}</span>
                <b class="node-info">i</b>
            </div>
            <div class="handle right"></div>
            <div class="handle bottom"></div>
        `;

		el.addEventListener('mousedown', (e) => {
			e.stopPropagation();
			startDragNode(e, node);
		});

		let info = el.getElementsByTagName("b")[0]
		info.dataset.info = node.info;

		info.addEventListener('mouseenter', onNodeHoverPositionTooltipEnter);
		info.addEventListener('mouseleave', onNodeHoverPositionTooltipLeave);
		info.addEventListener('mousemove', onNodeHoverPositionTooltipMove);

		container.appendChild(el);
	});
}

function drawEdges() {
	const edgeGroup = document.getElementById('edgeGroup');
	edgeGroup.innerHTML = '';

	const getElHeight = (id) => {
		const el = document.getElementById(id);
		return el ? el.offsetHeight : 50;
	};
	const getElWidth = (id) => {
		const el = document.getElementById(id);
		return el ? el.offsetWidth : 220;
	};

	const getDirection = (sNode, tNode) => {
		const right = [1, 0];
		const width = getElWidth(tNode.id);
		const dir = [tNode.x - (sNode.x + width), tNode.y - sNode.y];

		return right[0] * dir[0] + right[1] * dir[1];
	}

	flowState.edges.forEach(edge => {
		const sNode = flowState.nodes.find(n => n.id === edge.from);
		const tNode = flowState.nodes.find(n => n.id === edge.to);

		if (sNode && tNode) {
			const sHeight = getElHeight(sNode.id);
			const sWidth = getElWidth(sNode.id);
			const tWidth = getElWidth(tNode.id);
			const tHeight = getElHeight(tNode.id);

			const dot = getDirection(sNode, tNode);

			const startX = dot <= 0 ? sNode.x + sWidth / 2 : sNode.x + sWidth;
			const startY = dot <= 0 ? sNode.y + sHeight : sNode.y + (sHeight / 2);
			const endX = dot <= 0 ? tNode.x + tWidth / 2 : tNode.x;
			const endY = dot <= 0 ? tNode.y : tNode.y + (tHeight / 2);

			const controlDist = dot <= 0 ? Math.abs(endY - startY) / 2 : Math.abs(endX - startX) / 2;

			const d = dot <= 0
				? `M ${startX} ${startY} C ${startX} ${startY + controlDist}, ${endX} ${endY - controlDist}, ${endX} ${endY}`
				: `M ${startX} ${startY} C ${startX + controlDist} ${startY}, ${endX - controlDist} ${endY}, ${endX} ${endY}`;

			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("d", d);
			path.setAttribute("class", "connection-path");
			path.setAttribute("marker-end", "url(#arrowhead)");
			edgeGroup.appendChild(path);

			if (edge.label) {
				const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
				text.setAttribute("x", (startX + endX) / 2);
				text.setAttribute("y", (startY + endY) / 2 - 5);
				text.setAttribute("text-anchor", "middle");
				text.setAttribute("fill", "#64748b");
				text.setAttribute("font-size", "11");
				text.textContent = edge.label;
				edgeGroup.appendChild(text);
			}
		}
	});
}

function updateView() {
	const transform = `translate(${viewX}px, ${viewY}px) scale(${scale})`;

	document.getElementById('nodesContainer').style.transform = transform;
	document.getElementById('edgeGroup').style.transform = transform;

	const bgSize = 20 * scale;
	const canvas = document.getElementById('flowCanvas');
	canvas.style.backgroundSize = `${bgSize}px ${bgSize}px`;
	canvas.style.backgroundPosition = `${viewX}px ${viewY}px`;
}

function handleCanvasMouseDown(e) {
	if (e.target.id !== 'flowCanvas' && e.target.nodeName !== 'svg') return;

	if (e.shiftKey) {
		startMarquee(e);
	} else {
		clearSelection();
		startPan(e);
	}
}

function onGlobalMouseMove(e) {
	if (isDraggingNode) onDragNode(e);
	if (isPanning) onPan(e);
	if (isSelecting) onMarqueeDrag(e);
}

function onGlobalMouseUp(e) {
	if (isDraggingNode) stopDragNode();
	if (isPanning) stopPan();
	if (isSelecting) stopMarquee();
}

function onWheel(e) {
	e.preventDefault();
	const zoomAmount = -e.deltaY * ZOOM_SENSITIVITY;
	const newScale = Math.min(Math.max(scale + zoomAmount, MIN_SCALE), MAX_SCALE);

	const canvasRect = document.getElementById('flowCanvas').getBoundingClientRect();
	const mouseX = e.clientX - canvasRect.left;
	const mouseY = e.clientY - canvasRect.top;

	const worldX = (mouseX - viewX) / scale;
	const worldY = (mouseY - viewY) / scale;

	viewX = mouseX - worldX * newScale;
	viewY = mouseY - worldY * newScale;
	scale = newScale;

	updateView();
}

function startPan(e) {
	isPanning = true;
	panStartX = e.clientX - viewX;
	panStartY = e.clientY - viewY;
	document.getElementById('flowCanvas').style.cursor = 'grabbing';
}

function onPan(e) {
	e.preventDefault();
	viewX = e.clientX - panStartX;
	viewY = e.clientY - panStartY;
	updateView();
}

function stopPan() {
	isPanning = false;
	document.getElementById('flowCanvas').style.cursor = 'grab';
}

function startDragNode(e, node) {
	if (!selectedNodeIds.has(node.id)) {
		if (!e.shiftKey) {
			clearSelection();
		}
		selectNode(node.id);
	}

	isDraggingNode = true;

	const canvasRect = document.getElementById('flowCanvas').getBoundingClientRect();
	const mouseX = e.clientX - canvasRect.left;
	const mouseY = e.clientY - canvasRect.top;

	const mouseWorldX = (mouseX - viewX) / scale;
	const mouseWorldY = (mouseY - viewY) / scale;

	dragOffsets.clear();

	selectedNodeIds.forEach(id => {
		const n = flowState.nodes.find(x => x.id === id);
		if (n) {
			dragOffsets.set(id, {
				offsetX: mouseWorldX - n.x,
				offsetY: mouseWorldY - n.y
			});
		}
	});
}

function onDragNode(e) {
	const canvasRect = document.getElementById('flowCanvas').getBoundingClientRect();
	const mouseX = e.clientX - canvasRect.left;
	const mouseY = e.clientY - canvasRect.top;

	const mouseWorldX = (mouseX - viewX) / scale;
	const mouseWorldY = (mouseY - viewY) / scale;

	selectedNodeIds.forEach(id => {
		const node = flowState.nodes.find(n => n.id === id);
		const offset = dragOffsets.get(id);

		if (node && offset) {
			let newX = mouseWorldX - offset.offsetX;
			let newY = mouseWorldY - offset.offsetY;

			newX = Math.round(newX / 10) * 10;
			newY = Math.round(newY / 10) * 10;

			node.x = newX;
			node.y = newY;

			const el = document.getElementById(node.id);
			if (el) {
				el.style.left = `${newX}px`;
				el.style.top = `${newY}px`;
			}
		}
	});

	drawEdges();
}

function stopDragNode() {
	isDraggingNode = false;
	dragOffsets.clear();
}

function startMarquee(e) {
	isSelecting = true;
	const canvasRect = document.getElementById('flowCanvas').getBoundingClientRect();

	selectionStart = {
		x: e.clientX - canvasRect.left,
		y: e.clientY - canvasRect.top
	};

	const marquee = document.getElementById('selection-marquee');
	marquee.style.display = 'block';
	marquee.style.left = selectionStart.x + 'px';
	marquee.style.top = selectionStart.y + 'px';
	marquee.style.width = '0px';
	marquee.style.height = '0px';
}

function onMarqueeDrag(e) {
	e.preventDefault();
	const canvasRect = document.getElementById('flowCanvas').getBoundingClientRect();
	const currentX = e.clientX - canvasRect.left;
	const currentY = e.clientY - canvasRect.top;

	const x = Math.min(selectionStart.x, currentX);
	const y = Math.min(selectionStart.y, currentY);
	const width = Math.abs(currentX - selectionStart.x);
	const height = Math.abs(currentY - selectionStart.y);

	const marquee = document.getElementById('selection-marquee');
	marquee.style.left = x + 'px';
	marquee.style.top = y + 'px';
	marquee.style.width = width + 'px';
	marquee.style.height = height + 'px';

	selectionRect = { x, y, width, height };
}

function stopMarquee() {
	isSelecting = false;
	document.getElementById('selection-marquee').style.display = 'none';

	const worldLeft = (selectionRect.x - viewX) / scale;
	const worldTop = (selectionRect.y - viewY) / scale;
	const worldRight = (selectionRect.x + selectionRect.width - viewX) / scale;
	const worldBottom = (selectionRect.y + selectionRect.height - viewY) / scale;

	flowState.nodes.forEach(node => {
		const nodeEl = document.getElementById(node.id);
		const nodeW = nodeEl.offsetWidth;
		const nodeH = nodeEl.offsetHeight;

		if (
			node.x < worldRight &&
			(node.x + nodeW) > worldLeft &&
			node.y < worldBottom &&
			(node.y + nodeH) > worldTop
		) {
			selectNode(node.id);
		}
	});
}

function onNodeHoverPositionTooltipEnter(e) {
	hoverTooltip.style.scale = `100%`;
	hoverTooltip.style.left = `${e.target.getBoundingClientRect().x + hoverTooltip.offsetWidth / 2}px`;
	hoverTooltip.style.top = `${e.target.getBoundingClientRect().y - hoverTooltip.offsetHeight - 8}px`;

	hoverTooltip.innerHTML = `${e.target.dataset.info}`

	if (timeout) clearTimeout(timeout);
}

function onNodeHoverPositionTooltipLeave(e) {
	timeout = setTimeout(() => {
		hoverTooltip.style.scale = "0%";
	}, 100);
}

function onNodeHoverPositionTooltipMove(e) {
	hoverTooltip.style.left = `${e.clientX - hoverTooltip.clientWidth / 2}px`;
}

function selectNode(id) {
	selectedNodeIds.add(id);
	const el = document.getElementById(id);
	if (el) el.classList.add('selected');
}

function clearSelection() {
	selectedNodeIds.forEach(id => {
		const el = document.getElementById(id);
		if (el) el.classList.remove('selected');
	});
	selectedNodeIds.clear();
}

async function saveFlowLayout() {
	const newFlowData = {
		nodes: flowState.nodes.map(n => ({
			id: n.id,
			label: n.label,
			x: n.x,
			y: n.y,
			info: n.info,
			type: n.type,
			linkedDataIndex: n.linkedDataIndex
		})),
		edges: flowState.edges
	};

	try {
		const response = await fetch('content.json');
		if (!response.ok) throw new Error('Failed to fetch content.json');

		const contentJson = await response.json();
		contentJson.flow = newFlowData;

		const blob = new Blob([JSON.stringify(contentJson, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'content.json';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		if (window.showToast) {
			window.showToast('File prepared. Please overwrite content.json', 'success');
		}
	} catch (err) {
		console.error('Error saving layout:', err);
		if (window.showToast) window.showToast('Error preparing save file', 'error');
	}
}

async function exportFlowToPNG() {
	if (!flowState.nodes.length) {
		if (window.showToast) window.showToast("No nodes to export", "error");
		return;
	}

	const canvas = document.getElementById('flowCanvas');

	// 1. Calculate Bounding Box
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

	flowState.nodes.forEach(node => {
		const el = document.getElementById(node.id);
		const w = el ? el.offsetWidth : 220;
		const h = el ? el.offsetHeight : 100;

		if (node.x < minX) minX = node.x;
		if (node.x + w > maxX) maxX = node.x + w;
		if (node.y < minY) minY = node.y;
		if (node.y + h > maxY) maxY = node.y + h;
	});

	// 2. Define Fixed 4K Dimensions
	const TARGET_WIDTH = 3840;
	const TARGET_HEIGHT = 2160;
	const PADDING = 100;

	const contentWidth = maxX - minX;
	const contentHeight = maxY - minY;

	// 3. Calculate Scale to Fit
	const scaleX = (TARGET_WIDTH - (PADDING * 2)) / contentWidth;
	const scaleY = (TARGET_HEIGHT - (PADDING * 2)) / contentHeight;
	const fitScale = Math.min(scaleX, scaleY, 4); // Cap max scale at 4x for small diagrams

	// 4. Calculate Offsets to Center Content
	const finalContentWidth = contentWidth * fitScale;
	const finalContentHeight = contentHeight * fitScale;

	const offsetX = (TARGET_WIDTH - finalContentWidth) / 2;
	const offsetY = (TARGET_HEIGHT - finalContentHeight) / 2;

	if (window.showToast) window.showToast("Generating 4K export...", "info");

	try {
		const canvasEl = await html2canvas(canvas, {
			width: TARGET_WIDTH,
			height: TARGET_HEIGHT,
			scale: 1, // Ensure exact 4K output, avoiding retina scaling
			backgroundColor: '#ffffff',
			windowWidth: TARGET_WIDTH,
			windowHeight: TARGET_HEIGHT,
			onclone: (clonedDoc) => {
				const clonedNodes = clonedDoc.getElementById('nodesContainer');
				const clonedEdges = clonedDoc.getElementById('edgeGroup');
				const clonedSvgContainer = clonedDoc.getElementById('svgLayer');
				const clonedCanvas = clonedDoc.getElementById('flowCanvas');

				// Set cloned canvas to exact 4K
				clonedCanvas.style.width = `${TARGET_WIDTH}px`;
				clonedCanvas.style.height = `${TARGET_HEIGHT}px`;
				clonedCanvas.style.backgroundPosition = `center`;
				clonedCanvas.style.backgroundSize = `20px 20px`;

				clonedSvgContainer.style.width = `${TARGET_WIDTH}px`;
				clonedSvgContainer.style.height = `${TARGET_HEIGHT}px`;

				//Make all edges and their labels black in colour for better visibility;
				clonedEdges.querySelectorAll("text").forEach((t) => {
					t.style.fill = '#000'
				});

				// Calculate Transform: Move to (0,0) -> Scale -> Center in 4K
				// translate(offsetX, offsetY) centers the scaled content in the 4K frame
				// scale(fitScale) resizes the content
				// translate(-minX, -minY) moves the top-left of the content to the origin (0,0)
				const transform = `translate(${offsetX}px, ${offsetY}px) scale(${fitScale}) translate(${-minX}px, ${-minY}px)`;

				clonedNodes.style.transformOrigin = '0 0';
				clonedEdges.style.transformOrigin = '0 0';
				clonedSvgContainer.style.transformOrigin = '0 0';

				clonedNodes.style.transform = transform;
				clonedEdges.style.transform = transform;

				// Hide UI elements
				const controls = clonedDoc.querySelector('.flow-controls');
				if (controls) controls.style.display = 'none';
				const marquee = clonedDoc.getElementById('selection-marquee');
				if (marquee) marquee.style.display = 'none';
			}
		});

		// Show Preview
		const imgData = canvasEl.toDataURL("image/png");
		const previewContainer = document.getElementById('exportPreviewContainer');
		previewContainer.innerHTML = `<img src="${imgData}" style="max-width: 100%; height: auto; border-radius: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">`;

		const downloadBtn = document.getElementById('downloadPngLink');
		downloadBtn.href = imgData;
		downloadBtn.download = `flow-export-${new Date().toISOString().slice(0, 10)}.png`;

		document.getElementById('exportModal').classList.add('open');

		if (window.showToast) window.showToast("Export generated", "success");

	} catch (err) {
		console.error("Export failed:", err);
		if (window.showToast) window.showToast("Export failed", "error");
	}
}
