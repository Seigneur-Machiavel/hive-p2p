import { NetworkRenderer } from './NetworkRenderer.mjs';
import { CryptoCodex } from '../core/crypto-codex.mjs';
window.CryptoCodex = CryptoCodex; // Expose for debugging

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
		setInterval(() => { if (this.currentPeerId) this.getPeerInfo(this.currentPeerId) }, 300);
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

	peersList = {};
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
				if (data.route) this.networkRenderer.displayDirectMessageRoute(remoteId, data.route);
				else if (data.topic) this.networkRenderer.displayGossipMessageRoute(remoteId, data.senderId, data.topic, data.data);
			};

			this.networkRenderer.onNodeLeftClick = (nodeId) => this.simulationInterface.tryToConnectNode(this.currentPeerId,nodeId);
			this.networkRenderer.onNodeRightClick = (nodeId) => this.#setSelectedPeer(nodeId);
			this.elements.startSimulation.onclick = () => {
				this.mockRunning = false;
				this.networkRenderer.clearNetwork();
				this.simulationInterface.start(this.#getSimulatorSettings());
			}
		}

		setInterval(() => this.networkRenderer.updateStats(), 200);

		window.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowUp') this.#selectPreviousPeer();
			if (e.key === 'ArrowDown') this.#selectNextPeer();
		});
	}

	#setSelectedPeer(peerId) {
		if (!peerId) return;
		if (this.networkRenderer.currentPeerId !== peerId) {
			console.log(`Selected peer changed, now => ${peerId}`);
			this.networkRenderer.maxDistance = 0; // reset maxDistance to show all nodes
			this.networkRenderer.avoidAutoZoomUntil = Date.now() + 2000; // avoid auto-zoom for 2 seconds
			this.networkRenderer.lastAutoZoomDistance = 0;
			this.networkRenderer.clearNetwork(); // Clear network and scroll peerId into view

			for (const peerItem of document.querySelectorAll(`#peersList div[data-peer-id]`))
				if (peerItem.dataset.peerId === peerId) peerItem.classList.add('selected');
				else peerItem.classList.remove('selected');
				
			const selectedItem = document.querySelector(`#peersList div[data-peer-id="${peerId}"]`);
			if (selectedItem) {
				const listRect = this.elements.peersList.getBoundingClientRect();
				const itemRect = selectedItem.getBoundingClientRect();
				if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
					this.elements.peersList.scrollTop = selectedItem.offsetTop - this.elements.peersList.offsetTop - this.elements.peersList.clientHeight / 2 + selectedItem.clientHeight / 2;
				}
			}
		}
		this.networkRenderer.currentPeerId = peerId;

		this.#setCurrentPeer(peerId);
		this.simulationInterface.getPeerInfo();

	}
	#selectNextPeer() {
		const peerIds = Object.keys(this.peersList);
		if (peerIds.length === 0) return;
		if (!this.currentPeerId) return this.#setSelectedPeer(peerIds[0]);
		const currentIndex = peerIds.indexOf(this.currentPeerId);
		const nextIndex = (currentIndex + 1) % peerIds.length;
		this.#setSelectedPeer(peerIds[nextIndex]);
	}
	#selectPreviousPeer() {
		const peerIds = Object.keys(this.peersList);
		if (peerIds.length === 0) return;
		if (!this.currentPeerId) return this.#setSelectedPeer(peerIds[0]);
		const currentIndex = peerIds.indexOf(this.currentPeerId);
		const previousIndex = (currentIndex - 1 + peerIds.length) % peerIds.length;
		this.#setSelectedPeer(peerIds[previousIndex]);
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
		const digestPeerUpdate = (id = 'toto', status = 'unknown', neighbors = []) => {
			const isPublic = CryptoCodex.isPublicNode(id);
			this.networkRenderer.addOrUpdateNode(id, status, isPublic, neighbors);
			newlyUpdated[id] = true;
		}

		const getNeighbors = (peerId) => {
			const knownPeer = peerInfo.store.known[peerId];
			return knownPeer ? Object.keys(knownPeer.neighbors || {}) : [];
		}
		
		const knownToIgnore = {};
		knownToIgnore[this.currentPeerId] = true;
		for (const id of peerInfo.store.connecting) knownToIgnore[id] = true;
		for (const id of peerInfo.store.connected) knownToIgnore[id] = true;
		for (const id in peerInfo.store.known)
			if (!knownToIgnore[id]) digestPeerUpdate(id, 'known', getNeighbors(id));
		
		for (const id of peerInfo.store.connecting) digestPeerUpdate(id, 'connecting', getNeighbors(id));
		for (const id of peerInfo.store.connected) digestPeerUpdate(id, 'connected', getNeighbors(id));

	
		const nodes = this.networkRenderer.nodesStore.store;
		const nodeIds = this.networkRenderer.nodesStore.getNodesIds();
		for (const id of nodeIds) // filter absent nodes
			if (!newlyUpdated[id] && id !== this.currentPeerId) this.networkRenderer.removeNode(id);

		// ensure current peer is updated
		if (peerInfo.id === this.currentPeerId) digestPeerUpdate(peerInfo.id, 'current', getNeighbors(peerInfo.id));

		// Create connections
		const connections = [];
		for (const id in nodes)
			for (const neighborId of nodes[id].neighbors) connections.push([id, neighborId]);

		//console.log(`Updated network map: ${Object.keys(nodes).length} nodes | ${Object.keys(connections).length} connections`);
		this.networkRenderer.digestConnectionsArray(connections);
	}
	// SIMULATION METHODS
	#handleSettings(settings = { publicPeersCount: 2, peersCount: 5 }) {
		if (settings.publicPeersCount) this.elements.publicPeersCount.value = settings.publicPeersCount;
		if (settings.peersCount) this.elements.peersCount.value = settings.peersCount;
		if (settings.autoStart) this.simulationInterface.getPeerIds();
	}
	#createPeerItem(peerId) {
		const peerItem = document.createElement('div');
		peerItem.dataset.peerId = peerId;
		peerItem.textContent = peerId;
		peerItem.onclick = () => this.#setSelectedPeer(peerId);
		return peerItem;
	}
	#updatePeersList(peersData, element = this.elements.peersList) {
		//element.innerHTML = '<h3>Peers list</h3>';

		const peerIds = {};
		for (const category in peersData)
			for (const peerId of peersData[category]) {
				peerIds[peerId] = true;
				if (this.peersList[peerId]) continue; // already listed
				const peerItem = this.#createPeerItem(peerId);
				element.appendChild(peerItem);
				this.peersList[peerId] = peerItem;
			}
		
		for (const peerId of Object.keys(this.peersList)) // remove absent peers
			if (!peerIds[peerId]) { this.peersList[peerId].remove(); delete this.peersList[peerId]; }

		if (this.currentPeerId) return this.#setSelectedPeer(this.currentPeerId); // Auto-select current peer

		for (const category of this.autoSelectCurrentPeerCategory)
			for (const peerId of peersData[category] || []) return this.#setSelectedPeer(peerId);
	}
}

const networkVisualizer = new NetworkVisualizer(true);
if (typeof window !== 'undefined') {
	window.networkVisualizer = networkVisualizer; // Expose for debugging
	window.networkRenderer = networkVisualizer.networkRenderer; // Expose for debugging
}