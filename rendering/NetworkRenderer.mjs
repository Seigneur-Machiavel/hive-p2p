import { NetworkRendererElements, NetworkRendererOptions } from './renderer-options.mjs';
import { Node, NodesStore, ConnectionsStore } from './renderer-stores.mjs';

export class NetworkRenderer {
	initCameraZ = 1400;
	lastAutoZoomMaxDistance = 0;
	fpsCountElement = document.getElementById('fpsCount');
	maxVisibleConnections = 500; // to avoid performance issues
	autoRotateEnabled = true;
	autoRotateSpeed = .0005; // .001
	autoRotateDelay = 3000; // delay before activating auto-rotation after mouse event
	elements;
	options;
	onNodeLeftClick = null;
	onNodeRightClick = null;
	colors = {
		background: 0x1a1a1a,
		currentPeer: 0xFFD700,
		hoveredPeer: 0xFF4500,
		connectedPeerNeighbor: 0x4CAF50,
		connectingPeerNeighbor: 0x03b5fc,
		knownPeer: 0x7d7d7d,
		publicNode: 0xffffff,
		publicNodeBorder: 0xffffff,
		twitchUser: 0xf216e4,
		// CONNECTIONS
		connection: 0x666666, // gray
		currentPeerConnection: 0x4CAF50, // green
		// DIRECT MESSAGES
		traveledConnection: [
			0x2803fc, // blue
			0x0328fc, // light blue
			0x035afc // lighter blue
		],
		toTravelConnection: 0x03b5fc, // even lighter blue for the remaining distance
		// GOSSIP MESSAGES
		gossipIncomingColor: 0xf542f5, // fuchsia
		gossipOutgoingColor: 0xc24cc2, // dark fuchsia
	};

	// Internal state
	scene = null;
	camera = null;
	renderer = null;
	raycaster = new THREE.Raycaster();
	mouse = new THREE.Vector2();

	// Data structures
	instancedMesh = null;
	/** @type {NodesStore} */ nodesStore;
	/** @type {ConnectionsStore} */ connectionsStore;

	updateBatchMax = 500; // auto-adjusted based on fps
	initUpdateBatchMax = 500;

	// State
	currentPeerId = null;
	hoveredNodeId = null;
	isAnimating = false;
	isPhysicPaused = false;

