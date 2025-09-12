import { SIMULATION, TRANSPORTS, IDENTIFIERS, NODE, DISCOVERY } from './global_parameters.mjs';
import { PeerConnection } from './peer-store-managers.mjs';
const { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } = SIMULATION.ENABLED ? await import('../simulation/test-transports.mjs') : {};

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
	nextBootstrapIndex = 0;

	/** @param {string} selfId @param {Gossip} gossip @param {PeerStore} peerStore @param {Array<bootstrapInfo>} bootstraps */
	constructor(selfId, gossip, peerStore, bootstraps) {
		this.id = selfId;
		this.gossip = gossip;
		this.peerStore = peerStore;
		const shuffledIndexes = [...Array(bootstraps.length).keys()].sort(() => Math.random() - 0.5);
		for (const i of shuffledIndexes) this.bootstraps.push(bootstraps[i]);
		for (const b of bootstraps) this.bootstrapsIds[b.id] = b.publicUrl;
		this.nextBootstrapIndex = Math.random() * bootstraps.length | 0;
	}

	// PUBLIC METHODS
	init() {
		this.#tryConnectNextBootstrap(); // first shot ASAP
		let phase = 0;
		this.interval = setInterval(() => {
			const neighboursCount = this.peerStore.neighbours.length;
			const isEnough = neighboursCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT;
			const offersToCreate = neighboursCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT / 3 ? 1 : TRANSPORTS.MAX_SDP_OFFERS;
			this.peerStore.sdpOfferManager.offersToCreate = isEnough ? 0 : offersToCreate;
			if (this.isPublicNode) { this.#kickPeersIfNeeded(); return; } // public node only kick peers if needed

			phase = phase ? 0 : 1;
			if (isEnough) return; // already enough, do nothing
			if (phase) this.#tryConnectNextBootstrap(neighboursCount);
			else this.tryToSpreadSDP(neighboursCount);
		}, DISCOVERY.LOOP_DELAY);
	}
	stopAutoEnhancement() { if (this.interval) clearInterval(this.interval); this.interval = null; }
	tryToSpreadSDP(neighboursCount = 0) { // LOOP TO SELECT ONE UNSEND READY OFFER
		for (const [offerHash, readyOffer] of Object.entries(this.peerStore.sdpOfferManager.offers)) {
			const { isUsed, sentCounter, signal } = readyOffer;
			if (isUsed || sentCounter > 0) continue; // already used or already sent at least once

			this.gossip.broadcast('signal', { signal, neighbours: this.peerStore.neighbours, offerHash });
			readyOffer.sentCounter++;
			break; // limit to one per loop
		}
	}
	/** @param {string} senderId @param {SignalData} data */
	handleIncomingSignal(senderId, data) {
		if (typeof data !== 'object') return;
		const { signal, neighbours, offerHash } = data || {}; // remoteInfo
		if (signal.type !== 'offer' && signal.type !== 'answer') return;
		if (!senderId || typeof signal !== 'object' || !Array.isArray(neighbours)) return;
		this.peerStore.digestPeerNeighbours(senderId, neighbours);

		if (this.peerStore.connected[senderId]) return; // already connected
		if (this.isPublicNode || this.peerStore.isKicked(senderId)) return;
		if (signal.type === 'offer' && this.peerStore.connecting[senderId]?.['in']) return; // already connecting in
		if (signal.type === 'answer' && this.peerStore.connecting[senderId]?.['out']) return; // already connecting out

		const { overlap } = this.peerStore.getOverlap(senderId);
		const tooManySharedPeers = overlap > DISCOVERY.MAX_OVERLAP;
		const isTwitchUser = senderId.startsWith('f_');
		const tooManyConnectedPeers = this.peerStore.neighbours.length >= DISCOVERY.TARGET_NEIGHBORS_COUNT - 1;
		if (!isTwitchUser && (tooManySharedPeers || tooManyConnectedPeers)) this.peerStore.kickPeer(senderId, 30_000);

		if (this.peerStore.addConnectingPeer(senderId, signal, offerHash) !== true) return;
		this.peerStore.assignSignal(senderId, signal, offerHash);
	}
	/** @param {string} senderId @param {SignalData} data */
	handleSignalRejection(senderId, data) {
		if (typeof data !== 'object') return;
		if (!senderId || !Array.isArray(data.neighbours)) return;
		this.peerStore.digestPeerNeighbours(senderId, data.neighbours);
	}

	// INTERNAL METHODS
	#kickPeersIfNeeded() { // only for public nodes
		const { min, max } = NODE.SERVICE.AUTO_KICK_DELAY;
		for (const [peerId, conn] of Object.entries(this.peerStore.connected)) {
			const delay = Math.round(Math.random() * (max - min) + min);
			if (conn.getConnectionDuration() < delay) continue;
			this.peerStore.kickPeer(peerId, NODE.SERVICE.AUTO_KICK_DURATION);
		}
	}
	#tryConnectNextBootstrap(neighboursCount = 0) {
		if (this.bootstraps.length === 0) return;
		
		const [connected, connecting] = [this.peerStore.connected, this.peerStore.connecting];
		const connectingCount = Object.keys(connecting).filter(id => this.bootstrapsIds[id]).length;
		const connectedCount = this.peerStore.neighbours.filter(id => this.bootstrapsIds[id]).length;
		
		// MINIMIZE BOOTSTRAP CONNECTIONS DEPENDING ON HOW MANY NEIGHBOURS WE HAVE
		if (connectedCount + connectingCount >= NODE.SERVICE.MAX_WS_OUT_CONNS) return; // already connected to enough bootstraps
		if (connectedCount && neighboursCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT / 2) return; // no more bootstrap needed (half of target)
		if (connectingCount && neighboursCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT / 2) return; // no more bootstrap needed (half of target)
		
		const { id, publicUrl } = this.bootstraps[this.nextBootstrapIndex];
		const canMakeATry = id && publicUrl && !connected[id] && !connecting[id];
		if (canMakeATry) this.#connectToPublicNode(id, publicUrl);
		this.nextBootstrapIndex = (this.nextBootstrapIndex + 1) % this.bootstraps.length;
	}
	#connectToPublicNode(remoteId = 'toto', publicUrl = 'localhost:8080') {
		const ws = new TRANSPORTS.WS_CLIENT(publicUrl);
		this.peerStore.connecting[remoteId] = { out: new PeerConnection(remoteId, ws, 'out', true) };
		ws.onerror = (error) => console.error(`WebSocket error:`, error.stack);
		ws.onopen = () => {
			ws.onclose = () => { for (const cb of this.peerStore.callbacks.disconnect) cb(remoteId, 'out'); }
			ws.onmessage = (data) => { for (const cb of this.peerStore.callbacks.data) cb(remoteId, data.data); };
			for (const cb of this.peerStore.callbacks.connect) cb(remoteId, 'out');
		};
	}
}