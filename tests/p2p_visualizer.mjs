import { NetworkRenderer } from './NetworkRenderer.mjs';

class SimulationInterface {
	#subscriptionsPeerId = null;
	#connectingWs = false;
	#ws;
	currentPeerId;
	onSettings;
	onPeersIds;
	onPeerInfo;
	onPeerMessage;

	/** @param {function} onSettings @param {function} onPeersIds @param {function} onPeerInfo */
	constructor(onSettings, onPeersIds, onPeerInfo) {
		if (!onSettings || !onPeersIds || !onPeerInfo) return console.error('SimulationInterface requires three callback functions: onSettings, onPeersIds, onPeerInfo');
		this.onSettings = onSettings;
		this.onPeersIds = onPeersIds;
		this.onPeerInfo = onPeerInfo;
		this.#setupWs();
		window.addEventListener('beforeunload', () => this.#ws ? this.#ws.close() : null);
		setInterval(() => { if (this.currentPeerId) this.getPeerInfo(this.currentPeerId) }, 1000);
		setInterval(() => { this.getPeerIds() }, 5000);
	}

	#setupWs(url = 'ws://localhost:3000') {
		if (this.#ws) this.#ws.close();
		this.#connectingWs = true;
		this.#ws = new WebSocket(url);
		this.#ws.onmessage = (event) => {
			const msg = JSON.parse(event.data);
			if (msg.type === 'simulationStarted' && this.currentPeerId) this.subscribeToPeerMessages(this.currentPeerId, true);
			if (msg.type === 'settings') this.onSettings(msg.data);
			if (msg.type === 'peersIds') this.onPeersIds(msg.data);
			if (msg.type === 'peerInfo') this.onPeerInfo(msg.data);
			if (msg.type === 'peerMessage' && this.onPeerMessage) this.onPeerMessage(msg.remoteId, msg.data);
			if (msg.type === 'subscribeToPeerMessage' && msg.data.success) this.#subscriptionsPeerId = msg.data.peerId;
		};
		this.#connectingWs = false;
	}
	start(settings) {
		this.#subscriptionsPeerId = null;
		this.#sendWsMessage({ type: 'start', settings });
		setTimeout(() => this.subscribeToPeerMessages(this.currentPeerId), 2000);
	}
	getPeerInfo() {
		this.#sendWsMessage({ type: 'getPeerInfo', peerId: this.currentPeerId });
	}
	getPeerIds() {
		this.#sendWsMessage({ type: 'getPeersIds' });
	}
	subscribeToPeerMessages(peerId, force = false) {
		if (!force && this.#subscriptionsPeerId === peerId) return; // avoid re-subscribing
		this.#sendWsMessage({ type: 'subscribeToPeerMessages', peerId });
	}
	tryToConnectNode(fromId, targetId) {
		if (!fromId || !targetId) return;
		this.#sendWsMessage({ type: 'tryToConnectNode', fromId, targetId });
	}
	#sendWsMessage(msg) {
		if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(msg));
		else {
			console.error(`WebSocket is not connected. ${this.#connectingWs ? 'Trying to connect...' : ''}`);
			if (!this.#connectingWs) this.#setupWs();
		}
	}
}

class NetworkVisualizer {
	mockRunning = false;
	autoSelectCurrentPeerCategory = ['standard', 'chosen', 'public']; // 'public' | 'standard' | 'chosen' | false
	currentPeerId;
	lastPeerInfo;
	networkRenderer = new NetworkRenderer();
	simulationInterface;
	elements = {
		peersList: document.getElementById('peersList'),
		simulationSettings: document.getElementById('simulationSettings'),

		publicPeersCount: document.getElementById('publicPeersCount'),
		peersCount: document.getElementById('peersCount'),
		chosenPeerCount: document.getElementById('chosenPeerCount'),
		startMock: document.getElementById('startMock'),
		addMoreNodes: document.getElementById('addMoreNodes'),
		startSimulation: document.getElementById('startSimulation'),
	}

