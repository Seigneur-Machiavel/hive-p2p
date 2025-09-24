import { CLOCK, SIMULATION, TRANSPORTS, NODE, DISCOVERY, GOSSIP } from './global_parameters.mjs';
import { PeerConnection } from './peer-store-utilities.mjs';
import { CryptoCodex } from './crypto-codex.mjs';
const { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } = SIMULATION.ENABLED ? await import('../simulation/test-transports.mjs') : {};

/**
 * @typedef {Object} SignalData
 * @property {Array<string>} neighbors
 * @property {Object} signal
 * @property {'offer' | 'answer'} signal.type
 * @property {string} signal.sdp
 * @property {string} [offerHash]
 * */

export class Topologist {
	/** @type {Array<{senderId: string, data: SignalData, overlap: number, neighborsCount: number, timestamp: number}>} */
	offersQueue = []; // OFFERS QUEUE
	maxOffers = 30; // max offers in the queue
	id;
	gossip;
	messager;
	peerStore;
	bootstraps;
	halfTarget = Math.ceil(DISCOVERY.TARGET_NEIGHBORS_COUNT / 2);
	twiceTarget = DISCOVERY.TARGET_NEIGHBORS_COUNT * 2;
	/** @type {Set<string>} */ bootstrapsIds = new Set();
	get isPublicNode() { return this.nodeServices?.publicUrl ? true : false; }
	/** @type {import('./node-services.mjs').NodeServices | undefined} */ nodeServices;

	nextBootstrapIndex = 0;
	phase = 0;

	/** @param {string} selfId @param {import('./gossip.mjs').Gossip} gossip @param {import('./unicast.mjs').UnicastMessager} messager @param {import('./peer-store.mjs').PeerStore} peerStore @param {Array<{id: string, publicUrl: string}>} bootstraps */
	constructor(selfId, gossip, messager, peerStore, bootstraps) {
		this.id = selfId; this.gossip = gossip; this.messager = messager; this.peerStore = peerStore;
		for (const bootstrap of bootstraps) this.bootstrapsIds.add(bootstrap.id);
		this.bootstraps = [...bootstraps].sort(() => Math.random() - 0.5); // shuffle
		this.nextBootstrapIndex = Math.random() * this.bootstrapsIds.size | 0;
	}

