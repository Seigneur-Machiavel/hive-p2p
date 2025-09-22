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
 * */

export class NetworkEnhancer {
	/** @type {Array<{senderId: string, data: SignalData, overlap: number, timestamp: number}>} */
	offersQueue = []; // OFFERS QUEUE
	maxOffers = 20; // max offers in the queue
	id;
	gossip;
	messager;
	peerStore;
	bootstraps;
	get isPublicNode() { return this.nodeServices?.publicUrl ? true : false; }
	/** @type {import('./node-services.mjs').NodeServices | undefined} */ nodeServices;
	/** @type {Record<string, string>} */ bootstrapsIds = {}; // faster ".has()"

	nextBootstrapIndex = 0;
	phase = 0;

	/** @param {string} selfId @param {import('./gossip.mjs').Gossip} gossip @param {import('./unicast.mjs').UnicastMessager} messager @param {import('./peer-store.mjs').PeerStore} peerStore @param {Array<{id: string, publicUrl: string}>} bootstraps */
	constructor(selfId, gossip, messager, peerStore, bootstraps) {
		this.id = selfId; this.gossip = gossip; this.messager = messager; this.peerStore = peerStore;
		for (const id in bootstraps) this.bootstrapsIds[id] = true;
		this.bootstraps = [...bootstraps].sort(() => Math.random() - 0.5); // shuffle
		this.nextBootstrapIndex = Math.random() * bootstraps.length | 0;
	}

