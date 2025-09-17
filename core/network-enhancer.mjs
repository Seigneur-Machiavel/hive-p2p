import { CLOCK, SIMULATION, IDENTITY, TRANSPORTS, NODE, DISCOVERY, GOSSIP } from './global_parameters.mjs';
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
	/** @type {Array<{senderId: string, data: SignalData, overlap: number, timestamp: number}>} */
	offersQueue = []; // OFFERS QUEUE
	maxOffers = 20; // max offers in the queue
	id;
	gossip;
	messager;
	peerStore;
	isPublicNode;

	/** @type {Array<bootstrapInfo>} */ bootstraps = [];
	/** @type {Record<string, string>} */ bootstrapsIds = {};
	nextBootstrapIndex = 0;
	phase = 0;

	/** @param {string} selfId @param {import('./gossip.mjs').Gossip} gossip @param {import('./unicast.mjs').UnicastMessager} messager @param {import('./peer-store.mjs').PeerStore} peerStore @param {Array<bootstrapInfo>} bootstraps */
	constructor(selfId, gossip, messager, peerStore, bootstraps) {
		this.id = selfId;
		this.gossip = gossip;
		this.messager = messager;
		this.peerStore = peerStore;
		const shuffledIndexes = [...Array(bootstraps.length).keys()].sort(() => Math.random() - 0.5);
		for (const i of shuffledIndexes) this.bootstraps.push(bootstraps[i]);
		for (const b of bootstraps) this.bootstrapsIds[b.id] = b.publicUrl;
		this.nextBootstrapIndex = Math.random() * bootstraps.length | 0;
	}

	// PUBLIC METHODS
	autoEnhancementTick() {
		const neighboursCount = this.peerStore.neighbours.length;
		const isEnough = neighboursCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT;
		const nonPublicNeighborsCount = this.peerStore.neighbours.filter(id => !id.startsWith(IDENTITY.PUBLIC_PREFIX)).length;
		const isTooMany = nonPublicNeighborsCount > DISCOVERY.TARGET_NEIGHBORS_COUNT;
		const offersToCreate = nonPublicNeighborsCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT / 3 ? 1 : TRANSPORTS.MAX_SDP_OFFERS;
		this.peerStore.sdpOfferManager.offersToCreate = isEnough ? 0 : offersToCreate;
		if (this.isPublicNode && neighboursCount > NODE.SERVICE.MAX_WS_IN_CONNS) { this.#freePublicNodeByKickingPeers(); return; } // PUBLIC KICKING
		else if (isTooMany) this.#improveTopologyByKickingPeers(); // OVERLAP BASED KICKING
		
		// CLEANUP OLD OFFERS IN QUEUE
		const now = CLOCK.time;
		this.offersQueue = this.offersQueue.filter(item => item.timestamp + (TRANSPORTS.SDP_OFFER_EXPIRATION / 2) >= now);

		let bestOverlap = null; // PROCESS SIGNAL_OFFER QUEUE
		const iterations = Math.min(this.offersQueue.length, 3);
		for (let i = 0; i < iterations; i++) {
			const signalItem = this.offersQueue.shift();
			if (bestOverlap !== null && signalItem.overlap > bestOverlap) break;
			this.#assignSignalIfConditionsMet(signalItem.senderId, signalItem.data);
			bestOverlap = signalItem.overlap;
		}
	
		this.phase = this.phase ? 0 : 1;
		if (isEnough) return; // already enough, do nothing
		if (this.phase) this.tryConnectNextBootstrap(neighboursCount);
		else if (neighboursCount) this.#tryToSpreadSDP(nonPublicNeighborsCount);
	}
	/** @param {string} peerId @param {SignalData} data @param {number} [HOPS] */
	handleIncomingSignal(senderId, data, HOPS) {
		if (!senderId) return;
		if (HOPS !== undefined && HOPS >= GOSSIP.HOPS.signal_offer - 1) return; // easy topology improvement
		const { signal, neighbours, offerHash } = data || {}; // remoteInfo
		if (!Array.isArray(neighbours) || (signal.type !== 'offer' && signal.type !== 'answer')) return;
		this.peerStore.digestPeerNeighbours(senderId, neighbours);

		if (this.peerStore.connected[senderId]) return; // already connected
		if (signal.type === 'answer' && this.peerStore.connecting[senderId]?.['out']) return; // already connecting out
		if (this.isPublicNode || this.peerStore.isKicked(senderId)) return;

		// AVOID CONNECTING TO TOO MANY "NON-PUBLIC PEERS"
		const nonPublicNeighborsCount = this.peerStore.neighbours.filter(id => !id.startsWith(IDENTITY.PUBLIC_PREFIX)).length;
		if (nonPublicNeighborsCount > DISCOVERY.TARGET_NEIGHBORS_COUNT) return;

		// AVOID OVERLAP
		const overlap = this.#getOverlap(senderId, this.id, true, 1);
		const overlapMalus = nonPublicNeighborsCount > DISCOVERY.TARGET_NEIGHBORS_COUNT / 2 ? 1 : 0;
		if (overlap > DISCOVERY.MAX_OVERLAP - overlapMalus) return;

		if (signal.type === 'answer') {
			if (this.peerStore.addConnectingPeer(senderId, signal, offerHash) !== true) return;
			this.peerStore.assignSignal(senderId, signal, offerHash, CLOCK.time);
			return;
		}
		
		// AVOID SIMULATOR FLOODING, AND AVOID ALL PEERS TO PROCESS SAME OFFERS
		// => chance from 20% to 80% to ignore the offer depending on the queue length
		const ignoreChance = Math.min(0.2, this.offersQueue.length / this.maxOffers * 0.8);
		if (Math.random() < ignoreChance) return;

		// Set the OFFER signal at the right position > lower overlap first
		for (let i = 0; i < this.offersQueue.length; i++) {
			if (this.offersQueue[i].overlap > overlap) { // place new best => before
				this.offersQueue.splice(i, 0, { senderId, data, overlap, timestamp: CLOCK.time });
				if (this.offersQueue.length > this.maxOffers) this.offersQueue.pop();
				return;
			}
		}

		// still space in the queue, add it at the end
		if (this.offersQueue.length < this.maxOffers) this.offersQueue.push({ senderId, data, overlap, timestamp: CLOCK.time });
	}
	tryConnectNextBootstrap(neighboursCount = 0) {
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
	
	// INTERNAL METHODS
	#tryToSpreadSDP(nonPublicNeighborsCount = 0) { // LOOP TO SELECT ONE UNSEND READY OFFER AND BROADCAST IT
		if (nonPublicNeighborsCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT) return; // already too many neighbours
		// LIMIT OFFER SPREADING IF WE ARE CONNECTING TO MANY PEERS, LOWER GOSSIP TRAFFIC
		const connectingCount = Object.keys(this.peerStore.connecting).length;
		const ingPlusEd = connectingCount + nonPublicNeighborsCount;
		// BETTER TO NOT AVOID, BUT JUST SEND OFFER USING UNICAST WHILE WE ARE CONNECTED/ING

		let [ offerHash, readyOffer, since ] = [ null, null, null ];
		for (const [hash, offer] of Object.entries(this.peerStore.sdpOfferManager.offers)) {
			const { isUsed, sentCounter, signal, timestamp } = offer;
			if (isUsed || sentCounter > 0) continue; // already used or already sent at least once
			const createdSince = CLOCK.time - timestamp;
			if (createdSince > TRANSPORTS.SDP_OFFER_EXPIRATION / 2) continue; // old, don't spread
			if (since && createdSince > since) continue; // already have a better (more recent) offer
			readyOffer = offer; offerHash = hash; since = createdSince;
			break;
		}

		if (!offerHash || !readyOffer) return; // no ready offer to spread
		//const pond = 1 / Math.max(1, nonPublicNeighborsCount); // spend less offers depending on how many neighbours we have
		//if (Math.random() > pond) continue; // skip this time
		
		if (nonPublicNeighborsCount <= 1 && ingPlusEd < DISCOVERY.TARGET_NEIGHBORS_COUNT * 2) {
			this.gossip.broadcastToAll({ signal: readyOffer.signal, neighbours: this.peerStore.neighbours, offerHash }, 'signal_offer');
			readyOffer.sentCounter++; // avoid sending it again
			return; // limit to one per loop
		}

		// ALREADY CONNECTED, SEND USING UNICAST TO THE BEST 10 CANDIDATES
		let sentToCount = 0;
		const sentTo = {};
		const knowPeerIds = Object.keys(this.peerStore.known);
		for (let i = 0; i < Math.min(knowPeerIds.length, 50); i++) {
			const randomIndex = Math.random() * knowPeerIds.length | 0;
			const peerId = knowPeerIds[randomIndex];
			if (sentTo[peerId]) continue; // already sent to this one
			if (this.peerStore.connected[peerId]) continue; // skip connected peers
			if (this.#getOverlap(peerId, this.id) > DISCOVERY.MAX_OVERLAP * .8) continue; // only to peers with good chances to connect
			sentTo[peerId] = true;
			if (sentToCount++ === 0) readyOffer.sentCounter++; // avoid sending it again
			this.messager.sendUnicast(peerId, { signal: readyOffer.signal, neighbours: this.peerStore.neighbours, offerHash }, 'signal_offer', 1);
			if (sentToCount >= 20) break; // limit to 40 unicast
		}
	}
	/** @param {string} senderId @param {SignalData} data */
	#assignSignalIfConditionsMet(senderId, data) { // OFFER ONLY
		const { signal, offerHash, timestamp } = data || {}; // remoteInfo
		if (this.peerStore.connected[senderId]) return; // already connected
		if (signal.type !== 'offer') return;
		if (this.peerStore.connecting[senderId]?.['in']) return; // already connecting in
		if (this.isPublicNode || this.peerStore.isKicked(senderId)) return;
		
		const tooManyConnectingPeers = Object.keys(this.peerStore.connecting).length >= DISCOVERY.TARGET_NEIGHBORS_COUNT * 4;
		if (tooManyConnectingPeers) return; // avoid processing too many offers when we are already trying to connect to many peers

		if (this.peerStore.addConnectingPeer(senderId, signal, offerHash) !== true) return;
		this.peerStore.assignSignal(senderId, signal, offerHash, timestamp);
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
		for (const id of p1Neighbours)
			if (ignorePublic && id.startsWith(IDENTITY.PUBLIC_PREFIX)) continue;
			else for (const id2 of p2Neighbours) if (id === id2) { sharedNeighbours[id] = true; break; }

		return Object.keys(sharedNeighbours).length;
	}
	#improveTopologyByKickingPeers() { // KICK THE PEER WITH THE BIGGEST OVERLAP
		const connectedPeers = Object.entries(this.peerStore.connected);
		const peersWithOverlap = connectedPeers.map(([id, conn]) => [id, this.#getOverlap(id, this.id, true, 1)]);
		const sortedPeers = peersWithOverlap.sort((a, b) => b[1] - a[1]);
		this.peerStore.kickPeer(sortedPeers[0][0], 60_000);
	}
	#freePublicNodeByKickingPeers() { // PUBLIC NODES ONLY
		const { min, max } = NODE.SERVICE.AUTO_KICK_DELAY;
		const connectedPeers = Object.entries(this.peerStore.connected);
		const sortedPeers = connectedPeers.sort((a, b) => b[1].getConnectionDuration() - a[1].getConnectionDuration());
		let connectedPeersCount = connectedPeers.length;
		for (const [peerId, conn] of sortedPeers) {
			if (connectedPeersCount <= NODE.SERVICE.MAX_WS_IN_CONNS / 2) break;
			const delay = Math.round(Math.random() * (max - min) + min);
			if (conn.getConnectionDuration() < delay) continue;
			this.peerStore.kickPeer(peerId, NODE.SERVICE.AUTO_KICK_DURATION);
			connectedPeersCount--;
		}
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