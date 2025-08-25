class NetworkRendererElements {
	modeSwitchBtn;
	nodeCountElement;
	neighborCountElement;
	connectionCountElement;
	fpsCountElement;

	constructor(
		modeSwitchBtn = document.getElementById('modeSwitchBtn'),
		nodeCountElement = document.getElementById('nodeCount'),
		neighborCountElement = document.getElementById('neighborCount'),
		connectionCountElement = document.getElementById('connectionCount'),
		fpsCountElement = document.getElementById('fpsCount'),
	) {
		this.modeSwitchBtn = modeSwitchBtn;
		this.nodeCountElement = nodeCountElement;
		this.neighborCountElement = neighborCountElement;
		this.connectionCountElement = connectionCountElement;
		this.fpsCountElement = fpsCountElement;
	}
}

class NetworkRendererOptions {
	mode;
	nodeRadius;
	nodeBorderRadius;
	attraction;
	repulsion;
	damping;
	centerForce;
	maxVelocity;
	repulsionOpts;
	attractionOpts;

	/**
	 * @param {'2d' | '3d'} mode 
	 * @param {number} nodeRadius @param {number} nodeBorderRadius @param {number} attraction @param {number} repulsion
	 * @param {number} damping @param {number} centerForce @param {number} maxVelocity
	 * 
	 * @param {Object} repulsionOpts
	 * @param {number} repulsionOpts.maxDistance
	 *
	 * @param {Object} attractionOpts
	 * @param {number} attractionOpts.minDistance
	 * */
	constructor(
		mode = '3d',
		nodeRadius = 12,
		nodeBorderRadius = 3,
		attraction = .001, // .0001
		repulsion = 5_000_000, // 50000
		damping = 1, // .5
		centerForce = .00005, // .0005
		maxVelocity = .5, // .2
		repulsionOpts = {
			maxDistance: 400,
		},
		attractionOpts = {
			minDistance: 100, // 50
		}
	) {
		this.mode = mode;
		this.nodeRadius = nodeRadius;
		this.nodeBorderRadius = nodeBorderRadius;
		this.attraction = attraction;
		this.repulsion = repulsion;
		this.damping = damping;
		this.centerForce = centerForce;
		this.maxVelocity = maxVelocity;
		this.repulsionOpts = repulsionOpts;
		this.attractionOpts = attractionOpts;
	}
}

class Node {
	id;
	status;
	isPublic;
	isChosen;
	neighbours;
	velocity = { x: 0, y: 0, z: 0 };
	position = {
		x: (Math.random() - 0.5) * 500,
		y: (Math.random() - 0.5) * 500,
		z: (Math.random() - 0.5) * 500
	};

	/** Constructor for a Node
	 * @param {string} id @param {'unknown' | 'known' | 'connecting' | 'connected' | 'current'} status
	 * @param {boolean} isPublic @param {boolean} isChosen @param {Array<string>} neighbours */
	constructor(id, status, isPublic, isChosen, neighbours) {
		this.id = id;
		this.status = status;
		this.isPublic = isPublic;
		this.isChosen = isChosen;
		this.neighbours = neighbours;
	}

	addNeighbour(peerId) {
		if (!this.neighbours.includes(peerId)) this.neighbours.push(peerId);
	}
	removeNeighbour(peerId) {
		this.neighbours = this.neighbours.filter(id => id !== peerId);
	}
}
class NodesWrapper {
	/** @type {Record<string, Node>} */ nodes = {};

	/** @param {Node} node */
	add(node) { this.nodes[node.id] = node; }
	get(id = 'toto') { return this.nodes[id]; }
	remove(id = 'toto') { delete this.nodes[id]; }
}
class Connections {
	nodesWrapper;
	physics = {};
	graphics = {};
	temporary = {};
	hovered = {};
	ignoredRepaint = {};

	/** @param {NodesWrapper} nodesWrapper */
	constructor(nodesWrapper) {
		this.nodesWrapper = nodesWrapper;
	}
}

