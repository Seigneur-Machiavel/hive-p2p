import { TRANSPORT, IDENTIFIERS, NODE, ENHANCER } from './global_parameters.mjs';
import { PeerConnection } from './peer-store-utils.mjs';

/**
 * @typedef {import('./gossip.mjs').Gossip} Gossip
 * @typedef {import('./peer-store.mjs').PeerStore} PeerStore
 * 
 * @typedef {Object} bootstrapInfo
 * @property {string} id
 * @property {string} publicUrl
 * 
 * @typedef {Object} SignalData
 * @property {Object} signal
 * @property {'offer' | 'answer'} signal.type
 * @property {string} signal.sdp
 * @property {Array<string>} neighbours
 * */

export class NetworkEnhancer {
	id;
	gossip;
	peerStore;
	isPublicNode;

	/** @type {NodeJS.Timeout | null} optimized nodes connexions interval */ interval = null;
	/** @type {Array<bootstrapInfo>} */ bootstraps = [];
	/** @type {Record<string, string>} */ bootstrapsIds = {};
	/** @type {number} next Bootstrap Index */ nBI = 0;
	/** @type {number} */ lastReadyOfferShared = 0;

	/** @param {string} selfId @param {Gossip} gossip @param {PeerStore} peerStore @param {Array<bootstrapInfo>} bootstraps */
	constructor(selfId, gossip, peerStore, bootstraps) {
		this.id = selfId;
		this.gossip = gossip;
		this.peerStore = peerStore;
		const shuffledIndexes = [...Array(bootstraps.length).keys()].sort(() => Math.random() - 0.5);
		for (const i of shuffledIndexes) this.bootstraps.push(bootstraps[i]);
		for (const b of bootstraps) this.bootstrapsIds[b.id] = b.publicUrl;
		this.nBI = Math.random() * bootstraps.length | 0;
	}

	// PUBLIC METHODS
	init() {
		this.#tryConnectNextBootstrap(); // first shot ASAP
		let phase = 0;
		this.interval = setInterval(() => {
			phase = phase ? 0 : 1;
			if (phase) this.#tryConnectNextBootstrap();
			else this.tryToSpreadSDP();
		}, ENHANCER.LOOP_DELAY);
	}
	stopAutoEnhancement() { if (this.interval) clearInterval(this.interval); this.interval = null; }
	destroy() {
		if (this.interval) clearInterval(this.interval);
	}
	tryToSpreadSDP() {
		const readyOffer = this.peerStore.sdpOfferManager.readyOffer;
		if (!readyOffer) return; // Build in progress...

		const { time, offer } = this.lastReadyOfferShared;
		const tooSoon = time && time + ENHANCER.DELAY_BETWEEN_SDP_SPREAD > Date.now();
		if (tooSoon && readyOffer === offer) return;

		const timeToRenew = time && time + ENHANCER.DELAY_BETWEEN_SDP_RESET < Date.now();
		if (timeToRenew) return this.peerStore.sdpOfferManager.reset();

		const { isEnough, connectedPeersCount } = this.#getConnectionInfo();
		if (isEnough || !connectedPeersCount) return;

		this.gossip.broadcast('signal', { signal: readyOffer, neighbours: this.peerStore.neighbours });
		this.lastReadyOfferShared = { time: Date.now(), offer: readyOffer };
	}
	/** @param {string} senderId @param {SignalData} data */
	handleIncomingSignal(senderId, data) {
		if (typeof data !== 'object') return;
		const { signal, neighbours } = data || {}; // remoteInfo
		if (!senderId || typeof signal !== 'object' || !Array.isArray(neighbours)) return;
		this.peerStore.digestPeerNeighbours(senderId, neighbours);

		if (this.isPublicNode || this.peerStore.isKicked(senderId)) return;
		if (this.peerStore.connected[senderId]) return; // already connected

		const { overlap } = this.peerStore.getOverlap(senderId);
		const tooManySharedPeers = overlap > ENHANCER.MAX_OVERLAP;
		const isTwitchUser = senderId.startsWith('f_');
		const tooManyConnectedPeers = this.peerStore.neighbours.length >= ENHANCER.TARGET_NEIGHBORS_COUNT - 1;
		if (!isTwitchUser && (tooManySharedPeers || tooManyConnectedPeers)) this.peerStore.kickPeer(senderId, 30_000);
		
		if (signal.type === 'offer' && !this.peerStore.connecting[senderId])
			if (this.peerStore.addConnectingPeer(senderId, signal) !== true) return; // already connecting
		if (signal.type === 'answer' && !this.peerStore.connecting[senderId])
			console.warn(`Received an 'answer' signal from a non-connecting peer (${senderId}). Ignoring the signal.`);

		this.peerStore.assignSignal(senderId, signal);
	}
	/** @param {string} senderId @param {SignalData} data */
	handleSignalRejection(senderId, data) {
		if (typeof data !== 'object') return;
		if (!senderId || !Array.isArray(data.neighbours)) return;
		this.peerStore.digestPeerNeighbours(senderId, data.neighbours);
	}