	// PUBLIC METHODS
	tick() {
		const { neighborsCount, nonPublicNeighborsCount, isEnough, isTooMany, isHalfReached } = this.#localTopologyInfo;
		const offersToCreate = nonPublicNeighborsCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT / 3 ? 1 : TRANSPORTS.MAX_SDP_OFFERS;
		this.peerStore.offerManager.offersToCreate = isEnough ? 0 : offersToCreate;
		if (this.isPublicNode) { this.nodeServices.freePublicNodeByKickingPeers(); return; } // public nodes don't need more connections
		if (isTooMany) { this.#improveTopologyByKickingPeers(); return; } // only kick if we have too many peers
		
		if (!isEnough) this.#digestBestOffers(); // => needs more peers
		else if (Math.random() > .2) this.#digestBestOffers(); // => sometimes, try topology improvement...
	
		this.phase = this.phase ? 0 : 1;
		if (this.phase === 0) this.tryConnectNextBootstrap(neighborsCount, nonPublicNeighborsCount);
		if (this.phase === 1) this.#tryToSpreadSDP(nonPublicNeighborsCount, isHalfReached);
	}
	/** @param {string} peerId @param {SignalData} data @param {number} [HOPS] */
	handleIncomingSignal(senderId, data, HOPS) {
		if (this.isPublicNode || !senderId || this.peerStore.isKicked(senderId)) return;
		const { signal, offerHash } = data || {}; // remoteInfo
		if (signal.type !== 'offer' && signal.type !== 'answer') return;

		const { connected, nonPublicNeighborsCount, isTooMany, isHalfReached } = this.#localTopologyInfo;
		if (isTooMany) return; // AVOID CONNECTING TO TOO MANY "NON-PUBLIC PEERS"
		if (connected[senderId]) return; // already connected
		if (signal.type === 'answer') { // ANSWER SHORT CIRCUIT
			if (this.peerStore.addConnectingPeer(senderId, signal, offerHash) !== true) return;
			const p1NonPublicCount = this.#getOverlap(senderId).p1NonPublicCount;
			const maxBonus = NODE.CONNECTION_UPGRADE_TIMEOUT * .2; // 20% of 15sec: 3sec max
			// Rich should connect poor, and poor should connect rich.
			const delta = Math.abs(nonPublicNeighborsCount - p1NonPublicCount);
			const bonusPerDeltaPoint = maxBonus / DISCOVERY.TARGET_NEIGHBORS_COUNT; // from 0 to maxBonus
			const bonus = Math.round(Math.min(maxBonus, delta * bonusPerDeltaPoint));
			this.peerStore.assignSignal(senderId, signal, offerHash, CLOCK.time + bonus);
			return;
		}
		
		// Set the OFFER signal at the right position:
		// > lower overlap first, if we have neighbors.
		// > higher non-public neighbors count first if we don't have neighbors
		// or if still space in the queue, add it at the end...
		// AVOID SIMULATOR FLOODING, AND AVOID ALL PEERS TO PROCESS SAME OFFERS
		if (nonPublicNeighborsCount > this.twiceTarget) return; // we are over connected, ignore the offer
		if (Math.random() < Math.min(0.2, this.offersQueue.length / this.maxOffers * 0.8)) return; // => 20%-80% to ignore the offer depending on the queue length
		const { overlap, p1NonPublicCount } = this.#getOverlap(senderId);
		if (p1NonPublicCount > this.twiceTarget) return; // the sender is over connected, ignore the offer
		for (let i = 0; i < this.offersQueue.length; i++) { // place new best => before
			const queueValue = this.offersQueue[i][isHalfReached ? 'overlap' : 'neighborsCount'];
			if (isHalfReached && queueValue <= overlap) continue;  // lowest overlap
			if (!isHalfReached && queueValue >= p1NonPublicCount) continue; // highest neighbors count
			this.offersQueue.splice(i, 0, { senderId, data, overlap, neighborsCount: p1NonPublicCount, timestamp: CLOCK.time });
			return this.offersQueue.length <= this.maxOffers ? null : this.offersQueue.pop();
		}
		if (this.offersQueue.length < this.maxOffers) this.offersQueue.push({ senderId, data, overlap, neighborsCount: p1NonPublicCount, timestamp: CLOCK.time });
	}
	tryConnectNextBootstrap(neighborsCount = 0, nonPublicNeighborsCount = 0) {
		if (this.bootstrapsIds.size === 0) return;
		const publicConnectedCount = neighborsCount - nonPublicNeighborsCount;
		let [connectingCount, publicConnectingCount] = [0, 0];
		for (const id in this.peerStore.connecting)
			if (this.bootstrapsIds.has(id)) publicConnectingCount++;
			else connectingCount++;

		// MINIMIZE BOOTSTRAP CONNECTIONS DEPENDING ON HOW MANY NEIGHBORS WE HAVE
		if (publicConnectedCount + publicConnectingCount >= this.halfTarget) return; // already connected to enough bootstraps
		if (nonPublicNeighborsCount + publicConnectedCount > DISCOVERY.TARGET_NEIGHBORS_COUNT) return; // no more bootstrap needed
		if (connectingCount + nonPublicNeighborsCount > this.twiceTarget) return; // no more bootstrap needed

		const { id, publicUrl } = this.bootstraps[this.nextBootstrapIndex++ % this.bootstrapsIds.size];
		if (id && publicUrl && (this.peerStore.connected[id] || this.peerStore.connecting[id])) return;
		this.#connectToPublicNode(id, publicUrl);
	}
	
	// INTERNAL METHODS
	get #localTopologyInfo() {
		return {
			connected: this.peerStore.connected,
			neighborsCount: this.peerStore.neighborsList.length,
			nonPublicNeighborsCount: this.peerStore.standardNeighborsList.length,
			isEnough: this.peerStore.standardNeighborsList.length >= DISCOVERY.TARGET_NEIGHBORS_COUNT,
			isTooMany: this.peerStore.standardNeighborsList.length > DISCOVERY.TARGET_NEIGHBORS_COUNT,
			isHalfReached: this.peerStore.standardNeighborsList.length >= this.halfTarget,
		}
	}
	#getOverlap(peerId1 = 'toto') {
		const p1n = this.peerStore.known[peerId1]?.neighbors || {};
		const result = { overlap: 0, p1NonPublicCount: 0, p1nCount: this.peerStore.getUpdatedPeerConnectionsCount(peerId1) };
		for (const id in p1n) if (!CryptoCodex.isPublicNode(id)) result.p1NonPublicCount++;
		for (const id of this.peerStore.standardNeighborsList) if (p1n[id]) result.overlap++;
		return result;
	}
	/** Get overlap information for multiple peers @param {string[]} peerIds */
	#getOverlaps(peerIds = []) { return peerIds.map(id => ({ id, ...this.#getOverlap(id) })); }
	#connectToPublicNode(remoteId = 'toto', publicUrl = 'localhost:8080') {
		if (!CryptoCodex.isPublicNode(remoteId)) return this.verbose < 1 ? null : console.warn(`Topologist: trying to connect to a non-public node (${remoteId})`);
		const ws = new TRANSPORTS.WS_CLIENT(publicUrl); ws.binaryType = 'arraybuffer';
		if (!this.peerStore.connecting[remoteId]) this.peerStore.connecting[remoteId] = {};
		this.peerStore.connecting[remoteId].out = new PeerConnection(remoteId, ws, 'out', true);
		ws.onerror = (error) => console.error(`WebSocket error:`, error.stack);
		ws.onopen = () => {
			ws.onclose = () => { for (const cb of this.peerStore.callbacks.disconnect) cb(remoteId, 'out'); }
			ws.onmessage = (data) => { for (const cb of this.peerStore.callbacks.data) cb(remoteId, data.data); };
			for (const cb of this.peerStore.callbacks.connect) cb(remoteId, 'out');
		};
	}
	#tryToSpreadSDP(nonPublicNeighborsCount = 0, isHalfReached = false) { // LOOP TO SELECT ONE UNSEND READY OFFER AND BROADCAST IT
		// LIMIT OFFER SPREADING IF WE ARE CONNECTING TO MANY PEERS, LOWER GOSSIP TRAFFIC
		const connectingCount = Object.keys(this.peerStore.connecting).length;
		const ingPlusEd = connectingCount + nonPublicNeighborsCount;
		
		// SELECT BEST READY OFFER BASED ON TIMESTAMP
		let [ offerHash, readyOffer, since ] = [ null, null, null ];
		for (const hash in this.peerStore.offerManager.offers) {
			const offer = this.peerStore.offerManager.offers[hash];
			const { isUsed, sentCounter, signal, timestamp } = offer;
			if (isUsed || sentCounter > 0) continue; // already used or already sent at least once
			const createdSince = CLOCK.time - timestamp;
			if (createdSince > TRANSPORTS.SDP_OFFER_EXPIRATION / 2) continue; // old, don't spread
			if (since && createdSince > since) continue; // already have a better (more recent) offer
			readyOffer = offer; offerHash = hash; since = createdSince;
			break;
		}
		if (!offerHash || !readyOffer) return; // no ready offer to spread

		// IF WE ARE CONNECTED TO LESS 2 (WRTC) AND NOT TO MUCH CONNECTING, WE CAN BROADCAST IT TO ALL
		if (!isHalfReached && ingPlusEd <= this.twiceTarget) {
			this.gossip.broadcastToAll({ signal: readyOffer.signal, offerHash }, 'signal_offer');
			readyOffer.sentCounter++; // avoid sending it again
			return; // limit to one per loop
		}
		
		let bestValue = null;
		for (const overlapInfo of this.#getOverlaps(this.peerStore.standardNeighborsList)) {
			const value = overlapInfo[isHalfReached ? 'overlap' : 'p1NonPublicCount'];
			if (bestValue === null) bestValue = value;
			if (isHalfReached && value < bestValue) bestValue = value;
			if (!isHalfReached && value <= bestValue) bestValue = value;
		}

		let maxIds = 100; let maxSearch = 1000; const knownCount = this.peerStore.knownCount;
		const r = Math.max(Math.min(maxSearch / knownCount, knownCount / maxSearch), .127);
		const selectedIds = []; // ELSE, SEND USING UNICAST TO THE BEST 10 CANDIDATES
		for (const id in this.peerStore.known) {
			if (Math.random() > r) continue; // randomize a bit the search
			if (--maxSearch <= 0) break;
			if (id === this.id || CryptoCodex.isPublicNode(id) || this.peerStore.isKicked(id)) continue;
			else if (this.peerStore.connected[id] || this.peerStore.connecting[id]) continue;
			
			const { overlap, p1NonPublicCount } = this.#getOverlap(id);
			if (p1NonPublicCount > DISCOVERY.TARGET_NEIGHBORS_COUNT) continue; // the peer is over connected, ignore it
			if (bestValue === null) bestValue = isHalfReached ? overlap : p1NonPublicCount;
			if (isHalfReached && overlap > bestValue) continue; // only target lowest overlap
			if (!isHalfReached && p1NonPublicCount < bestValue) continue; // only target highest neighbors count
			selectedIds.push(id);
			if (--maxIds <= 0) break;
		}
		if (!selectedIds.length) return;
		
		const sentTo = new Map();
		for (let i = 0; i < Math.min(selectedIds.length, 100); i++) {
			const peerId = selectedIds[Math.floor(Math.random() * selectedIds.length)];
			if (sentTo.has(peerId)) continue;
			if (sentTo.size === 0) readyOffer.sentCounter++;
			sentTo.set(peerId, true);
			this.messager.sendUnicast(peerId, { signal: readyOffer.signal, offerHash }, 'signal_offer', 1);
			if (sentTo.size >= 12) break; // limit to 12 unicast max
		}
	}
	/** Process signal_offer queue by filtering fresh offers and answering these with best:
	 * - Lowest overlap if we already have neighbors 
	 * - Highest neighbors count if we don't */
	#digestBestOffers() {
		let bestValue = null;
		const now = CLOCK.time;
		const nonPublicNeighborsCount = this.peerStore.standardNeighborsList.length;
		let connectingCount = Object.keys(this.peerStore.connecting).length;
		this.offersQueue = this.offersQueue.filter(item => item.timestamp + (TRANSPORTS.SDP_OFFER_EXPIRATION / 2) >= now);
		for (let i = 0; i < this.offersQueue.length; i++) { // SELECT BEST
			if (connectingCount >= this.twiceTarget * 2) break; // avoid processing too many offers when we are already trying to connect to many peers
			const { senderId, overlap, neighborsCount, data, timestamp } = this.offersQueue.shift() || {};
			if (!senderId || this.peerStore.connected[senderId] || this.peerStore.isKicked(senderId)) continue;
			if (this.peerStore.connecting[senderId]?.['in']) continue;
			if (bestValue === null) bestValue = nonPublicNeighborsCount ? overlap : neighborsCount;
			if (nonPublicNeighborsCount && overlap > bestValue) continue;
			if (!nonPublicNeighborsCount && neighborsCount < bestValue) continue;
			if (this.peerStore.addConnectingPeer(senderId, data.signal, data.offerHash) !== true) continue;
			this.peerStore.assignSignal(senderId, data.signal, data.offerHash, timestamp);
			connectingCount++;
			if (bestValue === null) bestValue = nonPublicNeighborsCount ? overlap : neighborsCount;
		}
	}
	/** Kick the peer with the biggest overlap (any round of 2.5sec is isTooMany)
	 * - If all peers have the same overlap, kick the one with the most non-public neighbors */
	#improveTopologyByKickingPeers() {
		if (Math.random() > 0.127) return;
		const overlaps = this.#getOverlaps(this.peerStore.standardNeighborsList);
		const sortedPeers = overlaps.sort((a, b) => {
			if (b.overlap !== a.overlap) return b.overlap - a.overlap;
			return b.p1NonPublicCount - a.p1NonPublicCount;
		});
		this.peerStore.kickPeer(sortedPeers[0].id, 60_000, 'improveTopology');
	}
}