	constructor(isSimulation = true) {
		if (isSimulation) {
			this.elements.peersList.style.display = 'block';
			this.elements.simulationSettings.style.display = 'block';
			this.simulationInterface = new SimulationInterface(
				(settings) => { if (!this.mockRunning) this.#handleSettings(settings); }, // event: onSettings
				(peersIds) => { if (!this.mockRunning) this.#updatePeersList(peersIds); }, // event: onPeersIds
				(data) => { if (!this.mockRunning && data.peerId === this.currentPeerId) this.#updateNetworkFromPeerInfo(data.peerInfo); } // event: onPeerInfo
			);

			this.simulationInterface.onPeerMessage = (remoteId, data) => {
				//console.log(`Received message ${data} from ${remoteId}`);
				const msg = JSON.parse(data);
				if (msg.isFlexible) console.warn(`Received flexible message from ${remoteId} with route: ${msg.route}`);
				if (msg.route) this.networkRenderer.displayMessageRoute(remoteId, msg.route);
				else this.networkRenderer.displayGossipMessage(remoteId, msg.senderId, msg.topic, msg.TTL, msg.data);
			};

			this.networkRenderer.onNodeLeftClick = (nodeId) => this.simulationInterface.tryToConnectNode(this.currentPeerId,nodeId);
			this.networkRenderer.onNodeRightClick = (nodeId) => this.#setSelectedPeer(nodeId);
			this.elements.startMock.onclick = () => this.#generateMockNetwork();
			this.elements.addMoreNodes.onclick = () => this.#addMoreNodes();
			this.elements.startSimulation.onclick = () => {
				this.mockRunning = false;
				this.networkRenderer.clearNetwork();
				this.simulationInterface.start(this.#getSimulatorSettings());
			}
			//setTimeout(() => this.#generateMockNetwork(), 100);
		}

		window.networkRenderer = this.networkRenderer; // Expose for debugging
	}

	#setSelectedPeer(peerId) {
		if (!peerId) return;
		if (this.networkRenderer.currentPeerId !== peerId) this.networkRenderer.clearNetwork();
		this.networkRenderer.currentPeerId = peerId;
		for (const peerItem of document.querySelectorAll(`#peersList div[data-peer-id]`))
			if (peerItem.dataset.peerId === peerId) peerItem.classList.add('selected');
			else peerItem.classList.remove('selected');

		this.#setCurrentPeer(peerId);
	}
	#setCurrentPeer(id, clearNetworkOneChange = true) {
		if (this.currentPeerId !== id) this.simulationInterface.subscribeToPeerMessages(id);
		this.currentPeerId = id;
		this.simulationInterface.currentPeerId = id;
		this.networkRenderer.setCurrentPeer(id, clearNetworkOneChange);
	}
	#getSimulatorSettings() {
		return {
			publicPeersCount: parseInt(this.elements.publicPeersCount.value),
			peersCount: parseInt(this.elements.peersCount.value),
			chosenPeerCount: parseInt(this.elements.chosenPeerCount.value)
		};
	}
	// LIVE METHODS
	#updateNetworkFromPeerInfo(peerInfo) { // TODO : implement connections
		if (!peerInfo) return;
		this.lastPeerInfo = peerInfo;

		const newlyUpdated = {};
		const digestPeerUpdate = (id = 'toto', status = 'unknown', neighbours = [], updateStats = false) => {
			const isPublic = id.startsWith('public_');
			const isChosen = id.startsWith('chosen_');
			this.networkRenderer.addOrUpdateNode(id, status, isPublic, isChosen, neighbours, updateStats);
			newlyUpdated[id] = true;
		}

		const getNeighbours = (peerId) => {
			if (peerId === peerInfo.id) return peerInfo.store.connected;
			const knownPeer = peerInfo.store.known[peerId];
			return knownPeer ? Object.keys(knownPeer.neighbours || {}) : [];
		}
		
		const knownToIgnore = {};
		knownToIgnore[this.currentPeerId] = true;
		for (const id of peerInfo.store.connecting) knownToIgnore[id] = true;
		for (const id of peerInfo.store.connected) knownToIgnore[id] = true;
		for (const peer of Object.values(peerInfo.store.known))
			if (!knownToIgnore[peer.id]) digestPeerUpdate(peer.id, 'known', getNeighbours(peer.id));
		
		for (const id of peerInfo.store.connecting) digestPeerUpdate(id, 'connecting', getNeighbours(id));
		for (const id of peerInfo.store.connected) digestPeerUpdate(id, 'connected', getNeighbours(id));
		
		const nodes = this.networkRenderer.nodes;
		for (const id of Object.keys(nodes)) // filter absent nodes
			if (!newlyUpdated[id] && id !== this.currentPeerId) this.networkRenderer.removeNode(id);

		// ensure current peer is updated and update stats
		if (peerInfo.id === this.currentPeerId) digestPeerUpdate(peerInfo.id, 'current', peerInfo.store.connected, true);

		// Create connections
		const connections = {};
		const connectionsByPeer = {};
		for (const [id, node] of Object.entries(nodes)) connectionsByPeer[id] = node.neighbours || {};
		for (const [id, node] of Object.entries(nodes))
			for (const neighbourId of node.neighbours) {
				const conStr = `${id}:${neighbourId}`;
				const conStrRev = `${neighbourId}:${id}`;
				this.networkRenderer.addConnection(id, neighbourId);

				if (connections[conStr] !== undefined || connections[conStrRev] !== undefined) continue;
				connections[conStr] = false; // "false" means not drawn
			}

		//console.log(`Updated network map: ${Object.keys(nodes).length} nodes | ${Object.keys(connections).length} connections`);
		//this.networkRenderer.connections = connections;
	}
	// SIMULATION METHODS
	#handleSettings(settings = { publicPeersCount: 2, peersCount: 5, chosenPeerCount: 1 }) {
		if (settings.publicPeersCount) this.elements.publicPeersCount.value = settings.publicPeersCount;
		if (settings.peersCount) this.elements.peersCount.value = settings.peersCount;
		if (settings.chosenPeerCount) this.elements.chosenPeerCount.value = settings.chosenPeerCount;
		if (settings.autoStart) this.simulationInterface.getPeerIds();
	}
	#updatePeersList(peersData, element = this.elements.peersList) {
		element.innerHTML = '<h3>Peers list</h3>';

		for (const [category, peerIds] of Object.entries(peersData)) {
			for (const peerId of peerIds) {
				const peerItem = document.createElement('div');
				peerItem.dataset.peerId = peerId;
				peerItem.textContent = peerId;
				peerItem.onclick = () => {
					this.#setSelectedPeer(peerId);
					this.simulationInterface.getPeerInfo(peerId);
				};
				element.appendChild(peerItem);
			}
			if (this.currentPeerId || peerIds.length === 0) continue; // Skip if current peer is set or no peers in this category
			//if (this.autoSelectCurrentPeerCategory.includes(category)) this.#setSelectedPeer(peerIds[0]);
		}

		if (this.currentPeerId) return this.#setSelectedPeer(this.currentPeerId); // Auto-select current peer

		for (const category of this.autoSelectCurrentPeerCategory)
			for (const peerId of peersData[category] || []) return this.#setSelectedPeer(peerId);
	}
	// MOCK METHODS
	#generateMockNetwork() {
		this.mockRunning = true;
		this.networkRenderer.clearNetwork();
		this.#generateMockPeers(this.#getSimulatorSettings());
		this.#updatePeersListFromRendererNodes();
	}
	#addMoreNodes() {
		const newNodeCount = 50;
		for (let i = 0; i < newNodeCount; i++) {
			const id = `node_${Date.now()}_${i}`;
			this.networkRenderer.addOrUpdateNode(id, 'known', false, false);

			// Add some random conns
			const existingNodes = Object.keys(this.networkRenderer.nodes);
			const nodesCount = existingNodes.length;
			const connectionCount = Math.min(3, Math.floor(Math.random() * nodesCount));
			for (let j = 0; j < connectionCount; j++) {
				const targetId = existingNodes[Math.floor(Math.random() * nodesCount)];
				if (targetId !== id) this.networkRenderer.addConnection(id, targetId);
			}
		}
	}
	#generateMockPeers(settings = { publicPeersCount: 2, peersCount: 5, chosenPeerCount: 1 }) {
		const allPeers = [];

		// Generate public peers
		for (let i = 0; i < settings.publicPeersCount; i++) {
			const id = `public_${i}`;
			allPeers.push(id);
			this.networkRenderer.addOrUpdateNode(id, 'known', true, false);
		}

		// Generate standard peers
		for (let i = 0; i < settings.peersCount; i++) {
			const id = `peer_${i}`;
			allPeers.push(id);
			this.networkRenderer.addOrUpdateNode(id, i < 3 ? 'connected' : 'known', false, false);
		}

		// Generate chosen peers
		for (let i = 0; i < settings.chosenPeerCount; i++) {
			const id = `chosen_${i}`;
			allPeers.push(id);
			this.networkRenderer.addOrUpdateNode(id, 'connecting', false, true);
		}

		// Set current peer
		if (allPeers.length > 0) {
			this.networkRenderer.currentPeerId = allPeers[0];
			this.networkRenderer.nodes[this.networkRenderer.currentPeerId].status = 'current';
			this.#setCurrentPeer(this.networkRenderer.currentPeerId);
		}

		// Generate random conns
		for (let i = 0; i < allPeers.length; i++) {
			const peerId = allPeers[i];
			const connectionCount = Math.min(5, Math.floor(Math.random() * allPeers.length * 0.3));

			for (let j = 0; j < connectionCount; j++) {
				const targetPeer = allPeers[Math.floor(Math.random() * allPeers.length)];
				if (targetPeer !== peerId) this.networkRenderer.addConnection(peerId, targetPeer);
			}
		}
	}
	#updatePeersListFromRendererNodes(element = this.elements.peersList) {
		element.innerHTML = '<h3>Peers List</h3>';
		const nodes = Object.entries(this.networkRenderer.nodes);
		if (nodes.length === 0) element.display = 'none';

		for (const [id, node] of Object.entries(this.networkRenderer.nodes)) {
			const peerItem = document.createElement('div');
			peerItem.dataset.peerId = id;
			peerItem.textContent = id;
			peerItem.onclick = () => this.#setCurrentPeer(id);
			element.appendChild(peerItem);
		}
	}
}

const networkVisualizer = new NetworkVisualizer(true);