	// INTERNAL METHODS
	#getConnectionInfo() {
		const connectedPeersCount = this.peerStore.neighbours.length;
		const missingCount = (ENHANCER.TARGET_NEIGHBORS_COUNT - connectedPeersCount);
		return { 
			isEnough: connectedPeersCount >= ENHANCER.TARGET_NEIGHBORS_COUNT,
			limitToOneBootstrap: connectedPeersCount >= ENHANCER.TARGET_NEIGHBORS_COUNT / 3,
			limitToZeroBootstrap: connectedPeersCount >= ENHANCER.TARGET_NEIGHBORS_COUNT / 2,
			missingCount,
			connectedPeersCount,
			knownPeersCount: Object.keys(this.peerStore.known).length
		};
	}
	#tryConnectNextBootstrap() {
		const { isEnough, limitToOneBootstrap, limitToZeroBootstrap } = this.#getConnectionInfo();
		if (this.bootstraps.length === 0) return;
		if (isEnough || limitToZeroBootstrap) return; // already connected to enough peers
		
		const [connected, connecting] = [this.peerStore.connected, this.peerStore.connecting];
		const connectingCount = Object.keys(connecting).filter(id => this.bootstrapsIds[id]).length;
		const connectedCount = this.peerStore.neighbours.filter(id => this.bootstrapsIds[id]).length;
		if (connectedCount + connectingCount >= ENHANCER.MAX_SERVICE_OUT_CONNS) return; // already connected to enough bootstraps
		if (limitToOneBootstrap && connectedCount) return; // already connected to one bootstrap, wait next turn
		if (limitToOneBootstrap && connectingCount) return; // already connecting to one bootstrap, wait next turn
		
		const { id, publicUrl } = this.bootstraps[this.nBI];
		const canMakeATry = id && publicUrl && !connected[id] && !connecting[id];
		if (canMakeATry) this.#connectToPublicNode(id, publicUrl);
		this.nBI = (this.nBI + 1) % this.bootstraps.length;
	}
	#connectToPublicNode(remoteId = 'toto', publicUrl = 'localhost:8080') {
		const ws = new TRANSPORT.WS_CLIENT(publicUrl);
		ws.onerror = (error) => console.error(`WebSocket error:`, error.stack);
		ws.onclose = () => { for (const cb of this.peerStore.callbacks.disconnect) cb(remoteId, 'out'); }
		ws.onopen = () => {
			ws.onmessage = (data) => { for (const cb of this.peerStore.callbacks.data) cb(remoteId, data.data); };
			if (this.peerStore.connecting[remoteId]) return ws.close(); // already connecting, abort operation

			this.peerStore.connecting[remoteId] = new PeerConnection(remoteId, ws, 'out', true);
			this.peerStore.pendingConnections[remoteId] = Date.now() + NODE.CONNECTION_UPGRADE_TIMEOUT;
			for (const cb of this.peerStore.callbacks.connect) cb(remoteId, 'out');
		};
	}
}