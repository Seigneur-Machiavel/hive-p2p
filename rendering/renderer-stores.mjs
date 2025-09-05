export class Node {
	id;
	status;
	isPublic;
	neighbours;
	velocity = { x: 0, y: 0, z: 0 };
	position = {
		x: (Math.random() - 0.5) * 500,
		y: (Math.random() - 0.5) * 500,
		z: (Math.random() - 0.5) * 500
	};

	/** Constructor for a Node
	 * @param {string} id @param {'unknown' | 'known' | 'connecting' | 'connected' | 'current'} status
	 * @param {boolean} isPublic @param {Array<string>} neighbours */
	constructor(id, status, isPublic, neighbours) {
		this.id = id;
		this.status = status;
		this.isPublic = isPublic;
		this.neighbours = neighbours;
	}
	addNeighbour(peerId) {
		if (!this.neighbours.includes(peerId)) this.neighbours.push(peerId);
	}
	removeNeighbour(peerId) {
		this.neighbours = this.neighbours.filter(id => id !== peerId);
	}
}
export class NodesStore {
	/** @type {Record<string, Node>} */ store = {};

	/** @param {Node} node */
	add(node) { this.store[node.id] = node; }
	get(id = 'toto') { return this.store[id]; }
	has(id = 'toto') { return !!this.store[id]; }
	remove(id = 'toto') { delete this.store[id]; }
	getNodesIds() { return Object.keys(this.store); }
}
export class ConnectionsStore {
	/** @type {Record<string, any>} key: id1:id2, value: "true" | THREE.line */
	nodesStore;
	scene;
	/** @type {Record<string, line | any>} */ store = {};
	/** @type {Record<string, boolean>} */ hovered = {};
	/** @type {Record<string, number>} */ repaintIgnored = {}; // frame number

	/** @param {NodesStore} nodesStore */
	constructor(nodesStore, scene) {
		this.nodesStore = nodesStore;
		this.scene = scene;
	}

