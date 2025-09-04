import { TestWsConnection } from '../simulation/test-transports.mjs';
import { IDENTIFIERS, NODE, CONNECTION_ENHANCER } from './global_parameters.mjs';

/**
 * @typedef {import('./peer-store.mjs').PeerStore} PeerStore
 * 
 * @typedef {Object} bootstrapInfo
 * @property {string} id
 * @property {string} publicUrl
 * 
 * @typedef {Object} SignalData
 * @property {string} signal
 * @property {Array<string>} neighbours
 * */



export class NetworkEnhancer {
	id;
	peerStore;
	/** @type {NodeJS.Timeout | null} optimized nodes connexions interval */ interval = null;

	/** @type {Array<bootstrapInfo>} */ bootstraps = [];
	/** @type {Record<string, string>} */ bootstrapsIds = {};
	/** @type {number} next Bootstrap Index */ nBI = 0;
	/** @type {boolean} specify to use test transport (useful for simulator) */ useTestTransport;

	/** @param {string} selfId @param {PeerStore} peerStore @param {Array<bootstrapInfo>} bootstraps */
	constructor(selfId, peerStore, bootstraps, useTestTransport = false) {
		this.id = selfId;
		this.peerStore = peerStore;
		this.bootstraps = bootstraps.sort(() => Math.random() - 0.5);
		for (const b of bootstraps) this.bootstrapsIds[b.id] = b.publicUrl;
		this.nBI = Math.random() * bootstraps.length | 0;
		this.useTestTransport = useTestTransport;
	}

	// PUBLIC METHODS
	init() {
		this.#tryConnectNextBootstrap(); // first shot ASAP
		const ecd = NODE.ENHANCE_CONNECTION_DELAY;
		let phase = 0;
		this.interval = setInterval(() => {
			phase = phase ? 0 : 1;
			if (phase) this.#tryConnectNextBootstrap();
			else this.#tryConnectMoreNodes();
		}, ecd);
	}
	destroy() {
		if (this.interval) clearInterval(this.interval);
	}
	/** @param {string} senderId @param {SignalData} data @param {WebSocket} [tempTransportInstance] optional WebSocket */
	handleIncomingSignal(senderId, data, tempTransportInstance) {
		if (typeof data !== 'object') return;
		const { signal, neighbours } = data || {};
		if (!senderId || typeof signal !== 'object') return;
		if (this.peerStore.isKicked(senderId)) this.peerStore.rejectSignal(senderId);
		this.peerStore.digestPeerNeighbours(senderId, neighbours);

		const conn = this.peerStore.connecting[senderId];
		if (conn && signal.type === 'answer') this.peerStore.assignSignal(senderId, signal);
		else if (!conn && signal.type === 'offer') {
			const { sharedNeighbours, overlap } = this.peerStore.getOverlap(senderId);
			const tooManySharedPeers = overlap > NODE.MAX_OVERLAP;
			const isTwitchUser = senderId.startsWith('f_');
			const tooManyConnectedPeers = this.peerStore.neighbours.length >= NODE.TARGET_NEIGHBORS_COUNT - 1;
			if (!isTwitchUser && (tooManySharedPeers || tooManyConnectedPeers)) this.peerStore.kickPeer(senderId, 30_000);
			else this.peerStore.addConnectingPeer(senderId, tempTransportInstance, signal, this.useTestTransport);
		}
	}
	/** @param {string} senderId @param {SignalData} data */
	handleSignalRejection(senderId, data) {
		if (typeof data !== 'object') return;
		if (!senderId || !Array.isArray(data.neighbours)) return;
		this.peerStore.digestPeerNeighbours(senderId, data.neighbours);
	}
	/** @param {string} senderId @param {Array<{senderId: string, topic: string, data: string | Uint8Array}>} gossipHistory */
	handleIncomingGossipHistory(senderId, gossipHistory = []) {
		for (const msg of gossipHistory)
			if (msg.topic === 'my_neighbours') this.peerStore.digestPeerNeighbours(msg.senderId, msg.data);
			else if (msg.topic === 'peer_disconnected') this.peerStore.unlinkPeers(msg.data, msg.senderId);
			else if (msg.topic === 'peer_connected') this.peerStore.handlePeerConnectedGossipEvent(msg.senderId, msg.data);
	}

