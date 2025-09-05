import { NetworkRenderer } from './NetworkRenderer.mjs';
import { IDENTIFIERS } from '../core/global_parameters.mjs';

class SimulationInterface {
	#connectingWs = false;
	#ws;
	currentPeerId;
	onSettings;
	onPeersIds;
	onPeerInfo;
	onPeerMessage;

	responseReceivedByType = {};

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
			this.responseReceivedByType[msg.type] = true;

			if (msg.type === 'settings') this.onSettings(msg.data);
			if (msg.type === 'peersIds') this.onPeersIds(msg.data);
			if (msg.type === 'peerInfo') this.onPeerInfo(msg.data);
			if (msg.type === 'peerMessage' && this.onPeerMessage) this.onPeerMessage(msg.remoteId, msg.data);
		};
		this.#connectingWs = false;
	}
	start(settings) { this.#sendWsMessage({ type: 'start', settings }); }
	getPeerInfo() {
		this.#sendWsMessage({ type: 'getPeerInfo', peerId: this.currentPeerId });
	}
	getPeerIds() {
		this.#sendWsMessage({ type: 'getPeersIds' });
	}
	tryToConnectNode(fromId, targetId) {
		if (!fromId || !targetId) return;
		this.#sendWsMessage({ type: 'tryToConnectNode', fromId, targetId });
	}
	#sendWsMessage(msg, avoidSendingIfNotAnswered = false) {
		if (this.#ws?.readyState === WebSocket.OPEN) {
			if (avoidSendingIfNotAnswered && this.responseReceivedByType[msg.type] === false) return;
			this.responseReceivedByType[msg.type] = false;
			this.#ws.send(JSON.stringify(msg));
		} else {
			console.error(`WebSocket is not connected. ${this.#connectingWs ? 'Trying to connect...' : ''}`);
			setTimeout(() => { if (!this.#connectingWs) this.#setupWs(); }, 2000);
		}
	}
}

class NetworkVisualizer {
	autoSelectCurrentPeerCategory = ['standard', 'public']; // 'public' | 'standard' | false
	currentPeerId;
	lastPeerInfo;
	networkRenderer = new NetworkRenderer();
	simulationInterface;
	elements = {
		peersList: document.getElementById('peersList'),
		simulationSettings: document.getElementById('simulationSettings'),

		publicPeersCount: document.getElementById('publicPeersCount'),
		peersCount: document.getElementById('peersCount'),
		startSimulation: document.getElementById('startSimulation'),
	}

	constructor(isSimulation = true) {
		if (isSimulation) {
			this.elements.peersList.style.display = 'block';
			this.elements.simulationSettings.style.display = 'block';
			this.simulationInterface = new SimulationInterface(
				(settings) => this.#handleSettings(settings), // event: onSettings
				(peersIds) => this.#updatePeersList(peersIds), // event: onPeersIds
				(data) => { if (data.peerId === this.currentPeerId) this.#updateNetworkFromPeerInfo(data.peerInfo); } // event: onPeerInfo
			);

			this.simulationInterface.onPeerMessage = (remoteId, data) => {
				const d = JSON.parse(data);
				if (d.route) this.networkRenderer.displayDirectMessageRoute(remoteId, d.route);
				else this.networkRenderer.displayGossipMessageRoute(remoteId, d.senderId, d.topic, d.data);
			};

			this.networkRenderer.onNodeLeftClick = (nodeId) => this.simulationInterface.tryToConnectNode(this.currentPeerId,nodeId);
			this.networkRenderer.onNodeRightClick = (nodeId) => this.#setSelectedPeer(nodeId);
			this.elements.startSimulation.onclick = () => {
				this.mockRunning = false;
				this.networkRenderer.clearNetwork();
				this.simulationInterface.start(this.#getSimulatorSettings());
			}
		}

		setInterval(() => this.networkRenderer.updateStats(this.lastPeerInfo?.store?.connected?.length || 0), 200);
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
		this.currentPeerId = id;
		this.simulationInterface.currentPeerId = id;
		this.networkRenderer.setCurrentPeer(id, clearNetworkOneChange);
	}
	#getSimulatorSettings() {
		return {
			publicPeersCount: parseInt(this.elements.publicPeersCount.value),
			peersCount: parseInt(this.elements.peersCount.value)
		};
	}
	// LIVE METHODS
	#updateNetworkFromPeerInfo(peerInfo) {
		if (!peerInfo) return;
		this.lastPeerInfo = peerInfo;

		const newlyUpdated = {};
		const digestPeerUpdate = (id = 'toto', status = 'unknown', neighbours = []) => {
			const isPublic = id.startsWith(IDENTIFIERS.PUBLIC_NODE);
			this.networkRenderer.addOrUpdateNode(id, status, isPublic, neighbours);
			newlyUpdated[id] = true;
		}

		const getNeighbours = (peerId) => {
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

	
		const nodes = this.networkRenderer.nodesStore.store;
		const nodeIds = this.networkRenderer.nodesStore.getNodesIds();
		for (const id of nodeIds) // filter absent nodes
			if (!newlyUpdated[id] && id !== this.currentPeerId) this.networkRenderer.removeNode(id);

		// ensure current peer is updated
		if (peerInfo.id === this.currentPeerId) digestPeerUpdate(peerInfo.id, 'current', getNeighbours(peerInfo.id));

		// Create connections
		const connections = [];
		for (const [id, node] of Object.entries(nodes))
			for (const neighbourId of node.neighbours) connections.push([id, neighbourId]);

		//console.log(`Updated network map: ${Object.keys(nodes).length} nodes | ${Object.keys(connections).length} connections`);
		this.networkRenderer.digestConnectionsArray(connections);
	}
	// SIMULATION METHODS
	#handleSettings(settings = { publicPeersCount: 2, peersCount: 5 }) {
		if (settings.publicPeersCount) this.elements.publicPeersCount.value = settings.publicPeersCount;
		if (settings.peersCount) this.elements.peersCount.value = settings.peersCount;
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
}

const networkVisualizer = new NetworkVisualizer(true);
window.networkVisualizer = networkVisualizer; // Expose for debugging
window.networkRenderer = networkVisualizer.networkRenderer; // Expose for debugging