	#getKeys(fromId = 'toto', toId = 'tutu') {
		const key1 = `${fromId}:${toId}`;
		const key2 = `${toId}:${fromId}`;
		const validKey = this.store[key1] ? key1 : this.store[key2] ? key2 : null;
		return { key1, key2, validKey };
	}
	set(fromId = 'toto', toId = 'tutu') {
		const { key1, key2, validKey } = this.#getKeys(fromId, toId);
		if (validKey) return { success: false, key: validKey }; // already set
		this.store[key1] = true;
		return { success: true, key: key1 };
	}
	unset(fromId = 'toto', toId = 'tutu', force = false) {
		const { key1, key2, validKey } = this.#getKeys(fromId, toId);
		if (!validKey) return;
		if (this.repaintIgnored[validKey] && !force) return; // still ignored
		this.nodesStore.get(fromId)?.removeNeighbour(toId);
		this.nodesStore.get(toId)?.removeNeighbour(fromId);
		this.#disposeLineObject(validKey);
		delete this.store[validKey];
	}

	// VISUAL LINE
	assignLine(fromId = 'peer_1', toId = 'peer_2', color = 0x666666, opacity = .4) {
		const { key1, key2, validKey } = this.#getKeys(fromId, toId);
		if (!validKey) return false; // not set yet
		if (validKey && this.store[validKey] !== true) // repaint existing line
			return this.updateLineColor(fromId, toId, color, opacity);

		const fromPos = this.nodesStore.get(fromId)?.position;
		const toPos = this.nodesStore.get(toId)?.position;
		if (!fromPos || !toPos) return false; // skip if missing position

		const geometry = new THREE.BufferGeometry();
		const p = new Float32Array([fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z]);
		geometry.setAttribute('position', new THREE.BufferAttribute(p, 3));

		const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
		const line = new THREE.Line(geometry, material);
		line.userData = { fromId, toId, type: 'connection' };
		this.scene.add(line);
		this.store[validKey] = line;
		return 'created';
	}
	unassignLine(fromId = 'peer_1', toId = 'peer_2') {
		const { key1, key2, validKey } = this.#getKeys(fromId, toId);
		if (!validKey || validKey === true) return false; // not set yet
		this.#disposeLineObject(validKey);
	}
	updateLineColor(fromId, toId, colorHex, opacity = .4) {
		const { key1, key2, validKey } = this.#getKeys(fromId, toId);
		const mesh = this.store[validKey];
		if (!mesh || mesh === true) return false; // not assigned (physic only)
		mesh.material.color.setHex(colorHex);
		mesh.material.opacity = opacity;
		mesh.material.needsUpdate = true;
		return 'updated';
	}
	#disposeLineObject(validKey) {
		const mesh = this.store[validKey];
		if (!mesh || mesh === true) return;
		this.scene.remove(mesh);
		mesh.geometry.dispose();
		mesh.material.dispose();
		delete this.hovered[validKey];
		delete this.repaintIgnored[validKey];
	}
	setHovered(fromId = 'toto', toId = 'tutu') {
		const { key1, key2, validKey } = this.#getKeys(fromId, toId);
		if (!validKey) return;
		this.assignLine(fromId, toId);
		this.hovered[validKey] = true;
	}
	resetHovered() {
		const hoveredKeys = Object.keys(this.hovered);
		for (const key of hoveredKeys) this.unset(...key.split(':'), true);
	}
	ignoreRepaint(fromId = 'toto', toId = 'tutu', frame = 5) {
		const { key1, key2, validKey } = this.#getKeys(fromId, toId);
		if (!validKey || this.store[validKey] === true) return;
		this.repaintIgnored[validKey] = frame;
	}
	#countIgnoredRepaint(validKey) {
		if (this.repaintIgnored[validKey] === undefined) return;
		if (this.repaintIgnored[validKey]-- > 0) return;
		delete this.repaintIgnored[validKey];
	}
	updateConnections(currentPeerId, hoveredNodeId, colors, mode = '3d') { // positions & colors
		for (const [connStr, line] of Object.entries(this.store)) {
			if (line === true) continue; // not assigned (physic only)

			const [fromId, toId] = connStr.split(':');
			const fromPos = this.nodesStore.get(fromId)?.position;
			const toPos = this.nodesStore.get(toId)?.position;
			if (!fromPos || !toPos || line === true) continue; // skip if missing position or disposed line
			
			const positionAttribute = line.geometry.attributes.position;
			positionAttribute.array[0] = fromPos.x;
			positionAttribute.array[1] = fromPos.y;
			positionAttribute.array[2] = mode === '3d' ? fromPos.z : 0;
			positionAttribute.array[3] = toPos.x;
			positionAttribute.array[4] = toPos.y;
			positionAttribute.array[5] = mode === '3d' ? toPos.z : 0;
			positionAttribute.needsUpdate = true;
			
			//const { key1, key2, validKey } = this.#getKeys(fromId, toId);
			this.#countIgnoredRepaint(connStr);
			if (this.repaintIgnored[connStr] && this.repaintIgnored[connStr] > 0) continue;

			// Update connection color
			const { connection, currentPeerConnection, hoveredPeer } = colors;
			let color = connection;
			const isCurrentPeer = fromId === currentPeerId || toId === currentPeerId;
			const isHoveredPeer = fromId === hoveredNodeId || toId === hoveredNodeId;
			if (isCurrentPeer) color = currentPeerConnection;
			if (isHoveredPeer) color = hoveredPeer;
			const opacity = color === connection ? .33 : .5;
			this.updateLineColor(fromId, toId, color, opacity);
		}
	}
	getConnectionsCount() {
		const result = { connsCount: 0, linesCount: 0 };
		for (const line of Object.values(this.store)) {
			result.connsCount++;
			if (line !== true) result.linesCount++;
		}
		return result;
	}
	destroy() {
		for (const key of Object.keys(this.store)) this.unset(...key.split(':'), true);
	}
}