export class NetworkRenderer {
	FPS = 60;
	targetMaxFPS = 60;
	maxVisibleConnections = 500; // to avoid performance issues
	visibleConnectionsCount = 0;
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
		chosenPeer: 0xFF69B4,
		hoveredPeer: 0xFF4500,
		connectedPeerNeighbour: 0x4CAF50,
		connectingPeerNeighbour: 0x03b5fc,
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
	/** @type {Record<string, Node>} */ nodes = {};
	connections;

	physicConnections = {}; // keyPairs
	connectionLines = {}; // keyPairs
	tempConnections = {}; // keyPairs
	hoveredConnections = {}; // keyPairs
	ignoredConnectionsRepaint = {}; // keyPairs

	updateBatches = 10;
	updateBatchMax = 50;

	// State
	currentPeerId = null;
	hoveredNodeId = null;
	isAnimating = false;

	// Performance tracking
    frameCount = 0;
    lastTime = Date.now();

	/** This class is responsible for rendering the network visualization.
	 * @param {string} containerId
	 * @param {NetworkRendererOptions} options
	 * @param {NetworkRendererElements} rendererElements */
    constructor(containerId, options, rendererElements) {
		const nodesWrapper = new NodesWrapper(this.nodes);
		//nodesWrapper.add(new Node('toto', 'current', true, true, []));
		this.connections = new Connections(nodesWrapper);
		//nodesWrapper.add(new Node('toto2', 'public', true, true, []));
		this.#resetFrameTiming();
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

        // Camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
        this.camera.position.set(0, 0, 1200);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: false, precision: "lowp" });
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
    #createMeshBorder = (nodeMesh, isChosen) => {
		const marginBetween = this.options.nodeBorderRadius * 2;
		const borderGeometry = new THREE.RingGeometry(
			this.options.nodeRadius + marginBetween,
			this.options.nodeRadius + marginBetween + this.options.nodeBorderRadius,
			16
		);
		const borderMaterial = new THREE.MeshBasicMaterial({ 
			color: isChosen ? this.colors.chosenPeer : this.colors.publicNodeBorder,
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
	addOrUpdateNode(id, status = 'known', isPublic = false, isChosen = false, neighbours = []) {
		if (!this.nodes[id]) { // Create new node
			this.nodes[id] = new Node(id, status, isPublic, isChosen, neighbours);

			// Get next available index for this node
			const instanceIndex = this.nodeCount++; // Tu auras besoin d'un compteur this.nodeCount = 0
			this.instancedMesh.count = this.nodeCount;
			this.nodeIndexMap[id] = instanceIndex; // Map node id → instance index
			this.indexNodeMap[instanceIndex] = id; // Map instance index → node id

			// Set position in instanced mesh
			const pos = this.nodes[id].position;
			const matrix = new THREE.Matrix4();
			matrix.setPosition(pos.x, pos.y, pos.z);
			this.instancedMesh.setMatrixAt(instanceIndex, matrix);
			
			// Set color
			const color = new THREE.Color(this.#getNodeColor(id));
			this.instancedMesh.setColorAt(instanceIndex, color);

			// Handle borders (séparément, comme avant)
			if (isPublic || isChosen) {
				// Tu devras créer un mesh temporaire pour le border ou adapter ta logique
				const borderMesh = this.#createMeshBorder({ position: pos }, isChosen);
				this.nodeBorders[id] = borderMesh; // Nouvelle Map pour stocker les borders
			}
			
			return;
		}

		// Update existing node
		const instanceIndex = this.nodeIndexMap[id];
		const newColor = new THREE.Color(this.#getNodeColor(id));
		this.instancedMesh.setColorAt(instanceIndex, newColor);
		this.instancedMesh.instanceColor.needsUpdate = true;

		let needBorderUpdate = this.nodes[id].isPublic !== isPublic || this.nodes[id].isChosen !== isChosen;
		this.nodes[id].status = status;
		this.nodes[id].isPublic = isPublic;
		this.nodes[id].isChosen = isChosen;
		this.nodes[id].neighbours = neighbours;
		this.instancedMesh.instanceMatrix.needsUpdate = true;
		if (!needBorderUpdate) return;
		
		// Handle border updates
		const existingBorder = this.nodeBorders[id];
		if (isPublic || isChosen) {
			if (existingBorder) this.scene.remove(existingBorder);
			const pos = this.nodes[id].position;
			const newBorder = this.#createMeshBorder({ position: pos }, isChosen);
			this.nodeBorders[id] = newBorder;
			return;
		}

		if (!existingBorder) return;
		this.scene.remove(existingBorder);
		delete this.nodeBorders[id];
	}
	removeNode(id) {
		if (!this.nodes[id]) return;

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

		// Nettoyer les structures de données
		delete this.nodes[id];
	}
	digestConnectionsArray(conns = [], displayNeighboursDegree = 1) {
		const existingConns = {};
		for (const [fromId, toId] of conns) { // add new physicConnections
			const connStr = `${fromId}:${toId}`;
       		const connStrRev = `${toId}:${fromId}`;
			existingConns[connStr] = true; // store for control
			existingConns[connStrRev] = true; // store for control
        	if (this.physicConnections[connStr] || this.physicConnections[connStrRev]) continue;
			this.physicConnections[connStr] = true;

			const isOneOfThePeer = fromId === this.currentPeerId || toId === this.currentPeerId;
			const isOneOfTheNeighbours = this.nodes[this.currentPeerId]?.neighbours?.includes(fromId) || this.nodes[this.currentPeerId]?.neighbours?.includes(toId);
			if (!displayNeighboursDegree) return;
			if (displayNeighboursDegree === 1 && !isOneOfThePeer) return;
			if (displayNeighboursDegree === 2 && !isOneOfTheNeighbours) return;

			this.#addConnectionLine(fromId, toId);
		}

		const connectionsKeys = Object.keys(this.physicConnections);
		for (const connStr of connectionsKeys) // remove physicConnections that are not in the array
			if (!existingConns[connStr]) this.#removeConnection(connStr);
	}
	displayDirectMessageRoute(relayerId, route = [], frameToIgnore = 30) {
		const maxTraveledColorIndex = this.colors.traveledConnection.length - 1;
		let traveledIndex = 0;
		let isRelayerIdPassed = false;
		for (let i = 1; i < route.length; i++) {
			const connStr = `${route[i - 1]}:${route[i]}`;
			this.ignoredConnectionsRepaint[connStr] = frameToIgnore;
			const color = isRelayerIdPassed ? this.colors.toTravelConnection : this.colors.traveledConnection[traveledIndex];

			const lineExist = this.connectionLines[connStr];
			if (!lineExist) this.#addConnectionLine(route[i - 1], route[i]);
			else this.#updateConnectionColor(route[i - 1], route[i], color, .5);

			// if we just created a new conn line, we remove it a short time after
			if(!lineExist) setTimeout(() => this.#removeConnectionLine(connStr), 500);

			traveledIndex = Math.min(traveledIndex + 1, maxTraveledColorIndex);
			if (route[i - 1] === relayerId) isRelayerIdPassed = true;
		}
	}
	// THIS IS A VERY FIRST IMPLEMENTATION, NEEDS REFINEMENT
	displayGossipMessageRoute(relayerId, senderId, topic = 'peer_connected', data, frameToIgnore = 10) {
		this.ignoredConnectionsRepaint[`${relayerId}:${senderId}`] = frameToIgnore;
		this.ignoredConnectionsRepaint[`${this.currentPeerId}:${relayerId}`] = frameToIgnore + 5;

		this.#updateConnectionColor(relayerId, senderId, this.colors.gossipOutgoingColor, .4); // sender to relayer
		this.#updateConnectionColor(relayerId, this.currentPeerId, this.colors.gossipIncomingColor, .8); // relayer to current
	}
    setCurrentPeer(peerId, clearNetworkOneChange = true) {
		if (clearNetworkOneChange && peerId !== this.currentPeerId) this.clearNetwork();

        // Reset previous current peer
        if (this.currentPeerId && this.nodes[this.currentPeerId]) this.nodes[this.currentPeerId].status = 'known';
        if (peerId && this.nodes[peerId]) this.nodes[peerId].status = 'current';
		this.currentPeerId = peerId;
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
		this.nodes = {};
		this.physicConnections = {};
		this.tempConnections = {};
		this.hoveredConnections = {};
		this.currentPeerId = null;
		this.hoveredNodeId = null;
		this.visibleConnectionsCount = 0;

		// Clear InstancedMesh nodes - Reset count to 0
		this.nodeCount = 0;
		this.instancedMesh.count = 0;
		this.nodeIndexMap = {};
		this.indexNodeMap = {};

		// Clear borders
		for (const [id, border] of Object.entries(this.nodeBorders)) {
			this.scene.remove(border);
			border.geometry.dispose();
			border.material.dispose();
		}
		this.nodeBorders = {};
		
		// Clear connectionLines (unchanged)
		for (const [id, connObj] of Object.entries(this.connectionLines)) {
			this.scene.remove(connObj);
			connObj.geometry.dispose();
			connObj.material.dispose();
		}
		this.connectionLines = {};
		this.updateStats();
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
            const zoomSpeed = 0.1;
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
			for (const connStr of Object.keys(this.hoveredConnections)) this.#removeConnectionLine(connStr);
			this.hoveredConnections = {};
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

		const hoveredNode = this.nodes[this.hoveredNodeId];
		const hoveredNeighbours = hoveredNode ? hoveredNode.neighbours : [];
		for (const toId of hoveredNeighbours)  {
			this.#addConnectionLine(this.hoveredNodeId, toId);
			this.hoveredConnections[`${this.hoveredNodeId}:${toId}`] = true;
		}
	}
	#showTooltip(x, y, nodeId, element = document.getElementById('tooltip')) {
		const node = this.nodes[nodeId];
		if (!node) return;

		const json = {
			Peer: nodeId,
			Type: node.status,
			Neighbours: node.neighbours.length > 0 ? node.neighbours : 'None',
			IsPublic: node.isPublic,
			IsChosen: node.isChosen
		};

		element.innerHTML = `<pre>${JSON.stringify(json, null, 2)}</pre>`;
		element.style.left = x + 10 + 'px';
		element.style.top = y + 10 + 'px';
		element.style.display = 'block';
	}
	#hideTooltip(element = document.getElementById('tooltip')) {
		element.style.display = 'none';
	}
	#removeConnection(connStr = 'id1:id2') {
        if (!this.physicConnections[connStr]) return;
		// remove physic connection
        const [fromId, toId] = connStr.split(':');
        delete this.physicConnections[connStr];
        
        // Update neighbours
		this.nodes[fromId]?.removeNeighbour(toId);
		this.nodes[toId]?.removeNeighbour(fromId);

        this.#removeConnectionLine(connStr);
    }
	#addConnectionLine(fromId = 'peer_1', toId = 'peer_2') {
		const connStr = `${fromId}:${toId}`;
		const fromPos = this.nodes[fromId]?.position;
		const toPos = this.nodes[toId]?.position;
		if (!fromPos || !toPos) return;
		if (this.connectionLines[connStr]) return; // already exists

		const geometry = new THREE.BufferGeometry();
		const p = new Float32Array([
			fromPos.x, fromPos.y, fromPos.z,
			toPos.x, toPos.y, toPos.z
		]);
		geometry.setAttribute('position', new THREE.BufferAttribute(p, 3));
		
		const material = new THREE.LineBasicMaterial({
			color: this.colors.connection,
			transparent: true,
			opacity: .5,
		});
		const line = new THREE.Line(geometry, material);
		line.userData = { fromId, toId, type: 'connection' };
		
		this.scene.add(line);
		this.connectionLines[connStr] = line;
	}
	#removeConnectionLine(connStr = 'id1:id2') {
		const connObj = this.connectionLines[connStr];
		if (!connObj) return;
		this.scene.remove(connObj);
		delete this.connectionLines[connStr];
		delete this.tempConnections[connStr];
	}
    #getNodeColor(peerId) {
		const { status, isPublic } = this.nodes[peerId];
		const isTwitchUser = peerId.startsWith('u_');
		if (status !== 'current' && isTwitchUser) return this.colors.twitchUser;
        switch (status) {
            case 'current': return this.colors.currentPeer;
            case 'connected': return this.colors.connectedPeerNeighbour;
            case 'connecting': return this.colors.connectingPeerNeighbour;
            default: return isPublic ? this.colors.publicNode : this.colors.knownPeer;
        }
    }
	#updateConnectionColor(peerId1, peerId2, colorHex, opacity = 1) {
		const connStr = `${peerId1}:${peerId2}`;
		const revConnStr = `${peerId2}:${peerId1}`;
		const connMesh1 = this.connectionLines[connStr];
		const connMesh2 = this.connectionLines[revConnStr];
		if (!connMesh1 && !connMesh2) return;
		if (connMesh1) { connMesh1.material.color.setHex(colorHex); connMesh1.material.opacity = opacity; }
		if (connMesh2) { connMesh2.material.color.setHex(colorHex); connMesh2.material.opacity = opacity; }
	}
	#getReducedBatch = (nodeIds) => {
		const batchSize = Math.floor(Math.min(nodeIds.length, this.updateBatchMax));
		if (batchSize >= nodeIds.length) return nodeIds;

		const result = [...nodeIds];
		for (let i = 0; i < batchSize; i++) {
			const j = i + Math.floor(Math.random() * (result.length - i));
			[result[i], result[j]] = [result[j], result[i]];
		}
		return result.slice(0, batchSize);
	}
	#updateNodesPositions(nodeIds = [], lockCurrentNodePosition = true, simplyCalculation = true) {
		const batchIds = simplyCalculation ? this.#getReducedBatch(nodeIds) : nodeIds;
		for (const id of batchIds) {
			const [pos, vel] = [this.nodes[id]?.position, this.nodes[id]?.velocity];
            const node = this.nodes[id];
			const instanceIndex = this.nodeIndexMap[id];
			if (!pos || !vel || !node || instanceIndex === undefined) continue;

            let fx = 0, fy = 0, fz = 0;

            // Repulsion between nodes
            for (const otherId of [...batchIds, ...node.neighbours]) {
                if (id === otherId) continue;

                const otherNode = this.nodes[otherId];
                const otherPos = otherNode?.position;
                if (!otherPos || !otherNode) continue;

                const dx = pos.x - otherPos.x;
                const dy = pos.y - otherPos.y;
                const dz = pos.z - otherPos.z;
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (distance > this.options.repulsionOpts.maxDistance) continue;

				const force = this.options.repulsion * (distance * distance + 1);
				fx += (dx / distance) * force;
				fy += (dy / distance) * force;
				fz += (dz / distance) * force;
            }

            // Attraction along physicConnections
            for (const neighbourId of node.neighbours) {
				const neighbourPos = this.nodes[neighbourId]?.position;
                if (!neighbourPos) continue;

                const dx = neighbourPos.x - pos.x;
                const dy = neighbourPos.y - pos.y;
                const dz = neighbourPos.z - pos.z;
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
                vel.x = (vel.x / speed) * this.options.maxVelocity;
                vel.y = (vel.y / speed) * this.options.maxVelocity;
                vel.z = (vel.z / speed) * this.options.maxVelocity;
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
	#isIgnoredConnectionRepaint(connStr) {
		const revConnStr = `${connStr.split(':')[1]}:${connStr.split(':')[0]}`;
		const isToIgnore = this.ignoredConnectionsRepaint[revConnStr] || this.ignoredConnectionsRepaint[connStr];
		if (isToIgnore && this.ignoredConnectionsRepaint[connStr]) {
			this.ignoredConnectionsRepaint[connStr]--;
			if (this.ignoredConnectionsRepaint[connStr] <= 0) delete this.ignoredConnectionsRepaint[connStr];
		}
		if (isToIgnore && this.ignoredConnectionsRepaint[revConnStr]) {
			this.ignoredConnectionsRepaint[revConnStr]--;
			if (this.ignoredConnectionsRepaint[revConnStr] <= 0) delete this.ignoredConnectionsRepaint[revConnStr];
		}
		return isToIgnore;
	}
    #updateConnections() {
        for (const [connStr, line] of Object.entries(this.connectionLines)) {
            const [fromId, toId] = connStr.split(':');
            const fromPos = this.nodes[fromId]?.position;
            const toPos = this.nodes[toId]?.position;

            if (fromPos && toPos && line.geometry) {
                const positionAttribute = line.geometry.attributes.position;
                positionAttribute.array[0] = fromPos.x;
                positionAttribute.array[1] = fromPos.y;
                positionAttribute.array[2] = this.options.mode === '3d' ? fromPos.z : 0;
                positionAttribute.array[3] = toPos.x;
                positionAttribute.array[4] = toPos.y;
                positionAttribute.array[5] = this.options.mode === '3d' ? toPos.z : 0;
                positionAttribute.needsUpdate = true;

                // Update connection color
				if (this.#isIgnoredConnectionRepaint(connStr)) continue;
                let color = this.colors.connection;
                const isCurrentPeer = fromId === this.currentPeerId || toId === this.currentPeerId;
                const isHoveredPeer = fromId === this.hoveredNodeId || toId === this.hoveredNodeId;
                if (isCurrentPeer) color = this.colors.currentPeerConnection;
                if (isHoveredPeer) color = this.colors.hoveredPeer;
                line.material.color.setHex(color);
				line.material.opacity = color === this.colors.connection ? .33 : .5;
            }
        }
    }
	#animate() {
		if (!this.isAnimating) return;
		const currentTime = performance.now();
		this.#updateFPS(currentTime);
		this.#autoRotate();

		this.instancedMesh.instanceMatrix.needsUpdate = true;
		this.instancedMesh.instanceColor.needsUpdate = true;
		this.#updateNodesPositions(Object.keys(this.nodes));
		this.#updateConnections();
		this.renderer.render(this.scene, this.camera);
		this.#scheduleNextFrameStrict(currentTime);
	}
	#updateFPS(currentTime) {
		this.frameCount++;
		if (!this.frameTimes) { this.frameTimes = []; this.lastFrameTime = currentTime; }
		
		const deltaTime = currentTime - this.lastFrameTime;
		this.lastFrameTime = currentTime;
		this.frameTimes.push(deltaTime);
		if (this.frameTimes.length > 30) this.frameTimes.shift();

		const avgDelta = this.frameTimes.reduce((sum, dt) => sum + dt, 0) / this.frameTimes.length;
		this.FPS = Math.round(1000 / avgDelta);
		if (this.frameCount % 30 === 0) this.elements.fpsCountElement.textContent = this.FPS;
	}
	#scheduleNextFrameStrict(currentTime) {
		const targetFrameTime = 1000 / this.targetMaxFPS;
		if (!this.nextFrameTime) this.nextFrameTime = currentTime + targetFrameTime;
		while (this.nextFrameTime <= currentTime) this.nextFrameTime += targetFrameTime;
		setTimeout(() => requestAnimationFrame(() => this.#animate()), this.nextFrameTime - currentTime);
	}
	#resetFrameTiming() {
		this.frameTimes = [];
		this.lastFrameTime = null;
		this.lastScheduledTime = null;
		this.nextFrameTime = null;
		this.frameCount = 0;
	}
    updateStats(neighborsCount = 0) {
	   this.elements.nodeCountElement.textContent = Object.keys(this.nodes).length;
	   this.elements.connectionCountElement.textContent = Object.keys(this.physicConnections).length;
	   this.elements.neighborCountElement.textContent = neighborsCount;
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = NetworkRenderer;
else window.NetworkRenderer = NetworkRenderer;