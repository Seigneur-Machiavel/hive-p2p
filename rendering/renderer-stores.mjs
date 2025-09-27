export class Node {
	id;
	status;
	isPublic;
	neighbors;
	velocity = { x: 0, y: 0, z: 0 };
	position = {
		x: (Math.random() - 0.5) * 500,
		y: (Math.random() - 0.5) * 500,
		z: (Math.random() - 0.5) * 500
	};

	/** Constructor for a Node
	 * @param {string} id @param {'unknown' | 'known' | 'connecting' | 'connected' | 'current'} status
	 * @param {boolean} isPublic @param {Array<string>} neighbors */
	constructor(id, status, isPublic, neighbors) {
		this.id = id;
		this.status = status;
		this.isPublic = isPublic;
		this.neighbors = neighbors;
	}
	addNeighbor(peerId) {
		if (!this.neighbors.includes(peerId)) this.neighbors.push(peerId);
	}
	removeNeighbor(peerId) {
		this.neighbors = this.neighbors.filter(id => id !== peerId);
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
	getInfo() {
		const result = {
			total: 0,
			totalPublic: 0,
			connectedPublic: 0,
			connected: 0,
			connecting: 0,
			known: 0,
			unknown: 0,
			maxDistance: 0, // max node distance from center x or y, used for auto zoom
		};
		for (const node of Object.values(this.store)) {
			result.total++;
			result.maxDistance = Math.max(result.maxDistance, Math.abs(node.position.x), Math.abs(node.position.y));
			if (node.isPublic) result.totalPublic++;
			if (node.status === 'connected' && node.isPublic) result.connectedPublic++;
			if (node.status === 'connected') result.connected++;
			else if (node.status === 'connecting') result.connecting++;
			else if (node.status === 'known') result.known++;
			else if (node.status === 'unknown') result.unknown++;
		}
		return result;
	}
}

const lineMaterials = {};
class PeerLineConnection {
	/** @type {THREE.Line} */ line;
	/** @type {number} in frames */ repaintIgnored = 0;
	/** @type {boolean} */ isHovered = false;

	#updateLineColor(colorHex = 0x666666, opacity = .4, dashed = false) {
		if (!this.line || this.line === true) return false; // not assigned (physic only)
		this.line.material = this.#getLineMaterial(colorHex, opacity, dashed);
		if (dashed) this.line.computeLineDistances();
		return 'updated';
	}
	#getLineMaterial(colorHex, opacity, dashed) {
		const matKey = `${colorHex.toString(16)}_${opacity}_${dashed}`;
		if (lineMaterials[matKey]) return lineMaterials[matKey];
		const material = dashed
			? new THREE.LineDashedMaterial({ color: colorHex, transparent: true, opacity, dashSize: 12, gapSize: 20 })
			: new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity });
		lineMaterials[matKey] = material;
		return material;
	}
	disposeLine(scene) {
		if (!this.line || this.line === true) return;
		scene.remove(this.line);
		this.line.geometry.dispose();
		this.line.material.dispose();
		this.isHovered = false;
		this.repaintIgnored = 0;
	}
	countIgnoredRepaint() {
		if (this.repaintIgnored-- > 0) return true;
		this.repaintIgnored = 0;
		return false;
	}
	assignOrUpdateLineColor(scene, fromPos = {}, toPos = {}, color = 0x666666, opacity = .4, dashed = false) {
		if (this.line) return this.#updateLineColor(color, opacity, dashed);
		if (!fromPos || !toPos) return false; // skip if missing position

		const geometry = new THREE.BufferGeometry();
		const p = new Float32Array([fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z]);
		geometry.setAttribute('position', new THREE.BufferAttribute(p, 3));
		
		const material = this.#getLineMaterial(color, opacity, dashed);
		const line = new THREE.Line(geometry, material);
		scene.add(line);
		this.line = line;
		return 'created';
	}
}

