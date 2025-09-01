export class Node {
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
	store = {};
	hovered = {};
	repaintIgnored = {}; // frame number
	nodesStore;
	scene;

	/** @param {NodesStore} nodesStore */
	constructor(nodesStore, scene) {
		this.nodesStore = nodesStore;
		this.scene = scene;
	}

	#getBothKeys(fromId = 'toto', toId = 'tutu') {
		return [`${fromId}:${toId}`, `${toId}:${fromId}`];
	}
	set(fromId = 'toto', toId = 'tutu') {
		const [ key1, key2 ] = this.#getBothKeys(fromId, toId);
		if (this.store[key1] || this.store[key2]) return { success: false, key1, key2 }; // already set
		this.store[key1] = true;
		this.store[key2] = true;
		return { success: true, key1, key2 };
	}
	unset(fromId = 'toto', toId = 'tutu') {
		const [ key1, key2 ] = this.#getBothKeys(fromId, toId);
		if (!this.store[key1] && !this.store[key2]) return { success: false, key1, key2 };
		this.#disposeLineObject(this.store[key1]);
		this.#disposeLineObject(this.store[key2]);
		this.nodesStore.get(fromId)?.removeNeighbour(toId);
		this.nodesStore.get(toId)?.removeNeighbour(fromId);
		delete this.store[key1];
		delete this.store[key2];
		return { success: true, key1, key2 };
	}

	// VISUAL LINE
	assignLine(fromId = 'peer_1', toId = 'peer_2', color = 0x666666, opacity = .4) {
		const [ key1, key2 ] = this.#getBothKeys(fromId, toId);
		// skip missing connections or already assigned line
		if (this.store[key1] !== true || this.store[key2] !== true)
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
		this.store[key1] = line;
		this.store[key2] = line;
		return 'created';
	}
	#updateMeshColor(mesh, colorHex, opacity) {
		mesh.material.color.setHex(colorHex);
		mesh.material.opacity = opacity;
		mesh.material.needsUpdate = true;
	}
	updateLineColor(fromId, toId, colorHex, opacity = .4) {
		const [ key1, key2 ] = this.#getBothKeys(fromId, toId);
		const mesh1 = this.store[key1];
		const mesh2 = this.store[key2];
		if (!mesh1 && !mesh2) return false;
		if (mesh1 !== true) this.#updateMeshColor(mesh1, colorHex, opacity);
		if (mesh2 !== true) this.#updateMeshColor(mesh2, colorHex, opacity);
		return 'updated';
	}
	#disposeLineObject(line) {
		if (!line || line === true) return;
		this.scene.remove(line);
		line.geometry.dispose();
		line.material.dispose();
	}
	unassignLine(fromId = 'toto', toId = 'tutu') {
		const [ key1, key2 ] = this.#getBothKeys(fromId, toId);
		if (!this.store[key1] && !this.store[key2]) return;
		this.#disposeLineObject(this.store[key1]);
		this.#disposeLineObject(this.store[key2]);
		delete this.store[key1];
		delete this.store[key2];
	}
	setHovered(fromId = 'toto', toId = 'tutu') {
		const [ key1, key2 ] = this.#getBothKeys(fromId, toId);
		if (!this.store[key1] && !this.store[key2]) return;
		this.assignLine(fromId, toId);
		this.hovered[key1] = true;
		this.hovered[key2] = true;
	}
	resetHovered() {
		const hoveredKeys = Object.keys(this.hovered);
		for (const key of hoveredKeys) {
			this.unassignLine(...key.split(':'));
			delete this.hovered[key];
		}
	}
	ignoreRepaint(fromId = 'toto', toId = 'tutu', frame = 5) {
		const [ key1, key2 ] = this.#getBothKeys(fromId, toId);
		if (!this.store[key1] && !this.store[key2]) return;
		this.repaintIgnored[key1] = frame * 2;
		this.repaintIgnored[key2] = frame * 2;
	}
	#countIgnoredRepaint(key1, key2) {
		const [ val1, val2 ] = [ this.repaintIgnored[key1], this.repaintIgnored[key2] ];
		if (val1 === undefined || val2 === undefined) return;
		if (val1 <= 0 || val2 <= 0) {
			delete this.repaintIgnored[key1];
			delete this.repaintIgnored[key2];
		} else {
			this.repaintIgnored[key1]--;
			this.repaintIgnored[key2]--;
		}
	}
	#repaintIsToIgnore(key1, key2) {
		return this.repaintIgnored[key1] > 0 || this.repaintIgnored[key2] > 0;
	}
	updateConnections(currentPeerId, hoveredNodeId, colors, mode = '3d') {
		for (const [connStr, line] of Object.entries(this.store)) {
			if (line === true) continue; // not assigned (physic only)

			const [fromId, toId] = connStr.split(':');
			const fromPos = this.nodesStore.get(fromId)?.position;
			const toPos = this.nodesStore.get(toId)?.position;
			if (!fromPos || !toPos || !line.geometry) continue; // skip if missing position or disposed line

			const positionAttribute = line.geometry.attributes.position;
			positionAttribute.array[0] = fromPos.x;
			positionAttribute.array[1] = fromPos.y;
			positionAttribute.array[2] = mode === '3d' ? fromPos.z : 0;
			positionAttribute.array[3] = toPos.x;
			positionAttribute.array[4] = toPos.y;
			positionAttribute.array[5] = mode === '3d' ? toPos.z : 0;
			positionAttribute.needsUpdate = true;

			const [ key1, key2 ] = this.#getBothKeys(fromId, toId);
			this.#countIgnoredRepaint(key1, key2);
			if (this.#repaintIsToIgnore(key1, key2)) continue;

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
	getConnectionsList() {
		return Object.keys(this.store);
	}
	getConnectionsCount() {
		const result = { connsCount: 0, linesCount: 0 };
		for (const line of Object.values(this.store)) {
			result.connsCount++;
			if (line !== true) result.linesCount++;
		}
		result.connsCount /= 2;
		result.linesCount /= 2;
		return result;
	}
	destroy() {
		for (const line of Object.values(this.store)) this.#disposeLineObject(line);
	}
}