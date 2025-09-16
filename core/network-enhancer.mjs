import { SIMULATION, IDENTITY, TRANSPORTS, NODE, DISCOVERY, GOSSIP } from './global_parameters.mjs';
import { PeerConnection } from './peer-store-managers.mjs';
const { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } = SIMULATION.ENABLED ? await import('../simulation/test-transports.mjs') : {};

/** - 'bootstrapInfo' Definition & 'SignalData' Definition
 * @typedef {Object} bootstrapInfo
 * @property {string} id
 * @property {string} publicUrl
 * 
 * @typedef {Object} SignalData
 * @property {Array<string>} neighbours
 * @property {Object} signal
 * @property {'offer' | 'answer'} signal.type
 * @property {string} signal.sdp
 * */

export class NetworkEnhancer {
	/** @type {Array<{senderId: string, signal: SignalData, hops: number}>} */
	signalsQueue = [];
	maxSignalsQueueLength = 50;
	id;
	gossip;
	peerStore;
	isPublicNode;

	/** @type {NodeJS.Timeout | null} optimized nodes connexions interval */ interval = null;
	/** @type {Array<bootstrapInfo>} */ bootstraps = [];
	/** @type {Record<string, string>} */ bootstrapsIds = {};
	nextBootstrapIndex = 0;