export class ConnectionsStore {
	/** @type {Record<string, PeerLineConnection>} */ store = {};
	nodesStore;
	scene;
	updateBatchMax = 500;
	peerConnsWithLines = {};

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
		this.store[key1] = new PeerLineConnection();
		return { success: true, key: key1, peerConn: this.store[key1] };
	}
	unset(fromId = 'toto', toId = 'tutu', force = false) {
		const { key1, key2, validKey } = this.#getKeys(fromId, toId);
		if (!validKey) return;

		const peerConn = this.store[validKey];
		if (peerConn.repaintIgnored && !force) return; // still ignored

		delete this.peerConnsWithLines[validKey];
		delete this.store[validKey];
		peerConn.disposeLine(this.scene);

		// unlink from nodes <> neighbors
		this.nodesStore.get(fromId)?.removeNeighbor(toId);
		this.nodesStore.get(toId)?.removeNeighbor(fromId);
	}

	// VISUAL LINE
	unassignLine(fromId = 'peer_1', toId = 'peer_2') {
		const { key1, key2, validKey } = this.#getKeys(fromId, toId);
		if (!validKey) return;
		this.store[validKey]?.disposeLine(this.scene);
		delete this.peerConnsWithLines[validKey];
	}
	setHovered(fromId = 'toto', toId = 'tutu') {
		const { key1, key2, validKey } = this.#getKeys(fromId, toId);
		if (!validKey) return;

		const [ fromPos, toPos ] = [ this.nodesStore.get(fromId)?.position, this.nodesStore.get(toId)?.position ];
		const result = this.store[validKey].assignOrUpdateLineColor(this.scene, fromPos, toPos);
		if (result === false) return;

		this.peerConnsWithLines[validKey] = this.store[validKey];
		this.store[validKey].isHovered = true;
		if (result !== 'updated') return;
		this.store[validKey].line.userData = { fromId, toId, type: 'connection' };
	}
	resetHovered() {
		for (const key in this.store)
			if (this.store[key].isHovered) this.unset(...key.split(':'), true);
	}
	updateOrAssignLineColor(fromId = 'toto', toId = 'tutu', color = 0x666666, opacity = .4, ignoreRepaintFrames, dashed = false) {
		const { key1, key2, validKey } = this.#getKeys(fromId, toId);
		const peerConn = validKey ? this.store[validKey] : null;
		if (!peerConn) return false;

		// assign line  HERE HERE HERE
		const [ fromPos, toPos ] = [ this.nodesStore.get(fromId)?.position, this.nodesStore.get(toId)?.position ];
		const result = peerConn.assignOrUpdateLineColor(this.scene, fromPos, toPos, color, opacity, dashed);
		if (result === 'created') peerConn.line.userData = { fromId, toId, type: 'connection' };
		if (result && ignoreRepaintFrames) peerConn.repaintIgnored = ignoreRepaintFrames;
		if (result) this.peerConnsWithLines[validKey] = peerConn;
		return result;
	}

	updateConnections(currentPeerId, hoveredNodeId, colors, mode = '3d') { // positions & colors
		for (const connStr in this.peerConnsWithLines) {
			const peerConn = this.peerConnsWithLines[connStr];
			if (!peerConn) continue;
			const [fromId, toId] = connStr.split(':');
			const fromPos = this.nodesStore.get(fromId)?.position;
			const toPos = this.nodesStore.get(toId)?.position;
			if (!fromPos || !toPos) continue; // skip if missing position

			const positionAttribute = peerConn.line.geometry.attributes.position;
			positionAttribute.array[0] = fromPos.x;
			positionAttribute.array[1] = fromPos.y;
			positionAttribute.array[2] = mode === '3d' ? fromPos.z : 0;
			positionAttribute.array[3] = toPos.x;
			positionAttribute.array[4] = toPos.y;
			positionAttribute.array[5] = mode === '3d' ? toPos.z : 0;
			positionAttribute.needsUpdate = true;

			if (this.store[connStr].countIgnoredRepaint()) {
				if (peerConn.line.material.isDashedLineMaterial) peerConn.line.computeLineDistances();
				continue;
			}

			// Update connection color
			const { connection, currentPeerConnection, hoveredPeer } = colors;
			const isCurrentPeer = fromId === currentPeerId || toId === currentPeerId;
			const isHoveredPeer = fromId === hoveredNodeId || toId === hoveredNodeId;
			const color = isCurrentPeer ? currentPeerConnection : isHoveredPeer ? hoveredPeer : connection;
			const opacity = color === connection ? .33 : .5;
			const result = peerConn.assignOrUpdateLineColor(this.scene, fromPos, toPos, color, opacity);
			if (peerConn.line.material.isDashedLineMaterial) peerConn.line.computeLineDistances();
			if (result) this.peerConnsWithLines[connStr] = peerConn;
		}
	}
	getConnectionsCount() {
		const result = { connsCount: Object.keys(this.store).length, linesCount: 0 };
		for (const peerConn of Object.values(this.store)) if (peerConn.line) result.linesCount++;
		return result;
	}
	destroy() {
		for (const key of Object.keys(this.store)) this.unset(...key.split(':'), true);
	}
}