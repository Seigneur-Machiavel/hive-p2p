import { TestWsConnection } from '../simulation/test-transports.mjs';
import { shuffleArray } from '../utils/p2p_common_functions.mjs';
import { NODE } from '../utils/p2p_params.mjs';

/**
 * @typedef {import('./peer-store.mjs').PeerStore} PeerStore
 * 
 * @typedef {Object} bootstrapInfo
 * @property {string} id
 * @property {string} publicUrl */

export class NetworkEnhancer {
	id;
	peerStore;
	/** @type {NodeJS.Timeout | null} optimized nodes connexions interval */ interval = null;

	/** @type {Array<bootstrapInfo>} */ bootstraps = [];
	/** @type {Record<string, string>} */ bootstrapsIds = {};
	/** @type {number} next Bootstrap Index */ nBI = 0;
	/** @type {boolean} specify to use test transport (useful for simulator) */ useTestTransport;

	/** @param {string} id @param {PeerStore} peerStore @param {Array<bootstrapInfo>} bootstraps */
	constructor(id, peerStore, bootstraps, useTestTransport = false) {
		this.id = id;
		this.peerStore = peerStore;
		this.bootstraps = shuffleArray(bootstraps);
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
	/** @param {string} senderId @param {object} data @param {WebSocket} [tempTransportInstance] optional WebSocket */
	handleIncomingSignal(senderId, data, tempTransportInstance) {
		if (this.peerStore.isKicked(senderId)) return;
		if (!senderId || typeof data !== 'object') return;
		const conn = this.peerStore.connecting[senderId];
		if (conn && data.type !== 'offer') this.peerStore.assignSignal(senderId, data);
		else if (!conn && data.type === 'offer') {
			const sharedNeighbours = this.peerStore.getSharedNeighbours(this.id, senderId);
			const tooManySharedPeers = sharedNeighbours.length > NODE.MAX_SHARED_NEIGHBORS_COUNT;
			const isTwitchUser = senderId.startsWith('f_');
			const tooManyConnectedPeers = Object.keys(this.peerStore.connected).length >= NODE.TARGET_NEIGHBORS_COUNT - 1;
			if (!isTwitchUser && (tooManySharedPeers || tooManyConnectedPeers)) this.peerStore.kickPeer(senderId, 30_000);
			else this.peerStore.addConnectingPeer(senderId, tempTransportInstance, data, this.useTestTransport);
		}
	}
	/** @param {string} senderId @param {Array<{senderId: string, topic: string, data: string | Uint8Array}>} gossipHistory */
	handleIncomingGossipHistory(senderId, gossipHistory = []) {
		for (const msg of gossipHistory)
			if (msg.topic === 'peer_disconnected') this.peerStore.unlinkPeers(msg.data, msg.senderId);
			else if (msg.topic === 'peer_connected') this.peerStore.handlePeerConnectedGossipEvent(msg.senderId, msg.data);
	}

	// INTERNAL METHODS
	#getConnectionInfo() {
		const connectedPeersCount = Object.keys(this.peerStore.connected).length;
		const missingCount = (NODE.TARGET_NEIGHBORS_COUNT - connectedPeersCount);
		return { 
			isEnough: connectedPeersCount >= NODE.TARGET_NEIGHBORS_COUNT,
			missingCount,
			connectedPeersCount,
			knownPeersCount: Object.keys(this.peerStore.known).length
		};
	}
	#tryConnectNextBootstrap() {
		if (this.bootstraps.length === 0) return;
		if (this.#getConnectionInfo().isEnough) return; // already connected to enough peers
		
		const [connected, connecting] = [this.peerStore.connected, this.peerStore.connecting];
		const connectingCount = Object.keys(connecting).filter(id => this.bootstrapsIds[id]).length;
		const connectedCount = Object.keys(connected).filter(id => this.bootstrapsIds[id]).length;
		if (connectedCount + connectingCount >= NODE.MAX_BOOTSTRAPS_OUT_CONNS) return; // already connected to enough bootstraps

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
		if (isEnough) return;
		
		/** @type {string[]} */ const targets = [];
		for (const [peerId, peerInfo] of Object.entries(this.peerStore.known)) {
			if (this.peerStore.isKicked(peerId) || this.peerStore.isBanned(peerId)) continue;
			if (targets.length >= missingCount) break;
			else if (peerId === this.id) continue; // skip self
			else if (this.peerStore.connected[peerId]) continue; // skip connected peers
			else if (this.peerStore.connecting[peerId]) continue; // skip connecting peers

			const sharedNeighborsCount = this.peerStore.getSharedNeighbours(this.id, peerId).length;
			if (sharedNeighborsCount > NODE.MAX_SHARED_NEIGHBORS_COUNT) continue;
			if (peerInfo.connectionsCount < NODE.TARGET_NEIGHBORS_COUNT) targets.push(peerId);
		}

		const connectedFactor = connectedPeersCount;
		const knowsFactor = Math.ceil(knownPeersCount / 10);
		const ratePow = Math.min(knowsFactor + connectedFactor, 8);
		const enhancedConnectionRate = Math.pow(NODE.ENHANCE_CONNECTION_RATE_BASIS, ratePow);
		for (const targetId of targets) {
			if (Math.random() > enhancedConnectionRate) continue;
			this.peerStore.addConnectingPeer(targetId, undefined, undefined, this.useTestTransport);
			break;
		}
	}
}