	// PUBLIC METHODS
	autoEnhancementTick() {
		const { neighborsCount, nonPublicNeighborsCount, isEnough, isTooMany } = this.#localTopologyInfo;
		if (isEnough) this.offersQueue = []; // clear offers queue if we have enough neighbors
		const offersToCreate = nonPublicNeighborsCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT / 3 ? 1 : TRANSPORTS.MAX_SDP_OFFERS;
		this.peerStore.offerManager.offersToCreate = isEnough ? 0 : offersToCreate;
		if (this.isPublicNode) { this.nodeServices.freePublicNodeByKickingPeers(); return; } // public nodes don't need more connections
		if (isEnough) { this.#improveTopologyByKickingPeers(isTooMany); return; } // only kick if we have too many peers
		
		const now = CLOCK.time; // CLEANUP OLD OFFERS IN QUEUE
		let bestOverlap = null; // PROCESS SIGNAL_OFFER QUEUE
		this.offersQueue = this.offersQueue.filter(item => item.timestamp + (TRANSPORTS.SDP_OFFER_EXPIRATION / 2) >= now);
		for (let i = 0; i < Math.min(this.offersQueue.length, 3); i++) {
			const signalItem = this.offersQueue.shift(); // SELECT BEST
			if (bestOverlap !== null && signalItem.overlap > bestOverlap) break;
			this.#assignSignalIfConditionsMet(signalItem.senderId, signalItem.data);
			bestOverlap = signalItem.overlap;
		}
	
		this.phase = this.phase ? 0 : 1;
		if (this.phase === 0) this.tryConnectNextBootstrap(neighborsCount);
		if (this.phase === 1) this.#tryToSpreadSDP(nonPublicNeighborsCount);
	}
	/** @param {string} peerId @param {SignalData} data @param {number} [HOPS] */
	handleIncomingSignal(senderId, data, HOPS) {
		if (this.isPublicNode || !senderId || this.peerStore.isKicked(senderId)) return;
		if (HOPS !== undefined && HOPS >= GOSSIP.HOPS.signal_offer - 1) return; // easy topology improvement
		const { signal, offerHash } = data || {}; // remoteInfo
		if (signal.type !== 'offer' && signal.type !== 'answer') return;

		const { connected, isTooMany } = this.#localTopologyInfo;
		if (isTooMany) return; // AVOID CONNECTING TO TOO MANY "NON-PUBLIC PEERS"
		if (connected[senderId]) return; // already connected
		if (signal.type === 'answer' && this.peerStore.connecting[senderId]?.['out']) return; // already connecting out
		const overlap = this.#getOverlap(senderId).sharedCount;
		if (overlap > DISCOVERY.MAX_OVERLAP - (isTooMany / 2 ? 1 : 0)) return;
		if (signal.type === 'answer') { // ANSWER SHORT CIRCUIT
			if (this.peerStore.addConnectingPeer(senderId, signal, offerHash) !== true) return;
			this.peerStore.assignSignal(senderId, signal, offerHash, CLOCK.time);
			return;
		}
		
		// Set the OFFER signal at the right position > lower overlap first || or if still space in the queue, add it at the end
		// AVOID SIMULATOR FLOODING, AND AVOID ALL PEERS TO PROCESS SAME OFFERS
		if (Math.random() < Math.min(0.2, this.offersQueue.length / this.maxOffers * 0.8)) return; // => 20%-80% to ignore the offer depending on the queue length
		for (let i = 0; i < this.offersQueue.length; i++) { // place new best => before
			if (this.offersQueue[i].overlap <= overlap) continue;
			this.offersQueue.splice(i, 0, { senderId, data, overlap, timestamp: CLOCK.time });
			return this.offersQueue.length <= this.maxOffers ? null : this.offersQueue.pop();
		}
		if (this.offersQueue.length < this.maxOffers) this.offersQueue.push({ senderId, data, overlap, timestamp: CLOCK.time });
	}
	tryConnectNextBootstrap(neighborsCount = 0) {
		if (this.bootstraps.length === 0) return;
		const [connected, connecting] = [this.peerStore.connected, this.peerStore.connecting];
		const connectedCount = this.peerStore.neighborsList.filter(id => this.bootstrapsIds[id]).length;
		const connectingCount = [];
		for (const id in connecting) if (this.bootstrapsIds[id]) connectingCount.push(id);

		// MINIMIZE BOOTSTRAP CONNECTIONS DEPENDING ON HOW MANY NEIGHBOURS WE HAVE
		if (connectedCount + connectingCount >= NODE.SERVICE.MAX_WS_OUT_CONNS) return; // already connected to enough bootstraps
		if (connectedCount && neighborsCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT / 2) return; // no more bootstrap needed (half of target)
		if (connectingCount && neighborsCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT / 2) return; // no more bootstrap needed (half of target)
		
		const { id, publicUrl } = this.bootstraps[this.nextBootstrapIndex];
		const canMakeATry = id && publicUrl && !connected[id] && !connecting[id];
		if (canMakeATry) this.#connectToPublicNode(id, publicUrl);
		this.nextBootstrapIndex = (this.nextBootstrapIndex + 1) % this.bootstraps.length;
	}
	
	// INTERNAL METHODS
	get #localTopologyInfo() {
		return {
			connected: this.peerStore.connected,
			neighborsCount: this.peerStore.neighborsList.length,
			nonPublicNeighborsCount: this.peerStore.standardNeighborsList.length,
			isEnough: this.peerStore.standardNeighborsList.length >= DISCOVERY.TARGET_NEIGHBORS_COUNT,
			isTooMany: this.peerStore.standardNeighborsList.length > DISCOVERY.TARGET_NEIGHBORS_COUNT,
		}
	}
	#getOverlap(peerId1 = 'toto') {
		const p1n = this.peerStore.known[peerId1]?.neighbors || {};
		const result = { sharedCount: 0, p1nCount: 0, p2nCount: this.peerStore.standardNeighborsList.length };
		for (const id in p1n) if (!CryptoCodex.isPublicNode(id)) result.p1nCount++;
		for (const id of this.peerStore.standardNeighborsList) if (p1n[id]) result.sharedCount++;
		return result;
	}
	#connectToPublicNode(remoteId = 'toto', publicUrl = 'localhost:8080') {
		if (!CryptoCodex.isPublicNode(remoteId)) return this.verbose < 1 ? null : console.warn(`NetworkEnhancer: trying to connect to a non-public node (${remoteId})`);
		const ws = new TRANSPORTS.WS_CLIENT(publicUrl); ws.binaryType = 'arraybuffer';
		this.peerStore.connecting[remoteId] = { out: new PeerConnection(remoteId, ws, 'out', true) };
		ws.onerror = (error) => console.error(`WebSocket error:`, error.stack);
		ws.onopen = () => {
			ws.onclose = () => { for (const cb of this.peerStore.callbacks.disconnect) cb(remoteId, 'out'); }
			ws.onmessage = (data) => { for (const cb of this.peerStore.callbacks.data) cb(remoteId, data.data); };
			for (const cb of this.peerStore.callbacks.connect) cb(remoteId, 'out');
		};
	}
	#tryToSpreadSDP(nonPublicNeighborsCount = 0) { // LOOP TO SELECT ONE UNSEND READY OFFER AND BROADCAST IT
		if (nonPublicNeighborsCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT) return; // already too many neighbors
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

		// IF WE ARE CONNECTED TO LESS 1 (WRTC) AND NOT TO MUCH CONNECTING, WE CAN BROADCAST IT TO ALL
		if (nonPublicNeighborsCount <= 1 && ingPlusEd < DISCOVERY.TARGET_NEIGHBORS_COUNT * 2) {
			this.gossip.broadcastToAll({ signal: readyOffer.signal, offerHash }, 'signal_offer');
			readyOffer.sentCounter++; // avoid sending it again
			return; // limit to one per loop
		}
		
		const knownPeerIds = []; // ELSE, SEND USING UNICAST TO THE BEST 10 CANDIDATES
		for (const id in this.peerStore.known)
			if (id === this.id || CryptoCodex.isPublicNode(id) || this.peerStore.isKicked(id)) continue;
			else if (this.peerStore.connected[id] || this.peerStore.connecting[id]) continue;
			else knownPeerIds.push(id);
		if (!knownPeerIds.length) return;
		
		const sentTo = new Map();
		for (let i = 0; i < Math.min(knownPeerIds.length, 100); i++) {
			const peerId = knownPeerIds[Math.floor(Math.random() * knownPeerIds.length)];
			if (sentTo.has(peerId) || this.#getOverlap(peerId).sharedCount > DISCOVERY.MAX_OVERLAP * .8) continue;
			if (sentTo.size === 0) readyOffer.sentCounter++;
			sentTo.set(peerId, true);
			this.messager.sendUnicast(peerId, { signal: readyOffer.signal, offerHash }, 'signal_offer', 1);
			if (sentTo.size >= 10) break; // limit to 10 unicast
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
	#improveTopologyByKickingPeers(isTooMany = false) { // KICK THE PEER WITH THE BIGGEST OVERLAP
		if (Math.random() > .027) return; // avoid kicking too often
		const peersWithOverlapInfo = [];
		let lastOverlap = null; // If all overlap are identical, we will sort by connections count
		let sortingIndex = 2; // 1: by overlap, 2: by connections count
		for (const id of this.peerStore.standardNeighborsList) {
			const overlapInfo = this.#getOverlap(id);
			if (overlapInfo.sharedCount > DISCOVERY.MAX_OVERLAP) { // SHORT CIRCUIT
				this.peerStore.kickPeer(id, 60_000, 'improveTopology');
				break; // only one at a time
			}
			peersWithOverlapInfo.push([id, overlapInfo.sharedCount, overlapInfo.p1nCount]);
			if (lastOverlap === null) lastOverlap = overlapInfo.sharedCount;
			else if (lastOverlap !== overlapInfo.sharedCount) sortingIndex = 1;
		}
		if (!isTooMany) return; // only kick if we have too many peers
		const sortedPeers = peersWithOverlapInfo.sort((a, b) => b[sortingIndex] - a[sortingIndex]);
		this.peerStore.kickPeer(sortedPeers[0][0], 60_000, 'improveTopology');
	}
}