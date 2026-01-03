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
let scale = window.innerWidth < 768 ? 0.6 : 1;
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
  			  <marker
  			    id="arrowhead"
  			    viewBox="0 0 10 10"
  			    refX="5"
  			    refY="5"
  			    markerWidth="6"
  			    markerHeight="6"
  			    orient="auto-start-reverse">
  			    <path d="M 0 0 L 10 5 L 0 10 z" />
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

	const calculateControlDist = (startX, startY, endX, endY, orientation) => {
		const dx = Math.abs(endX - startX);
		const dy = Math.abs(endY - startY);

		const minLoft = 50;

		if (orientation === "horizontal") {
			return Math.max(dx / 2, minLoft);
		} else if (orientation === "vertical") {
			return Math.max(dy / 2, minLoft);
		} else {
			return Math.max(Math.sqrt(dx * dx + dy * dy) / 4, minLoft);
		}
	};

	const setEndpointsForHandle = (sNode, tNode, startHandle, endHandle, dot) => {

		const sWidth = getElWidth(sNode.id);
		const sHeight = getElHeight(sNode.id);
		const tWidth = getElWidth(tNode.id);
		const tHeight = getElHeight(tNode.id);

		if (!startHandle && !endHandle) {
			const threshold = sHeight + 10;
			const sourceNodeRelPosY = sNode.y > tNode.y + threshold ? "bottom" : sNode.y < tNode.y - threshold ? "top" : "center";
			const sourceNodeRelPosX = (sNode.x + sWidth / 2) > (tNode.x + tWidth / 2) ? "right" : (sNode.x + sWidth / 2) < (tNode.x + tWidth / 2) ? "left" : "center";

			if (sourceNodeRelPosX === "center" && sourceNodeRelPosY === "center") {
				startHandle = "right";
				endHandle = "left";
			}

			else if (sourceNodeRelPosX === "center") {
				if (sourceNodeRelPosY === "top") {
					startHandle = "bottom"; // Source is above, exit from bottom
					endHandle = "top";      // Target is below, enter from top
				} else {
					startHandle = "right";    // Source is below, exit from top
					endHandle = "right";   // Target is above, enter from bottom
				}
			}

			else if (sourceNodeRelPosY === "center") {
				if (sourceNodeRelPosX === "left") {
					startHandle = "right";  // Source is left, exit from right
					endHandle = "left";     // Target is right, enter from left
				} else {
					startHandle = "bottom";   // Source is right, exit from left
					endHandle = "bottom";    // Target is left, enter from right
				}
			}

			else {
				startHandle = sourceNodeRelPosX === "left" ? "right" : "left";
				endHandle = sourceNodeRelPosY === "top" ? "top" : "bottom";
			}
		}

		const handleMap = {
			top: (node, w, h) => ({ x: node.x + w / 2, y: node.y, dx: 0, dy: -1 }),
			bottom: (node, w, h) => ({ x: node.x + w / 2, y: node.y + h, dx: 0, dy: 1 }),
			left: (node, w, h) => ({ x: node.x, y: node.y + h / 2, dx: -1, dy: 0 }),
			right: (node, w, h) => ({ x: node.x + w, y: node.y + h / 2, dx: 1, dy: 0 })
		};

		const startConf = (handleMap[startHandle] || handleMap.top)(sNode, sWidth, sHeight);
		const endConf = (handleMap[endHandle] || handleMap.top)(tNode, tWidth, tHeight);

		const { x: startX, y: startY } = startConf;
		const { x: endX, y: endY } = endConf;

		const isH = dot > 0;
		const orientation = isH ? "horizontal" : "vertical";

		const controlDist = calculateControlDist(startX, startY, endX, endY, orientation);

		const cp1x = startX + (startConf.dx * controlDist);
		const cp1y = startY + (startConf.dy * controlDist);
		const cp2x = endX + (endConf.dx * controlDist);
		const cp2y = endY + (endConf.dy * controlDist);

		const midX = 0.125 * startX + 0.375 * cp1x + 0.375 * cp2x + 0.125 * endX;
		const midY = 0.125 * startY + 0.375 * cp1y + 0.375 * cp2y + 0.125 * endY;

		const path = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;

		return { startX, startY, endX, endY, midX, midY, cp1x, cp1y, cp2x, cp2y, d: path };
	};

	function getBezierAngle(startX, startY, cp1x, cp1y, cp2x, cp2y, endX, endY) {
		const t = 0.5; // Midpoint
		const tx = 3 * Math.pow(1 - t, 2) * (cp1x - startX) +
			6 * (1 - t) * t * (cp2x - cp1x) +
			3 * Math.pow(t, 2) * (endX - cp2x);

		const ty = 3 * Math.pow(1 - t, 2) * (cp1y - startY) +
			6 * (1 - t) * t * (cp2y - cp1y) +
			3 * Math.pow(t, 2) * (endY - cp2y);

		const radians = Math.atan2(ty, tx);
		return radians * (180 / Math.PI);
	}

	flowState.edges.forEach((edge, idx) => {
		const sNode = flowState.nodes.find(n => n.id === edge.from);
		const tNode = flowState.nodes.find(n => n.id === edge.to);

		const startHandle = edge.handleStart;
		const endHandle = edge.handleEnd;

		if (sNode && tNode) {
			const dot = getDirection(sNode, tNode);

			var startX, startY, endX, endY, cp1x, cp1y, cp2x, cp2y, midX, midY = 0, d = "";

			({ startX, startY, endX, endY, midX, midY, cp1x, cp1y, cp2x, cp2y, d } = setEndpointsForHandle(sNode, tNode, startHandle, endHandle, dot));

			const pathId = `edge-${idx}`;
			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("d", d);
			path.setAttribute("id", pathId);
			path.setAttribute("class", "connection-path");
			path.setAttribute("marker-mid", "url(#arrowhead)")
			edgeGroup.appendChild(path);

			const markerArrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
			markerArrow.setAttribute("d", `M ${midX} ${midY - 5} L ${midX + 10} ${midY} L ${midX} ${midY + 5} z`)
			markerArrow.setAttribute("fill", "var(--marker-arrow)");

			const angle = getBezierAngle(startX, startY, cp1x, cp1y, cp2x, cp2y, endX, endY);
			markerArrow.style.transform = `rotate(${angle}deg)`;
			markerArrow.style.transformOrigin = `${midX}px ${midY}px`;

			edgeGroup.appendChild(markerArrow);

			if (edge.label) {
				const isBackwards = startX > endX;

				let textPathId = pathId;

				if (isBackwards) {
					const reversePathId = `edge-rev-${idx}`;
					const reverseD = `M ${endX} ${endY} C ${cp2x} ${cp2y}, ${cp1x} ${cp1y}, ${startX} ${startY}`;

					const reversePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
					reversePath.setAttribute("d", reverseD);
					reversePath.setAttribute("id", reversePathId);
					reversePath.setAttribute("fill", "none");
					reversePath.setAttribute("stroke", "none"); // Invisible
					edgeGroup.appendChild(reversePath);

					textPathId = reversePathId;
				}

				const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
				text.setAttribute("dy", "-10"); // Lift text above line
				text.setAttribute("fill", "#64748b");
				text.setAttribute("font-size", "12");
				text.style.pointerEvents = "none";

				const textPath = document.createElementNS("http://www.w3.org/2000/svg", "textPath");
				textPath.setAttribute("href", `#${textPathId}`); // Link to (possibly reversed) path
				textPath.setAttribute("startOffset", "50%");
				textPath.setAttribute("text-anchor", "middle");
				textPath.textContent = edge.label;
				textPath.style.backgroundColor = 'red';

				text.appendChild(textPath);
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
		const currentTitle = document.querySelector('.project-title')?.textContent;

		if (contentJson.collection && Array.isArray(contentJson.collection)) {
			const projectIndex = localStorage.getItem("currentProjectIndex") || contentJson.collection.findIndex(p => p.project === currentTitle);
			if (projectIndex !== -1) {
				contentJson.collection[projectIndex].flow = newFlowData;
			} else {
				console.warn(`Project "${currentTitle}" not found. Saving to collection[0].`);
				contentJson.collection[0].flow = newFlowData;
			}
		} else {
			throw new Error("Invalid content.json structure: 'collection' array missing.");
		}

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