	/** This class is responsible for rendering the network visualization.
	 * @param {string} containerId
	 * @param {NetworkRendererOptions} options
	 * @param {NetworkRendererElements} rendererElements */
    constructor(containerId, options, rendererElements) {
        this.containerId = containerId;
		this.elements = new NetworkRendererElements();
		for (const key in rendererElements) if (key in this.elements) this.elements[key] = rendererElements[key];

		this.options = new NetworkRendererOptions();
		for (const key in options) if (key in this.options) this.options[key] = options[key];

        this.init();
    }

    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.colors.background);

		// Stores (nodes + connections)
		this.nodesStore = new NodesStore();
		this.connectionsStore = new ConnectionsStore(this.nodesStore, this.scene);

        // Camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
        this.camera.position.set(0, 0, this.initCameraZ);

        // Renderer
		const { antialias, precision } = this.options;
        this.renderer = new THREE.WebGLRenderer({ antialias, precision });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        const container = document.getElementById(this.containerId);
        if (container) container.appendChild(this.renderer.domElement);
        else document.body.appendChild(this.renderer.domElement);

        this.#setupControls();

		this.elements.modeSwitchBtn.textContent = this.options.mode === '2d' ? '2D' : '3D';
        window.addEventListener('resize', () => {
			this.camera.aspect = window.innerWidth / window.innerHeight;
			this.camera.updateProjectionMatrix();
			this.renderer.setSize(window.innerWidth, window.innerHeight);
		});
        this.renderer.domElement.addEventListener('mouseleave', () => {
			if (this.hoveredNodeId) this.hoveredNodeId = null;
			this.renderer.domElement.style.cursor = 'default';
			this.#hideTooltip();
		});

		// PREPARE MESH INSTANCE
		this.nodeCount = 0;
		this.nodeIndexMap = {}; // id → instanceIndex
		this.indexNodeMap = {}; // instanceIndex → id
		this.nodeBorders = {}; // id → borderMesh
		const geometry = new THREE.SphereGeometry(this.options.nodeRadius, 8, 6);
		const material = new THREE.MeshBasicMaterial();
		this.instancedMesh = new THREE.InstancedMesh(geometry, material, 50000);
		this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(50000 * 3), 3);
		this.instancedMesh.count = 0;
		this.scene.add(this.instancedMesh);

		if (this.isAnimating) return;
        this.isAnimating = true;
        this.#animate();
    }

    // Public API methods
    #createMeshBorder = (nodeMesh, color = this.colors.publicNodeBorder) => {
		const marginBetween = this.options.nodeBorderRadius * 2;
		const borderGeometry = new THREE.RingGeometry(
			this.options.nodeRadius + marginBetween,
			this.options.nodeRadius + marginBetween + this.options.nodeBorderRadius,
			16
		);
		const borderMaterial = new THREE.MeshBasicMaterial({ 
			color,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: .33
		});
		const borderMesh = new THREE.Mesh(borderGeometry, borderMaterial);
		borderMesh.position.copy(nodeMesh.position);
		borderMesh.lookAt(this.camera.position);
		this.scene.add(borderMesh);
		//nodeMesh.userData.border = borderMesh;
		return borderMesh;
	}
	addOrUpdateNode(id, status = 'known', isPublic = false, neighbors = []) {
		const existingNode = this.nodesStore.get(id);
		if (!existingNode) { // Create new node
			const newNode = new Node(id, status, isPublic, neighbors);
			this.nodesStore.add(newNode);

			// Get next available index for this node
			const instanceIndex = this.nodeCount++; // Tu auras besoin d'un compteur this.nodeCount = 0
			this.instancedMesh.count = this.nodeCount;
			this.nodeIndexMap[id] = instanceIndex; // Map node id → instance index
			this.indexNodeMap[instanceIndex] = id; // Map instance index → node id

			// Set position in instanced mesh
			const pos = newNode.position;
			const matrix = new THREE.Matrix4();
			matrix.setPosition(pos.x, pos.y, pos.z);
			this.instancedMesh.setMatrixAt(instanceIndex, matrix);
			
			// Set color
			const color = new THREE.Color(this.#getNodeColor(id));
			this.instancedMesh.setColorAt(instanceIndex, color);

			// Handle borders (séparément, comme avant)
			if (isPublic) this.nodeBorders[id] = this.#createMeshBorder({ position: pos }, this.colors.publicNodeBorder);
			return;
		}

		// Update existing node
		const instanceIndex = this.nodeIndexMap[id];
		const newColor = new THREE.Color(this.#getNodeColor(id));
		this.instancedMesh.setColorAt(instanceIndex, newColor);
		this.instancedMesh.instanceColor.needsUpdate = true;

		let needBorderUpdate = existingNode.isPublic !== isPublic;
		existingNode.status = status;
		existingNode.isPublic = isPublic;
		existingNode.neighbors = neighbors;
		this.instancedMesh.instanceMatrix.needsUpdate = true;
		if (!needBorderUpdate) return;
		
		// Handle border updates
		const existingBorder = this.nodeBorders[id];
		if (isPublic) {
			if (existingBorder) this.scene.remove(existingBorder);
			this.nodeBorders[id] = this.#createMeshBorder({ position: existingNode.position }, this.colors.publicNodeBorder);
			return;
		}

		if (!existingBorder) return;
		this.scene.remove(existingBorder);
		delete this.nodeBorders[id];
	}
	removeNode(id) {
		if (!this.nodesStore.has(id)) return; // Node doesn't exist

		const instanceIndex = this.nodeIndexMap[id];
		if (instanceIndex !== undefined) {
			const lastIndex = this.nodeCount - 1;
			
			if (instanceIndex !== lastIndex) {
				// Récupérer l'ID du dernier nœud
				const lastNodeId = this.indexNodeMap[lastIndex];
				if (lastNodeId) {
					// Copier les données du dernier nœud vers l'index à supprimer
					const lastMatrix = new THREE.Matrix4();
					const lastColor = new THREE.Color();
					
					this.instancedMesh.getMatrixAt(lastIndex, lastMatrix);
					this.instancedMesh.getColorAt(lastIndex, lastColor);
					
					this.instancedMesh.setMatrixAt(instanceIndex, lastMatrix);
					this.instancedMesh.setColorAt(instanceIndex, lastColor);
					this.instancedMesh.instanceMatrix.needsUpdate = true;
					this.instancedMesh.instanceColor.needsUpdate = true;
					
					// Mettre à jour les mappings pour le nœud déplacé
					this.nodeIndexMap[lastNodeId] = instanceIndex;
					this.indexNodeMap[instanceIndex] = lastNodeId;
				}
			}
			
			// Nettoyer les mappings pour le nœud supprimé
			delete this.nodeIndexMap[id];
			delete this.indexNodeMap[lastIndex];
			this.nodeCount--;
			this.instancedMesh.count = this.nodeCount;
		}

		// Gérer les borders
		const border = this.nodeBorders[id];
		if (border) {
			this.scene.remove(border);
			border.geometry.dispose();
			border.material.dispose();
			delete this.nodeBorders[id];
		}
		this.nodesStore.remove(id);
	}
	digestConnectionsArray(conns = [], displayNeighborsDegree = 1) {
		const existingConnsKeys = {};
		const drawLinesKeys = {};
		const currentPeerNode = this.nodesStore.get(this.currentPeerId);
		const cNeighbors = currentPeerNode?.neighbors || [];
		for (const [fromId, toId] of conns) { // add new physicConnections
			const { success, key } = this.connectionsStore.set(fromId, toId);
			if (existingConnsKeys[key]) continue; // already processed
			existingConnsKeys[key] = true; // store for control

			const isOneOfThePeer = fromId === this.currentPeerId || toId === this.currentPeerId;
			if (displayNeighborsDegree === 0 && !isOneOfThePeer) continue;

			const [fromNode, toNode] = [this.nodesStore.get(fromId), this.nodesStore.get(toId)];
			const [fNeighbors, tNeighbors] = [fromNode?.neighbors || [], toNode?.neighbors || []];
			let isFirstDegree = cNeighbors.includes(fromId) || cNeighbors.includes(toId);
			isFirstDegree = isFirstDegree || fNeighbors.includes(this.currentPeerId)
			isFirstDegree = isFirstDegree || tNeighbors.includes(this.currentPeerId);
			if (displayNeighborsDegree === 1 && !isFirstDegree) continue;
			this.connectionsStore.updateOrAssignLineColor(fromId, toId);
			drawLinesKeys[key] = true; // store for control
		}
		
		// remove physicConnections that are not in the array
		// remove visual lines that are not in the array
		for (const connStr in this.connectionsStore.store) {
			const peerConn = this.connectionsStore.store[connStr];
			if (!existingConnsKeys[connStr]) this.connectionsStore.unset(...connStr.split(':'));
			else if (!drawLinesKeys[connStr] && peerConn.line) this.connectionsStore.unassignLine(...connStr.split(':'));
		}
	}
	displayDirectMessageRoute(relayerId, route = [], frameToIgnore = 30) {
		const maxTraveledColorIndex = this.colors.traveledConnection.length - 1;
		let traveledIndex = 0;
		let isRelayerIdPassed = false;
		for (let i = 1; i < route.length; i++) {
			const color = isRelayerIdPassed ? this.colors.toTravelConnection : this.colors.traveledConnection[traveledIndex];
			this.connectionsStore.updateOrAssignLineColor(route[i - 1], route[i], color, .5, frameToIgnore);
			traveledIndex = Math.min(traveledIndex + 1, maxTraveledColorIndex);
			if (route[i - 1] === relayerId) isRelayerIdPassed = true;
		}
	}
	// THIS IS A VERY FIRST IMPLEMENTATION, NEEDS REFINEMENT
	displayGossipMessageRoute(relayerId, senderId, topic = 'peer_connected', data, frameToIgnore = 20) {
		this.connectionsStore.updateOrAssignLineColor(senderId, relayerId, this.colors.gossipOutgoingColor, .4, frameToIgnore);
		this.connectionsStore.updateOrAssignLineColor(relayerId, this.currentPeerId, this.colors.gossipIncomingColor, .8, frameToIgnore + 5);
	}
    setCurrentPeer(peerId, clearNetworkOneChange = true) {
		if (clearNetworkOneChange && peerId !== this.currentPeerId) this.clearNetwork();

        // Reset previous current peer
        if (this.currentPeerId && this.nodesStore.has(this.currentPeerId)) this.nodesStore.get(this.currentPeerId).status = 'known';
        if (peerId && this.nodesStore.has(peerId)) this.nodesStore.get(peerId).status = 'current';
		this.currentPeerId = peerId;
    }
	updateStats() {
		const info = this.nodesStore.getInfo();
		this.maxDistance = info.maxDistance;
		this.elements.nodeCountElement.textContent = info.total;
		const { connsCount, linesCount } = this.connectionsStore.getConnectionsCount();
		this.elements.connectionsCountElement.textContent = connsCount;
		this.elements.linesCountElement.textContent = linesCount;
		this.elements.connectingCountElement.textContent = info.connecting;
		const nonPublicNeighbors = info.connected - info.connectedPublic;
		this.elements.neighborCountElement.textContent = `${nonPublicNeighbors} ( +${info.connectedPublic} Public )`;
		this.elements.publicNeighborCountElement.textContent = info.connectedPublic;
    }
	switchMode() {
		this.options.mode = this.options.mode === '2d' ? '3d' : '2d';
		// reset camera angle
		this.camera.position.set(0, 0, 500);
		this.camera.lookAt(0, 0, 0);
		this.elements.modeSwitchBtn.textContent = this.options.mode === '2d' ? '2D' : '3D';
	}
	clearNetwork() {
		// Clear data
		this.nodesStore = new NodesStore(this.nodes);
		this.connectionsStore.destroy();
		this.connectionsStore = new ConnectionsStore(this.nodesStore, this.scene);
		this.currentPeerId = null;
		this.hoveredNodeId = null;

		// Clear InstancedMesh nodes - Reset count to 0
		this.nodeCount = 0;
		this.instancedMesh.count = 0;
		this.nodeIndexMap = {};
		this.indexNodeMap = {};

		// Clear borders
		for (const id in this.nodeBorders) {
			const border = this.nodeBorders[id];
			this.scene.remove(border);
			border.geometry.dispose();
			border.material.dispose();
		}
		this.nodeBorders = {};

		// reset camera
		this.camera.position.set(0, 0, this.initCameraZ);
		this.camera.lookAt(0, 0, 0);
		this.updateBatchMax = this.initUpdateBatchMax; // reset rendering batch size
	}
	destroy() {
        this.isAnimating = false;
        this.scene.clear();
        this.renderer.dispose();
        if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }

    // Internal methods
	/** @param {string} axis @param {'3d'|'2d'|null} restrictToMode */
	#autoRotate(axis = 'z', restrictToMode = null) {
		if (!this.autoRotateEnabled || !this.isAnimating) return;
		try { if (!restrictToMode || this.options.mode === restrictToMode) this.scene.rotation[axis] -= this.autoRotateSpeed;
		} catch (error) { console.error('Error during auto-rotation:', error); }
	}
	#autoZoom(margin = 1.2) {
		if (!this.isAnimating || this.options.mode !== '3d' || this.isPhysicPaused) return;

		const maxDist = this.maxDistance * margin;
		if (maxDist - this.lastAutoZoomMaxDistance < 20) return;

		const fov = this.camera.fov * (Math.PI / 180);
		const height = 2 * maxDist;
		const distance = height / (2 * Math.tan(fov / 2));
		const targetDistance = distance * 1.2;
		const currentDistance = this.camera.position.length();
		const zoomSpeed = 0.1;
		const newDistance = currentDistance + (targetDistance - currentDistance) * zoomSpeed;
		const finalDistance = Math.max(newDistance, this.initCameraZ);

		this.camera.position.normalize().multiplyScalar(finalDistance);
		this.camera.lookAt(0, 0, 0);

		if (Math.abs(currentDistance - targetDistance) < 10) 
			this.lastAutoZoomMaxDistance = maxDist;
	}
    #setupControls() {
		let setupAutoRotateTimeout;
		const initZoomSpeed2D = .1;
		const maxZoomSpeed2D = 5;
		let zoomSpeed2D = .1;
		let zoomSpeedIncrement = .02;
		let zoomSpeedIncrementFactor = .01;
		let lastZoomDirection = null;
        let isMouseDown = false;
		let mouseDownGrabCursorTimeout = null;
        let mouseButton = null;
        let previousMousePosition = { x: 0, y: 0 };

		const domElement = this.renderer.domElement;
        domElement.addEventListener('mousedown', (e) => {
			if (setupAutoRotateTimeout) clearTimeout(setupAutoRotateTimeout);
			this.autoRotateEnabled = false;
			setupAutoRotateTimeout = setTimeout(() => this.autoRotateEnabled = true, this.autoRotateDelay);

            isMouseDown = true;
            mouseButton = e.button;
            previousMousePosition.x = e.clientX;
            previousMousePosition.y = e.clientY;
			if (mouseDownGrabCursorTimeout) clearTimeout(mouseDownGrabCursorTimeout);
			mouseDownGrabCursorTimeout = setTimeout(() => domElement.style.cursor = 'grabbing', 200);
        });

        domElement.addEventListener('mouseup', () => {
            isMouseDown = false;
            mouseButton = null;
			zoomSpeed2D = initZoomSpeed2D;
			lastZoomDirection = null;
			if (mouseDownGrabCursorTimeout) clearTimeout(mouseDownGrabCursorTimeout);
			setTimeout(() => domElement.style.cursor = 'default', 20);
        });

        domElement.addEventListener('mousemove', (e) => {
            if (isMouseDown) {
                const deltaX = e.clientX - previousMousePosition.x;
                const deltaY = e.clientY - previousMousePosition.y;
				const mouseDirection = deltaY > 0 ? 'down' : 'up';
				//console.log(`Mouse moved: ${mouseDirection} (${deltaX}, ${deltaY})`);

                if (mouseButton === 2 && this.options.mode === '3d') { // Right mouse 3D - rotate
                    const rotationSpeed = 0.005;
                    const spherical = new THREE.Spherical();
                    spherical.setFromVector3(this.camera.position);
                    spherical.theta -= deltaX * rotationSpeed;
                    spherical.phi += deltaY * rotationSpeed;
                    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
                    this.camera.position.setFromSpherical(spherical);
                    this.camera.lookAt(0, 0, 0);
				} else if (mouseDirection && mouseButton === 2 && this.options.mode === '2d') { // Right mouse 2D - Zoom
					// log increase zoom speed on same direction, until max
					const oppositeDirection = !lastZoomDirection
					|| lastZoomDirection === 'out' && mouseDirection === 'down'
					|| lastZoomDirection === 'in' && mouseDirection === 'up';

					if (oppositeDirection && zoomSpeed2D === initZoomSpeed2D)
						lastZoomDirection = mouseDirection === 'up' ? 'out' : 'in'; // handle direction switch

					const zf = zoomSpeed2D * zoomSpeedIncrementFactor;
					const upperSpeed = zoomSpeed2D + zf + zoomSpeedIncrement;
					const lowerSpeed = zoomSpeed2D - zf - zoomSpeedIncrement;
					if (lastZoomDirection === 'out')
						if (mouseDirection === 'down') zoomSpeed2D = Math.max(0.1, lowerSpeed);
						else zoomSpeed2D = Math.min(maxZoomSpeed2D, upperSpeed);
					else if (lastZoomDirection === 'in')
						if (mouseDirection === 'up') zoomSpeed2D = Math.max(0.1, lowerSpeed);
						else zoomSpeed2D = Math.min(maxZoomSpeed2D, upperSpeed);

					//console.log(`Zoom speed: ${zoomSpeed2D.toFixed(2)}`);

					const forward = new THREE.Vector3();
					this.camera.getWorldDirection(forward);
					this.camera.position.add(forward.multiplyScalar(deltaY * zoomSpeed2D));
                } else if (mouseButton === 0) { // Left mouse - pan
                    const panSpeed = 1;
                    const right = new THREE.Vector3();
                    const up = new THREE.Vector3();
                    this.camera.getWorldDirection(right);
                    right.cross(this.camera.up).normalize();
                    up.copy(this.camera.up);

                    const panVector = right.multiplyScalar(-deltaX * panSpeed)
                        .add(up.multiplyScalar(deltaY * panSpeed));
                    this.camera.position.add(panVector);
                }

                previousMousePosition.x = e.clientX;
                previousMousePosition.y = e.clientY;
            }

            this.#handleMouseMove(e);
        });

        domElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomSpeed = .4;
            const forward = new THREE.Vector3();
            this.camera.getWorldDirection(forward);
            this.camera.position.add(forward.multiplyScalar(e.deltaY * -zoomSpeed));
        });

		this.elements.modeSwitchBtn.addEventListener('click', () => this.switchMode());
		domElement.addEventListener('click', () => this.onNodeLeftClick?.(this.hoveredNodeId));
        domElement.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			if (domElement.style.cursor === 'grabbing') return;
			this.onNodeRightClick?.(this.hoveredNodeId)
		});
		window.addEventListener('keydown', (e) => {
			if (e.code === 'Space') this.isPhysicPaused = !this.isPhysicPaused;
		});
	}
	#handleMouseMove(event) {
		if (this.renderer.domElement.style.cursor === 'grabbing') return;
		this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
		this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

		this.raycaster.setFromCamera(this.mouse, this.camera);
		const intersects = this.raycaster.intersectObjects(this.scene.children);

		let foundNode = null;
		for (const intersect of intersects) {
			if (intersect.object !== this.instancedMesh || intersect.instanceId === undefined) continue;
			foundNode = this.indexNodeMap[intersect.instanceId];
			if (foundNode) break;
		}

		if (foundNode === this.hoveredNodeId) return; // No change in hovered node

		// Reset previous hovered node
		if (this.hoveredNodeId) {
			const prevInstanceIndex = this.nodeIndexMap[this.hoveredNodeId];
			if (prevInstanceIndex !== undefined) {
				const originalColor = new THREE.Color(this.#getNodeColor(this.hoveredNodeId));
				this.instancedMesh.setColorAt(prevInstanceIndex, originalColor);
				this.instancedMesh.instanceColor.needsUpdate = true;
			}
		}

		this.hoveredNodeId = foundNode;
		this.#updateHoveredNodeInfo(event.clientX, event.clientY);
	}
	#updateHoveredNodeInfo(clientX, clientY) {
		if (!this.hoveredNodeId) {
			this.renderer.domElement.style.cursor = 'default';
			this.#hideTooltip();
			this.connectionsStore.resetHovered();
			return;
		}

		this.#showTooltip(clientX, clientY, this.hoveredNodeId);
		if (this.hoveredNodeId === this.currentPeerId) return;

		// Set hover color
		const instanceIndex = this.nodeIndexMap[this.hoveredNodeId];
		if (instanceIndex === undefined) return;
		
		const hoverColor = new THREE.Color(this.colors.hoveredPeer);
		this.instancedMesh.setColorAt(instanceIndex, hoverColor);
		this.instancedMesh.instanceColor.needsUpdate = true;
		this.renderer.domElement.style.cursor = 'pointer';

		// Set hovered connections flag
		const hoveredNode = this.nodesStore.get(this.hoveredNodeId);
		const neighbors = hoveredNode ? hoveredNode.neighbors : [];
		for (const toId of neighbors) this.connectionsStore.setHovered(toId, this.hoveredNodeId);
	}
	#showTooltip(x, y, nodeId, element = document.getElementById('tooltip')) {
		const node = this.nodesStore.get(nodeId);
		if (!node) return;

		const json = {
			Peer: nodeId,
			Type: node.status,
			NeighborsCount: node.neighbors.length,
			Neighbors: node.neighbors.length > 0 ? node.neighbors : 'None',
			IsPublic: node.isPublic
		};

		element.innerHTML = `<pre>${JSON.stringify(json, null, 2)}</pre>`;
		element.style.left = x + 10 + 'px';
		element.style.top = y + 10 + 'px';
		element.style.display = 'block';
	}
	#hideTooltip(element = document.getElementById('tooltip')) {
		element.style.display = 'none';
	}
    #getNodeColor(peerId) {
		const { status, isPublic } = this.nodesStore.get(peerId);
		const isTwitchUser = peerId.startsWith('F_');
		if (status !== 'current' && isTwitchUser) return this.colors.twitchUser;
        switch (status) {
            case 'current': return this.colors.currentPeer;
            case 'connected': return this.colors.connectedPeerNeighbor;
            case 'connecting': return this.colors.connectingPeerNeighbor;
            default: return isPublic ? this.colors.publicNode : this.colors.knownPeer;
        }
    }
	#getReducedBatch = (nodeIds) => {
		const nodeIdsCount = nodeIds.length;
		const batchSize = Math.floor(Math.min(nodeIdsCount, this.updateBatchMax));
		if (batchSize >= nodeIdsCount) return { batchIds: nodeIds, forceMultiplier: 1 };

		const result = [];
		for (let i = 0; i < batchSize; i++)
			result.push(nodeIds[i + Math.floor(Math.random() * (nodeIdsCount - i))]);

		const batchIds = result.slice(0, batchSize);
		const forceMultiplier = Math.round(Math.max(1, nodeIds.length / batchSize));
		return { batchIds, forceMultiplier };
	}
	#updateNodesPositions(nodeIds = [], lockCurrentNodePosition = true) {
		const { batchIds, forceMultiplier } = this.#getReducedBatch(nodeIds);
		for (const id of batchIds) {
			const [pos, vel] = [this.nodesStore.get(id)?.position, this.nodesStore.get(id)?.velocity];
            const node = this.nodesStore.get(id);
			const instanceIndex = this.nodeIndexMap[id];
			if (!pos || !vel || !node || instanceIndex === undefined) continue;

            let fx = 0, fy = 0, fz = 0;

            // Repulsion between nodes
            for (const otherId of [...batchIds, ...node.neighbors]) {
                if (id === otherId) continue;

                const otherNode = this.nodesStore.get(otherId);
                const otherPos = otherNode?.position;
                if (!otherPos || !otherNode) continue;

                const dx = pos.x - otherPos.x;
                const dy = pos.y - otherPos.y;
                const dz = pos.z - otherPos.z;
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (distance > this.options.repulsionOpts.maxDistance) continue;

				const force = this.options.repulsion * (distance * distance + 1); // +1 to avoid division by zero
				fx += (dx / distance) * force;
				fy += (dy / distance) * force;
				fz += (dz / distance) * force;
            }

            // Attraction along physicConnections
            for (const neighborId of node.neighbors) {
				const neighborPos = this.nodesStore.get(neighborId)?.position;
                if (!neighborPos) continue;

                const dx = neighborPos.x - pos.x;
                const dy = neighborPos.y - pos.y;
                const dz = neighborPos.z - pos.z;
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (distance < this.options.attractionOpts.minDistance) continue;

                const force = distance * this.options.attraction;
                fx += (dx / distance) * force;
                fy += (dy / distance) * force;
                fz += (dz / distance) * force;
            }

            // Center force
            fx += -pos.x * this.options.centerForce;
            fy += -pos.y * this.options.centerForce;
            fz += -pos.z * this.options.centerForce;

            // Update velocity
            vel.x = (vel.x + fx) * this.options.damping;
            vel.y = (vel.y + fy) * this.options.damping;
            vel.z = (vel.z + fz) * this.options.damping;

            // Limit velocity
            const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
            if (speed > this.options.maxVelocity) {
                vel.x = (vel.x / speed) * this.options.maxVelocity * forceMultiplier;
                vel.y = (vel.y / speed) * this.options.maxVelocity * forceMultiplier;
                vel.z = (vel.z / speed) * this.options.maxVelocity * forceMultiplier;
            }

			// Update position
			pos.x += vel.x;
			pos.y += vel.y;
			pos.z += vel.z;
			if (this.currentPeerId === id && lockCurrentNodePosition) for (const key of ['x', 'y', 'z']) pos[key] = 0;
			
			// Update visual object
			const matrix = new THREE.Matrix4();
			const visualZ = this.options.mode === '3d' ? pos.z : 0;
			matrix.setPosition(pos.x, pos.y, visualZ);
			this.instancedMesh.setMatrixAt(instanceIndex, matrix);

			// Update border position
			const border = this.nodeBorders[id];
			if (!border) continue;
			border.position.set(pos.x, pos.y, visualZ);
			border.lookAt(this.camera.position);
        }
	}

	lastPhysicUpdate = 0;
	frameCount = 60;
	lastFpsUpdate = 0;
	#animate() {
		if (!this.isAnimating) return;
		
		const currentTime = performance.now();
		this.frameCount++;
		if (currentTime - this.lastFpsUpdate >= 1000) {
			if (this.frameCount < 60 * .98) this.updateBatchMax = Math.round(Math.max(100, this.updateBatchMax * .9));
			this.fpsCountElement.textContent = this.frameCount;
			this.frameCount = 0;
			this.lastFpsUpdate = currentTime;
		}
		
		const shouldUpdatePhysic = currentTime - this.lastPhysicUpdate >= 1000 / 60;
		if (shouldUpdatePhysic && !this.isPhysicPaused) {
			this.lastPhysicUpdate = currentTime;
			const nodeIds = this.nodesStore.getNodesIds();
			this.#updateNodesPositions(nodeIds);
			this.connectionsStore.updateConnections(this.currentPeerId, this.hoveredNodeId, this.colors, this.options.mode);
			this.#autoRotate();
			this.#autoZoom();
		}
		
		this.instancedMesh.instanceMatrix.needsUpdate = true;
		this.instancedMesh.instanceColor.needsUpdate = true;
		this.renderer.render(this.scene, this.camera);
		
		requestAnimationFrame(() => this.#animate());
	}
}