	// INTERNAL METHODS
	#getConnectionInfo() {
		const connectedPeersCount = this.peerStore.neighbours.length;
		const missingCount = (NODE.TARGET_NEIGHBORS_COUNT - connectedPeersCount);
		return { 
			isEnough: connectedPeersCount >= NODE.TARGET_NEIGHBORS_COUNT,
			limitToOneBootstrap: connectedPeersCount >= NODE.MAX_BOOTSTRAPS_OUT_CONNS / 2,
			missingCount,
			connectedPeersCount,
			knownPeersCount: Object.keys(this.peerStore.known).length
		};
	}
	#tryConnectNextBootstrap() {
		const { isEnough, limitToOneBootstrap, missingCount, connectedPeersCount, knownPeersCount } = this.#getConnectionInfo();
		if (this.bootstraps.length === 0) return;
		if (isEnough) return; // already connected to enough peers
		
		const [connected, connecting] = [this.peerStore.connected, this.peerStore.connecting];
		const connectingCount = Object.keys(connecting).filter(id => this.bootstrapsIds[id]).length;
		const connectedCount = this.peerStore.neighbours.filter(id => this.bootstrapsIds[id]).length;
		if (connectedCount + connectingCount >= NODE.MAX_BOOTSTRAPS_OUT_CONNS) return; // already connected to enough bootstraps

		if (limitToOneBootstrap && connectedCount) return; // already connected to one bootstrap, wait next turn
		if (limitToOneBootstrap && connectingCount) return; // already connecting to one bootstrap, wait next turn
		const { id, publicUrl } = this.bootstraps[this.nBI];
		const canMakeATry = id && publicUrl && !connected[id] && !connecting[id];
		if (canMakeATry) this.#connectToPublicNode_UsingWs_UntilWebRtcUpgrade(id, publicUrl);
		this.nBI = (this.nBI + 1) % this.bootstraps.length;
	}
	#connectToPublicNode_UsingWs_UntilWebRtcUpgrade(remoteId = 'toto', publicUrl = 'localhost:8080') {
		const Transport = this.useTestTransport ? TestWsConnection : WebSocket;
		const ws = new Transport(publicUrl);
		ws.onopen = () => this.peerStore.addConnectingPeer(remoteId, ws, undefined, this.useTestTransport);
		ws.onclose = () => this.peerStore.removePeer(remoteId, 'connecting');
		ws.onerror = (error) => console.error(`WebSocket error:`, error.stack);
		ws.onmessage = (event) => {
			try {
				const parsed = JSON.parse(event.data);
				if (parsed.type !== 'signal') return console.error(`Received message is not a signal (type: ${parsed.type})`);
				this.handleIncomingSignal(remoteId, parsed.data);
			} catch (error) { console.error(`Error handling incoming signal for ${remoteId}:`, error.stack); }
		}
		return ws;
	}
	#tryConnectMoreNodes() {
		const { isEnough, missingCount, connectedPeersCount, knownPeersCount } = this.#getConnectionInfo();
		if (isEnough || !connectedPeersCount) return;

		const connectedFactor = connectedPeersCount;
		const knowsFactor = Math.ceil(Math.sqrt(knownPeersCount) / NODE.TARGET_NEIGHBORS_COUNT);
		const ratePow = Math.max(1, Math.min(knowsFactor + connectedFactor, 8));
		const enhancedConnectionRate = Math.pow(NODE.ENHANCE_CONNECTION_RATE_BASIS, ratePow);
		// if (this.id === 'peer_0') // DEBUG
		// 	 console.log(`ECR: ${enhancedConnectionRate.toFixed(6)}`)

		const maxAttempts = CONNECTION_ENHANCER.MAX_ATTEMPTS_BASED_ON_CONNECTED[connectedPeersCount];
		const entries = Object.entries(this.peerStore.known);
		const nbEntries = entries.length;
		let index = Math.floor(Math.random() * nbEntries);
		let attempts = 0;
		for (let i = 0; i < nbEntries; i++) {
			index = (index + 1) % nbEntries;
			const [peerId, peerInfo] = entries[index];
			if (peerId.startsWith(IDENTIFIERS.PUBLIC_NODE)) continue; // ignore bootstrap peers
			if (Math.random() > enhancedConnectionRate) continue; // apply rate (useful at startup)
			if (this.peerStore.isKicked(peerId) || this.peerStore.isBanned(peerId)) continue;
			if (this.peerStore.connected[peerId]) continue; // skip connected peers
			if (this.peerStore.connecting[peerId]) continue; // skip connecting peers
			if (peerInfo.connectionsCount >= NODE.TARGET_NEIGHBORS_COUNT) continue; // skip if target already connected to enough peers
			if (peerId === this.id) continue; // skip self

			const { sharedNeighbours, overlap } = this.peerStore.getOverlap(peerId);
			if (overlap > NODE.MAX_OVERLAP) continue; // avoid overlap
			this.peerStore.addConnectingPeer(peerId, undefined, undefined, this.useTestTransport);
			if (attempts++ >= maxAttempts) break; // limit to one new connection attempt
		}
	}
}