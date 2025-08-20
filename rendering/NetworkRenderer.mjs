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
		attraction = .0001, // .001
		repulsion = 50000, // 5000
		damping = 1, // .5
		centerForce = .00005, // .0005
		maxVelocity = .2, // .2
		repulsionOpts = {
			maxDistance: 400,
		},
		attractionOpts = {
			minDistance: 400, // 50
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

class SpatialGrid {
    constructor(cellSize = 400) {
        this.cellSize = cellSize;
        this.grid = new Map(); // { "x:y:z": Set<id> }
    }

    getCellKey(x, y, z) {
        return `${Math.floor(x / this.cellSize)}:${Math.floor(y / this.cellSize)}:${Math.floor(z / this.cellSize)}`;
    }
    addNode(id, x, y, z) {
        const key = this.getCellKey(x, y, z);
        if (!this.grid.has(key)) this.grid.set(key, new Set());
        this.grid.get(key).add(id);
    }
    getNearbyNodes(x, y, z) {
        const nearbyNodes = new Set();
        const [cx, cy, cz] = this.getCellKey(x, y, z).split(':').map(Number);
        for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
                for (let dz = -1; dz <= 1; dz++) {
                    const key = `${cx + dx}:${cy + dy}:${cz + dz}`;
                    if (this.grid.has(key)) this.grid.get(key).forEach(id => nearbyNodes.add(id));
                }
        
        return Array.from(nearbyNodes);
    }
    clear() {
        this.grid.clear();
    }
}

class BarnesHutNode {
    constructor(bounds, depth) {
        this.bounds = bounds; // { min: {x,y,z}, max: {x,y,z}, center: {x,y,z} }
        this.children = [];
        this.node = null; // ID du nœud ou null si cellule interne
        this.mass = 0;
        this.centerOfMass = { x: 0, y: 0, z: 0 };
        this.depth = depth;
    }

    insert(id, pos, mass = 1) {
		if (!this.bounds.contains)
			return console.error(`Bounds not defined for node ${id}: ${this.bounds}`);
        if (!this.bounds.contains(pos))
			return false;
        if (this.node !== null && this.depth > 0) {
            // Cellule interne : insérer dans les enfants
            if (this.children.length === 0) {
                this.subdivide();
            }
            for (const child of this.children) {
                if (child.insert(id, pos, mass)) {
                    this.updateCenterOfMass(id, pos, mass);
                    return true;
                }
            }
        }
        if (this.node === null) {
            // Cellule vide : occuper
            this.node = id;
            this.mass = mass;
            this.centerOfMass = { ...pos };
            return true;
        } else {
            // Cellule occupée : subdiviser
            if (this.depth > 0) {
                const existingPos = this.positions.get(this.node);
                this.subdivide();
                this.children.forEach(child => {
                    child.insert(this.node, existingPos, mass);
                    child.insert(id, pos, mass);
                });
                this.node = null;
                this.updateCenterOfMass(id, pos, mass);
                return true;
            }
        }
        return false;
    }

    subdivide() {
        const { min, max } = this.bounds;
        const cx = (min.x + max.x) / 2;
        const cy = (min.y + max.y) / 2;
        const cz = (min.z + max.z) / 2;
        this.children = [
            new BarnesHutNode({ min: { x: min.x, y: min.y, z: min.z }, max: { x: cx, y: cy, z: cz } }, this.depth - 1),
            new BarnesHutNode({ min: { x: cx, y: min.y, z: min.z }, max: { x: max.x, y: cy, z: cz } }, this.depth - 1),
            new BarnesHutNode({ min: { x: min.x, y: cy, z: min.z }, max: { x: cx, y: max.y, z: cz } }, this.depth - 1),
            new BarnesHutNode({ min: { x: cx, y: cy, z: min.z }, max: { x: max.x, y: max.y, z: cz } }, this.depth - 1),
            new BarnesHutNode({ min: { x: min.x, y: min.y, z: cz }, max: { x: cx, y: cy, z: max.z } }, this.depth - 1),
            new BarnesHutNode({ min: { x: cx, y: min.y, z: cz }, max: { x: max.x, y: cy, z: max.z } }, this.depth - 1),
            new BarnesHutNode({ min: { x: min.x, y: cy, z: cz }, max: { x: cx, y: max.y, z: max.z } }, this.depth - 1),
            new BarnesHutNode({ min: { x: cx, y: cy, z: cz }, max: { x: max.x, y: max.y, z: max.z } }, this.depth - 1),
        ];
    }

    updateCenterOfMass(id, pos, mass) {
        this.mass += mass;
        this.centerOfMass.x = (this.centerOfMass.x * (this.mass - mass) + pos.x * mass) / this.mass;
        this.centerOfMass.y = (this.centerOfMass.y * (this.mass - mass) + pos.y * mass) / this.mass;
        this.centerOfMass.z = (this.centerOfMass.z * (this.mass - mass) + pos.z * mass) / this.mass;
    }

    calculateForce(pos, theta = 0.5) {
        if (this.node !== null) {
            // Feuille : calculer la force avec le nœud
            const dx = this.centerOfMass.x - pos.x;
            const dy = this.centerOfMass.y - pos.y;
            const dz = this.centerOfMass.z - pos.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (distance === 0) return { fx: 0, fy: 0, fz: 0 };
            const force = this.mass / (distance * distance + 1);
            return {
                fx: (dx / distance) * force,
                fy: (dy / distance) * force,
                fz: (dz / distance) * force,
            };
        } else {
            // Cellule interne : approximer si suffisamment loin
            const dx = this.centerOfMass.x - pos.x;
            const dy = this.centerOfMass.y - pos.y;
            const dz = this.centerOfMass.z - pos.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const size = Math.max(
                this.bounds.max.x - this.bounds.min.x,
                this.bounds.max.y - this.bounds.min.y,
                this.bounds.max.z - this.bounds.min.z
            );
            if (size / distance < theta) {
                // Approximer la force pour cette cellule
                const force = this.mass / (distance * distance + 1);
                return {
                    fx: (dx / distance) * force,
                    fy: (dy / distance) * force,
                    fz: (dz / distance) * force,
                };
            } else {
                // Sinon, calculer récursivement pour les enfants
                let fx = 0, fy = 0, fz = 0;
                for (const child of this.children) {
                    const { fx: cfx, fy: cfy, fz: cfz } = child.calculateForce(pos, theta);
                    fx += cfx;
                    fy += cfy;
                    fz += cfz;
                }
                return { fx, fy, fz };
            }
        }
    }
}
class Bounds {
    constructor(min, max) {
        this.min = min;
        this.max = max;
        this.center = {
            x: (min.x + max.x) / 2,
            y: (min.y + max.y) / 2,
            z: (min.z + max.z) / 2,
        };
    }

    contains(pos) {
        return (
            pos.x >= this.min.x && pos.x <= this.max.x &&
            pos.y >= this.min.y && pos.y <= this.max.y &&
            pos.z >= this.min.z && pos.z <= this.max.z
        );
    }
}

export class NetworkRenderer {
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
		connectingPeerNeighbour: 0xc1e6c1,
		knownPeer: 0x7d7d7d,
		publicNode: 0xffffff,
		publicNodeBorder: 0xffffff,
		connectedPublicNode: 0x4CAF50,

		connection: 0x666666, // gray
		currentPeerConnection: 0x4CAF50, // green
		traveledConnection: [
			0x2803fc, // blue
			0x0328fc, // light blue
			0x035afc // lighter blue
		],
		toTravelConnection: 0x03b5fc, // even lighter blue for the remaining distance
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
	nodes = {};
	connections = {};
	ignoredConnectionsRepaint = {};
	nodeObjects = new Map();
	connectionObjects = new Map();
	positions = new Map();
	velocities = new Map();
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
			if (this.hoveredNodeId) {
				this.#updateNodeColor(this.hoveredNodeId);
				this.hoveredNodeId = null;
			}
			this.renderer.domElement.style.cursor = 'default';
			this.#hideTooltip();
		});

		if (this.isAnimating) return;
        this.isAnimating = true;
        this.#animate();
    }

    // Public API methods
    addOrUpdateNode(id, status = 'known', isPublic = false, isChosen = false, neighbours = []) {

		const addMeshBorder = (nodeMesh) => {
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
            nodeMesh.userData.border = borderMesh;
		}

        if (!this.nodes[id]) { // Create new node
			this.nodes[id] = { status, isPublic, isChosen, neighbours };
			this.velocities.set(id, { x: 0, y: 0, z: 0 });
			this.positions.set(id, { // Random position
				x: (Math.random() - 0.5) * 500,
				y: (Math.random() - 0.5) * 500,
				z: (Math.random() - 0.5) * 500
			});

			// Create visual representation
			const geometry = new THREE.SphereGeometry(this.options.nodeRadius, 8, 6);
			const material = new THREE.MeshBasicMaterial({ color: this.#getNodeColor(id) });
			const nodeMesh = new THREE.Mesh(geometry, material);
			const pos = this.positions.get(id);
			nodeMesh.position.set(pos.x, pos.y, pos.z);
			nodeMesh.userData = { id, type: 'node' };
			
			this.scene.add(nodeMesh);
			this.nodeObjects.set(id, nodeMesh);
			if (isPublic || isChosen) addMeshBorder(nodeMesh);
        } else { // Update existing node
			const nodeMesh = this.nodeObjects.get(id); // update color on status change
			nodeMesh.material.color.setHex(this.#getNodeColor(id));

			let needBorderUpdate = this.nodes[id].isPublic !== isPublic || this.nodes[id].isChosen !== isChosen;
			this.nodes[id] = { status, isPublic, isChosen, neighbours };
			if (needBorderUpdate)
				if (!this.nodes[id].isPublic && !this.nodes[id].isChosen) {
					if (nodeMesh.userData.border) {
						this.scene.remove(nodeMesh.userData.border);
						delete nodeMesh.userData.border;
					}
				} else addMeshBorder(nodeMesh);
        }
    }
    removeNode(id) {
        if (!this.nodes[id]) return;

        // Remove from data structures
		const nodeObj = this.nodeObjects.get(id);
		if (nodeObj) {
			if (nodeObj.userData.border) {
				this.scene.remove(nodeObj.userData.border);
				nodeObj.userData.border.geometry.dispose();
				nodeObj.userData.border.material.dispose();
			}
			this.scene.remove(nodeObj);
			nodeObj.geometry.dispose();
			nodeObj.material.dispose();
			this.nodeObjects.delete(id);
		}
		delete this.nodes[id];
		this.positions.delete(id);
		this.velocities.delete(id);
    }
	digestConnectionsArray(conns = []) {
		const existingConns = {};
		for (const [fromId, toId] of conns) { // add new connections
			const connStr = `${fromId}:${toId}`;
       		const connStrRev = `${toId}:${fromId}`;
			existingConns[connStr] = true; // store for control
			existingConns[connStrRev] = true; // store for control
        	if (this.connections[connStr] || this.connections[connStrRev]) continue;
			this.#addConnection(fromId, toId);
		}

		const connectionsKeys = Object.keys(this.connections);
		for (const connStr of connectionsKeys) // remove connections that are not in the array
			if (!existingConns[connStr])
				this.#removeConnection(connStr);
	}
	displayMessageRoute(relayerId, route = [], frameToIgnore = 30) {
		const maxTraveledColorIndex = this.colors.traveledConnection.length - 1;
		let traveledIndex = 0;
		let isRelayerIdPassed = false;
		for (let i = 1; i < route.length; i++) {
			const connStr = `${route[i - 1]}:${route[i]}`;
			this.ignoredConnectionsRepaint[connStr] = frameToIgnore;
			const color = isRelayerIdPassed ? this.colors.toTravelConnection : this.colors.traveledConnection[traveledIndex];
			this.#updateConnectionColor(route[i - 1], route[i], color, .5);
			traveledIndex = Math.min(traveledIndex + 1, maxTraveledColorIndex);
			if (route[i - 1] === relayerId) isRelayerIdPassed = true;
		}
	}
	// THIS IS A VERY FIRST IMPLEMENTATION, NEEDS REFINEMENT
	displayGossipMessage(relayerId, senderId, topic = 'peer_connected', data, frameToIgnore = 10) {
		this.ignoredConnectionsRepaint[`${relayerId}:${senderId}`] = frameToIgnore;
		this.ignoredConnectionsRepaint[`${this.currentPeerId}:${relayerId}`] = frameToIgnore + 5;

		this.#updateConnectionColor(relayerId, senderId, this.colors.gossipOutgoingColor, .33); // sender to relayer
		this.#updateConnectionColor(relayerId, this.currentPeerId, this.colors.gossipIncomingColor, .5); // relayer to current
	}
    setCurrentPeer(peerId, clearNetworkOneChange = true) {
		if (clearNetworkOneChange && peerId !== this.currentPeerId) this.clearNetwork();

        // Reset previous current peer
        if (this.currentPeerId && this.nodes[this.currentPeerId]) {
            this.nodes[this.currentPeerId].status = 'known';
            this.#updateNodeColor(this.currentPeerId);
        }

        if (peerId && this.nodes[peerId]) {
            this.nodes[peerId].status = 'current';
            this.#updateNodeColor(peerId);
        }

		this.currentPeerId = peerId;
    }
    updateNodeStatus(nodeId, status) {
        if (!this.nodes[nodeId]) return;
        this.nodes[nodeId].status = status;
        this.#updateNodeColor(nodeId);
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
        this.connections = {};
        this.positions.clear();
        this.velocities.clear();
        this.currentPeerId = null;
        this.hoveredNodeId = null;

        // Clear visual objects
        for (const [id, nodeObj] of this.nodeObjects) if (nodeObj.userData.border) this.scene.remove(nodeObj.userData.border);
		for (const [id, nodeObj] of this.nodeObjects) this.scene.remove(nodeObj);
        for (const [id, connObj] of this.connectionObjects) this.scene.remove(connObj);
        
        this.nodeObjects.clear();
        this.connectionObjects.clear();
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
        for (const intersect of intersects)
            if (intersect.object.userData.type === 'node') { foundNode = intersect.object.userData.id; break; }

        if (foundNode === this.hoveredNodeId) return;
		if (this.hoveredNodeId && this.nodeObjects.has(this.hoveredNodeId)) this.#updateNodeColor(this.hoveredNodeId);

		this.hoveredNodeId = foundNode;

		if (!this.hoveredNodeId) {
			this.renderer.domElement.style.cursor = 'default';
			this.#hideTooltip();
		} else {
			const nodeObj = this.nodeObjects.get(this.hoveredNodeId);
			if (nodeObj) {
				nodeObj.material.color.setHex(this.colors.hoveredPeer);
				this.#showTooltip(event.clientX, event.clientY, this.hoveredNodeId);
				this.renderer.domElement.style.cursor = 'pointer';
			}
		}
    }
	#showTooltip(x, y, nodeId, element = document.getElementById('tooltip')) {
		const node = this.nodes[nodeId];
		if (!node) return;

		const json = {
			Peer: nodeId,
			Type: node.status,
			Neighbours: node.neighbours.length > 0 ? node.neighbours.slice(0, 5) : 'None',
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
	#addConnection(fromId = 'peer_1', toId = 'peer_2') {
        if (!this.nodes[fromId] || !this.nodes[toId]) return;
		const connStr = `${fromId}:${toId}`;
        this.connections[connStr] = true;

        // Create visual line
		const fromPos = this.positions.get(fromId);
		const toPos = this.positions.get(toId);
        if (fromPos && toPos) {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array([
                fromPos.x, fromPos.y, fromPos.z,
                toPos.x, toPos.y, toPos.z
            ]);
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            
            const material = new THREE.LineBasicMaterial({
				color: this.colors.connection,
				transparent: true,
                opacity: .1,
			});
            const line = new THREE.Line(geometry, material);
            line.userData = { fromId, toId, type: 'connection' };
            
            this.scene.add(line);
            this.connectionObjects.set(connStr, line);
        }
    }
    #removeConnection(connStr = 'id1:id2') {
        if (!this.connections[connStr]) return;

        const [fromId, toId] = connStr.split(':');
        
        // Remove from data
        delete this.connections[connStr];
        
        // Update neighbours
        if (this.nodes[fromId]) {
            const index = this.nodes[fromId].neighbours.indexOf(toId);
            if (index > -1) this.nodes[fromId].neighbours.splice(index, 1);
        }
        if (this.nodes[toId]) {
            const index = this.nodes[toId].neighbours.indexOf(fromId);
            if (index > -1) this.nodes[toId].neighbours.splice(index, 1);
        }

        // Remove visual
        const connObj = this.connectionObjects.get(connStr);
        if (connObj) {
            this.scene.remove(connObj);
            this.connectionObjects.delete(connStr);
        }
    }
    #getNodeColor(peerId) {
		const { status, isPublic } = this.nodes[peerId];
        switch (status) {
            case 'current': return this.colors.currentPeer;
            case 'connected': return isPublic ? this.colors.connectedPublicNode : this.colors.connectedPeerNeighbour;
            case 'connecting': return this.colors.connectingPeerNeighbour;
            default: return isPublic ? this.colors.publicNode : this.colors.knownPeer;
        }
    }
    #updateNodeColor(nodeId) {
        const nodeMesh = this.nodeObjects.get(nodeId);
        if (nodeMesh && this.nodes[nodeId])
            nodeMesh.material.color.setHex(this.#getNodeColor(nodeId));
    }
	#updateConnectionColor(peerId1, peerId2, colorHex, opacity = 1) {
		const connStr = `${peerId1}:${peerId2}`;
		const revConnStr = `${peerId2}:${peerId1}`;
		const connMesh1 = this.connectionObjects.get(connStr)
		const connMesh2 = this.connectionObjects.get(revConnStr);
		if (!connMesh1 && !connMesh2) return;
		if (connMesh1) { connMesh1.material.color.setHex(colorHex); connMesh1.material.opacity = opacity; }
		if (connMesh2) { connMesh2.material.color.setHex(colorHex); connMesh2.material.opacity = opacity; }
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
	#updateNodesV2(lockCurrentNodePosition = true) {
		// Construire le Barnes-Hut Tree
		const min = { x: -Infinity, y: -Infinity, z: -Infinity };
		const max = { x: Infinity, y: Infinity, z: Infinity };
		for (const [id, pos] of this.positions) {
			min.x = Math.min(min.x, pos.x);
			min.y = Math.min(min.y, pos.y);
			min.z = Math.min(min.z, pos.z);
			max.x = Math.max(max.x, pos.x);
			max.y = Math.max(max.y, pos.y);
			max.z = Math.max(max.z, pos.z);
		}
		// Ajouter une marge
		const margin = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) * 0.1;
		min.x -= margin; min.y -= margin; min.z -= margin;
		max.x += margin; max.y += margin; max.z += margin;
		const bounds = new Bounds(min, max);
		const root = new BarnesHutNode(bounds, 8);
		for (const [id, pos] of this.positions) {
			root.insert(id, pos, 1);
		}

		for (const [id, pos] of this.positions) {
			const vel = this.velocities.get(id);
			const node = this.nodes[id];
			if (!vel || !node) continue;

			let fx = 0, fy = 0, fz = 0;

			// Répulsion avec Barnes-Hut
			const { fx: rfx, fy: rfy, fz: rfz } = root.calculateForce(pos);
			fx += rfx;
			fy += rfy;
			fz += rfz;

			// Attraction avec les voisins
			for (const neighbourId of node.neighbours) {
				const neighbourPos = this.positions.get(neighbourId);
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

			// Force centrale
			fx += -pos.x * this.options.centerForce;
			fy += -pos.y * this.options.centerForce;
			fz += -pos.z * this.options.centerForce;

			// Mise à jour de la vélocité
			vel.x = (vel.x + fx) * this.options.damping;
			vel.y = (vel.y + fy) * this.options.damping;
			vel.z = (vel.z + fz) * this.options.damping;

			// Limite de vélocité
			const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
			if (speed > this.options.maxVelocity) {
				const ratio = this.options.maxVelocity / speed;
				vel.x *= ratio;
				vel.y *= ratio;
				vel.z *= ratio;
			}

			// Mise à jour de la position
			pos.x += vel.x;
			pos.y += vel.y;
			pos.z += vel.z;
			//if (this.currentPeerId === id && lockCurrentNodePosition) for (const key of ['x', 'y', 'z']) pos[key] = 0;

			// Mise à jour visuelle
			const nodeObj = this.nodeObjects.get(id);
			if (nodeObj) {
				nodeObj.position.set(pos.x, pos.y, this.options.mode === '3d' ? pos.z : 0);
				if (nodeObj.userData.border) {
					nodeObj.userData.border.position.copy(nodeObj.position);
					nodeObj.userData.border.lookAt(this.camera.position);
				}
			}
		}
	}
	#updateNodesV1(lockCurrentNodePosition = true) {
		// Initialiser le grid
		const grid = new SpatialGrid();
		for (const [id, pos] of this.positions) grid.addNode(id, pos.x, pos.y, pos.z);

		for (const [id, pos] of this.positions) {
			const vel = this.velocities.get(id);
			const node = this.nodes[id];
			if (!vel || !node) continue;

			let fx = 0, fy = 0, fz = 0;

			// Répulsion avec les nœuds proches (grid)
			const nearbyIds = grid.getNearbyNodes(pos.x, pos.y, pos.z);
			for (const otherId of nearbyIds) {
				if (id === otherId) continue;
				const otherPos = this.positions.get(otherId);
				if (!otherPos) continue;
				const dx = pos.x - otherPos.x;
				const dy = pos.y - otherPos.y;
				const dz = pos.z - otherPos.z;
				const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (distance > this.options.repulsionOpts.maxDistance) continue;
				const force = this.options.repulsion / (distance * distance + 1);
				fx += (dx / distance) * force;
				fy += (dy / distance) * force;
				fz += (dz / distance) * force;
			}

			// Attraction avec les voisins
			for (const neighbourId of node.neighbours) {
				const neighbourPos = this.positions.get(neighbourId);
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

			// Force centrale
			fx += -pos.x * this.options.centerForce;
			fy += -pos.y * this.options.centerForce;
			fz += -pos.z * this.options.centerForce;

			// Mise à jour de la vélocité
			vel.x = (vel.x + fx) * this.options.damping;
			vel.y = (vel.y + fy) * this.options.damping;
			vel.z = (vel.z + fz) * this.options.damping;

			// Limite de vélocité
			const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
			if (speed > this.options.maxVelocity) {
				const ratio = this.options.maxVelocity / speed;
				vel.x *= ratio;
				vel.y *= ratio;
				vel.z *= ratio;
			}

			// Mise à jour de la position
			pos.x += vel.x;
			pos.y += vel.y;
			pos.z += vel.z;
			if (this.currentPeerId === id && lockCurrentNodePosition) for (const key of ['x', 'y', 'z']) pos[key] = 0;

			// Mise à jour visuelle
			const nodeObj = this.nodeObjects.get(id);
			if (!nodeObj) return;
			nodeObj.position.set(pos.x, pos.y, this.options.mode === '3d' ? pos.z : 0);

			if (!nodeObj.userData.border) return;
			nodeObj.userData.border.position.copy(nodeObj.position);
			nodeObj.userData.border.lookAt(this.camera.position);
		}
	}
	#updateNodes(nodeIds = [], lockCurrentNodePosition = true, simplyCalculation = true) {
		const getReducedBatch = () => {
			const includedIds = {};
			const batchSize = Math.floor(Math.min(nodeIds.length / 10, this.updateBatchMax));
			let includedCount = 0;
			while (includedCount < batchSize) {
				const id = nodeIds[Math.floor(Math.random() * nodeIds.length)];
				if (includedIds[id]) continue;
				includedIds[id] = true;
				includedCount++;
			}
			return Object.keys(includedIds);
		}

		const batchIds = simplyCalculation ? getReducedBatch() : nodeIds;
		for (const id of batchIds) {
            const pos = this.positions.get(id);
            const vel = this.velocities.get(id);
            const node = this.nodes[id];
			const nodeObj = this.nodeObjects.get(id);
            if (!pos || !vel || !node || !nodeObj) continue;

            let fx = 0, fy = 0, fz = 0;

            // Repulsion between nodes
            for (const otherId of [...batchIds, ...node.neighbours]) {
                if (id === otherId) continue;
                
                const otherPos = this.positions.get(otherId);
                const otherNode = this.nodes[otherId];
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

            // Attraction along connections
            for (const neighbourId of node.neighbours) {
                const neighbourPos = this.positions.get(neighbourId);
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
			nodeObj.position.set(pos.x, pos.y, this.options.mode === '3d' ? pos.z : 0);

			// Update border position
			if (!nodeObj.userData.border) continue;
			nodeObj.userData.border.position.copy(nodeObj.position);
			nodeObj.userData.border.lookAt(this.camera.position);
        }
	}
    #updateConnections() {
        for (const [connStr, line] of this.connectionObjects) {
            const [fromId, toId] = connStr.split(':');
            const fromPos = this.positions.get(fromId);
            const toPos = this.positions.get(toId);
            
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
				line.material.opacity = color === this.colors.connection ? .1 : .33;
            }
        }
    }
    #animate() {
        if (!this.isAnimating) return;
        
		this.#autoRotate();
        this.#updateNodes(Object.keys(this.nodes));
        this.#updateConnections();

        // Update FPS
        this.frameCount++;
        const currentTime = Date.now();
        if (currentTime - this.lastTime >= 1000) {
            const fps = Math.round(this.frameCount * 1000 / (currentTime - this.lastTime));
			this.elements.fpsCountElement.textContent = fps;
            this.frameCount = 0;
            this.lastTime = currentTime;
        }

        this.renderer.render(this.scene, this.camera);
		requestAnimationFrame(() => this.#animate());
    }
    updateStats(neighborsCount = 0) {
	   this.elements.nodeCountElement.textContent = Object.keys(this.nodes).length;
	   this.elements.connectionCountElement.textContent = Object.keys(this.connections).length;
	   this.elements.neighborCountElement.textContent = neighborsCount;
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = NetworkRenderer;
else window.NetworkRenderer = NetworkRenderer;