	/** @param {string} selfId @param {import('./gossip.mjs').Gossip} gossip @param {import('./peer-store.mjs').PeerStore} peerStore @param {Array<bootstrapInfo>} bootstraps */
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
			const nonPublicNeighborsCount = this.peerStore.neighbours.filter(id => !id.startsWith(IDENTITY.PUBLIC_PREFIX)).length;
			const isTooMany = nonPublicNeighborsCount > DISCOVERY.TARGET_NEIGHBORS_COUNT;
			const offersToCreate = neighboursCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT / 3 ? 1 : TRANSPORTS.MAX_SDP_OFFERS;
			this.peerStore.sdpOfferManager.offersToCreate = isEnough ? 0 : offersToCreate;
			if (this.isPublicNode) { this.#freePublicNodeByKickingPeers(); return; } // PUBLIC KICKING
			else if (isTooMany) this.#improveTopologyByKickingPeers(); // OVERLAP BASED KICKING

			this.signalsQueue.sort(() => Math.random() - 0.5); // for organic processing
			for (const item of this.signalsQueue) this.#handleIncomingSignal(item.senderId, item.signal, item.hops);
			this.signalsQueue = [];

			phase = phase ? 0 : 1;
			if (isEnough) return; // already enough, do nothing
			if (phase) this.#tryConnectNextBootstrap(neighboursCount);
			else this.#tryToSpreadSDP(neighboursCount);
		}, DISCOVERY.LOOP_DELAY);
	}
	stopAutoEnhancement() { if (this.interval) clearInterval(this.interval); this.interval = null; }
	/** @param {string} peerId @param {SignalData} signal @param {number} [HOPS] */
	pushSignalToQueue(senderId, signal, HOPS) {
		if (!senderId || typeof signal !== 'object') return;
		//if (HOPS !== undefined && HOPS > 1) return; // easy topology improvement Wrong ;)
		if (HOPS !== undefined && HOPS >= GOSSIP.HOPS.signal_offer - 1) return; // easy topology improvement
		const nbOfSignals = this.signalsQueue.length;
		if (nbOfSignals >= this.maxSignalsQueueLength) return;
		if (nbOfSignals <= this.maxSignalsQueueLength / 10) { this.signalsQueue.push({ senderId, signal, hops: HOPS }); return; }
		
		// Probability to ignore: 0% at 10 signals, 20% at 100+ signals
		const ignoreChance = Math.min(0.2, (nbOfSignals - 10) / (this.maxSignalsQueueLength - 10) * 0.8);
		if (Math.random() > ignoreChance) this.signalsQueue.push({ senderId, signal, hops: HOPS });
	}
	
	// INTERNAL METHODS
	#tryToSpreadSDP(neighboursCount = 0) { // LOOP TO SELECT ONE UNSEND READY OFFER
		for (const [offerHash, readyOffer] of Object.entries(this.peerStore.sdpOfferManager.offers)) {
			const { isUsed, sentCounter, signal } = readyOffer;
			if (isUsed || sentCounter > 0) continue; // already used or already sent at least once
			if (neighboursCount * .8 >= DISCOVERY.TARGET_NEIGHBORS_COUNT) break; // 80% target reached, stop sending offers

			const pond = 1 / Math.max(1, neighboursCount); // spend less offers depending on how many neighbours we have
			if (Math.random() > pond) continue; // skip this time

			this.gossip.broadcastToAll({ signal, neighbours: this.peerStore.neighbours, offerHash }, 'signal_offer');
			readyOffer.sentCounter++;
			break; // limit to one per loop
		}
	}
	/** @param {string} senderId @param {SignalData} data @param {number | undefined} hops */
	#handleIncomingSignal(senderId, data, hops) {
		const { signal, neighbours, offerHash } = data || {}; // remoteInfo
		if (signal.type !== 'offer' && signal.type !== 'answer') return;
		if (!Array.isArray(neighbours)) return;
		this.peerStore.digestPeerNeighbours(senderId, neighbours);

		if (this.peerStore.connected[senderId]) return; // already connected
		if (this.isPublicNode || this.peerStore.isKicked(senderId)) return;
		if (signal.type === 'offer' && this.peerStore.connecting[senderId]?.['in']) return; // already connecting in
		if (signal.type === 'answer' && this.peerStore.connecting[senderId]?.['out']) return; // already connecting out

		// AVOID CONNECTING TO TOO MANY NON-PUBLIC PEERS
		const nonPublicNeighborsCount = this.peerStore.neighbours.filter(id => !id.startsWith(IDENTITY.PUBLIC_PREFIX)).length;
		if (nonPublicNeighborsCount > DISCOVERY.TARGET_NEIGHBORS_COUNT) this.peerStore.kickPeer(senderId, 30_000);

		// AVOID OVERLAP
		//const minHops = Math.max(1, Math.min(3, Math.ceil(DISCOVERY.MAX_OVERLAP / 2))); // Wrong ;)
		//if (hops !== undefined && hops < minHops) this.peerStore.kickPeer(senderId, 30_000);
		const overlapMalus = nonPublicNeighborsCount > DISCOVERY.TARGET_NEIGHBORS_COUNT / 2 ? 1 : 0;
		if (this.#getOverlap(senderId) > DISCOVERY.MAX_OVERLAP - overlapMalus) this.peerStore.kickPeer(senderId, 30_000);
		
		const tooManyConnectingPeers = Object.keys(this.peerStore.connecting).length >= DISCOVERY.TARGET_NEIGHBORS_COUNT * 4;
		if (tooManyConnectingPeers && signal.type === 'offer') return; // avoid processing too many offers when we are already trying to connect to many peers

		if (this.peerStore.addConnectingPeer(senderId, signal, offerHash) !== true) return;
		this.peerStore.assignSignal(senderId, signal, offerHash);
	}
	/** @param {string} peerId1 @param {string} [peerId2] default: this.id @param {boolean} [ignorePublic] default: true @param {1 | 2} [degree] default: 1 */
	#getOverlap(peerId1, peerId2 = this.id, ignorePublic = true, degree = 1) {
		const p1n1 = this.peerStore.known[peerId1]?.neighbours || {};
		const p2n1 = peerId2 !== this.peerStore.id ? this.peerStore.known[peerId2]?.neighbours : Object.fromEntries(this.peerStore.neighbours.map(item => [item, true])) || {};
		if (degree === 2) {
			for (const n1 of Object.keys(p1n1))
				for (const n2 of Object.keys(this.peerStore.known[n1]?.neighbours || {})) if (n2 !== peerId1) p1n1[n2] = true;
			for (const n1 of Object.keys(p2n1))
				for (const n2 of Object.keys(this.peerStore.known[n1]?.neighbours || {})) if (n2 !== peerId2) p2n1[n2] = true;
		}

		const p1Neighbours = Object.keys(p1n1);
		const p2Neighbours = Object.keys(p2n1);
		const sharedNeighbours = {};
		for (const id of p1Neighbours.concat(p2Neighbours))
			if (ignorePublic && id.startsWith(IDENTITY.PUBLIC_PREFIX)) continue;
			else sharedNeighbours[id] = true;
			
		return Object.keys(sharedNeighbours).length;
	}
	#improveTopologyByKickingPeers() { // KICK THE PEER WITH THE BIGGEST OVERLAP
		const connectedPeers = Object.entries(this.peerStore.connected);
		const peersWithOverlap = connectedPeers.map(([id, conn]) => [id, this.#getOverlap(id, this.id, true, 1)]);
		const sortedPeers = peersWithOverlap.sort((a, b) => b[1] - a[1]);
		this.peerStore.kickPeer(sortedPeers[0][0], 30_000);
	}
	#freePublicNodeByKickingPeers() { // PUBLIC NODES ONLY
		const { min, max } = NODE.SERVICE.AUTO_KICK_DELAY;
		const connectedPeers = Object.entries(this.peerStore.connected);
		const sortedPeers = connectedPeers.sort((a, b) => b[1].getConnectionDuration() - a[1].getConnectionDuration());
		let connectedPeersCount = connectedPeers.length;
		for (const [peerId, conn] of sortedPeers) {
			if (connectedPeersCount <= NODE.SERVICE.MAX_WS_OUT_CONNS / 2) break;
			const delay = Math.round(Math.random() * (max - min) + min);
			if (conn.getConnectionDuration() < delay) continue;
			this.peerStore.kickPeer(peerId, NODE.SERVICE.AUTO_KICK_DURATION);
			connectedPeersCount--;
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
		ws.binaryType = 'arraybuffer';
		this.peerStore.connecting[remoteId] = { out: new PeerConnection(remoteId, ws, 'out', true) };
		ws.onerror = (error) => console.error(`WebSocket error:`, error.stack);
		ws.onopen = () => {
			ws.onclose = () => { for (const cb of this.peerStore.callbacks.disconnect) cb(remoteId, 'out'); }
			ws.onmessage = (data) => { for (const cb of this.peerStore.callbacks.data) cb(remoteId, data.data); };
			for (const cb of this.peerStore.callbacks.connect) cb(remoteId, 'out');
		};
	}
}