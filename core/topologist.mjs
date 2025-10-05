import { CLOCK } from '../services/clock.mjs';
import { SIMULATION, TRANSPORTS, NODE, DISCOVERY, GOSSIP } from './config.mjs';
import { PeerConnection } from './peer-store.mjs';
const { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } = SIMULATION.ENABLED ? await import('../simulation/test-transports.mjs') : {};

/**
 * @typedef {Object} SignalData
 * @property {Array<string>} neighbors
 * @property {Object} signal
 * @property {'offer' | 'answer'} signal.type
 * @property {string} signal.sdp
 * @property {string} [offerHash]
 * 
 * @typedef {Object} OfferQueueItem
 * @property {string} senderId
 * @property {SignalData} data
 * @property {number} overlap
 * @property {number} neighborsCount
 * @property {number} timestamp
 * */

class OfferQueue {
	maxOffers = 30;
	/** @type {Array<OfferQueueItem>} */ offers = [];
	/** @type {'overlap' | 'neighborsCount'} */ orderingBy = 'neighborsCount';
	get size() { return this.offers.length; }

	updateOrderingBy(isHalfTargetReached = false) { this.orderingBy = isHalfTargetReached ? 'overlap' : 'neighborsCount'; }
	removeOlderThan(age = 1000) { this.offers = this.offers.filter(item => item.timestamp + age >= CLOCK.time); }
	get bestOfferInfo() {
		const { senderId, overlap, neighborsCount, data, timestamp } = this.offers.shift() || {};
		return { senderId, data, timestamp, value: this.orderingBy === 'overlap' ? overlap : neighborsCount };
	}
	
	/** @param {OfferQueueItem} offer @param {boolean} isHalfTargetReached @param {{min: number, max: number}} [ignoringFactors] */
	pushSortTrim(offer, ignoringFactors = {min: .2, max: .8}) { // => 20%-80% to ignore the offer depending on the queue length
		const { min, max } = ignoringFactors; // AVOID SIMULATOR FLOODING, AND AVOID ALL PEERS TO PROCESS SAME OFFERS
		if (Math.random() < Math.min(min, this.offers.size / this.maxOffers * max)) return;

		this.offers.push(offer);
		if (this.offers.length === 1) return;

		// SORT THE QUEUE: by overlap ASCENDING, or by neighborsCount DESCENDING
		this.offers.sort((a, b) => this.orderingBy === 'overlap' ? a.overlap - b.overlap : b.neighborsCount - a.neighborsCount);
		if (this.size > this.maxOffers) this.offers.pop();
	}
}

export class Topologist {
	id; cryptoCodex; gossip; messager; peerStore; bootstraps;
	halfTarget = Math.ceil(DISCOVERY.TARGET_NEIGHBORS_COUNT / 2);
	twiceTarget = DISCOVERY.TARGET_NEIGHBORS_COUNT * 2;
	/** @type {Map<string, boolean>} */ bootstrapsConnectionState = new Map();

	get isPublicNode() { return this.services?.publicUrl ? true : false; }
	/** @type {import('./node-services.mjs').NodeServices | undefined} */ services;
	
	phase = 0;
	nextBootstrapIndex = 0;
	offersQueue = new OfferQueue();
	maxBonus = NODE.CONNECTION_UPGRADE_TIMEOUT * .2; // 20% of 15sec: 3sec max

	/** @param {string} selfId @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {import('./gossip.mjs').Gossip} gossip @param {import('./unicast.mjs').UnicastMessager} messager @param {import('./peer-store.mjs').PeerStore} peerStore @param {string[]} bootstraps */
	constructor(selfId, cryptoCodex, gossip, messager, peerStore, bootstraps) {
		this.id = selfId; this.cryptoCodex = cryptoCodex; this.gossip = gossip; this.messager = messager; this.peerStore = peerStore;
		for (const url of bootstraps) this.bootstrapsConnectionState.set(url, false);
		this.bootstraps = [...bootstraps].sort(() => Math.random() - 0.5); // shuffle
		this.nextBootstrapIndex = Math.random() * this.bootstraps.length | 0;
	}

	// PUBLIC METHODS
	tick() {
		const { neighborsCount, nonPublicNeighborsCount, isEnough, isTooMany, isHalfReached } = this.#localTopologyInfo;
		const offersToCreate = nonPublicNeighborsCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT / 3 ? 1 : TRANSPORTS.MAX_SDP_OFFERS;
		this.peerStore.offerManager.offersToCreate = isEnough ? 0 : offersToCreate;
		if (this.isPublicNode) { this.services.freePublicNodeByKickingPeers(); return; } // public nodes don't need more connections
		if (isTooMany) return Math.random() > .05 ? this.#improveTopologyByKickingPeers() : null;
		
		if (!isEnough) this.#digestBestOffers(); // => needs more peers
		else if (Math.random() > .05) this.#digestBestOffers(); // => sometimes, try topology improvement...
	
		this.phase = this.phase ? 0 : 1;
		if (this.phase === 0) this.tryConnectNextBootstrap(neighborsCount, nonPublicNeighborsCount);
		if (this.phase === 1) this.#tryToSpreadSDP(nonPublicNeighborsCount, isHalfReached);
	}
	/** @param {string} peerId @param {SignalData} data @param {number} [HOPS] */
	handleIncomingSignal(senderId, data, HOPS) {
		if (this.isPublicNode || !senderId || this.peerStore.isKicked(senderId)) return;
		if (data.signal?.type !== 'offer' && data.signal?.type !== 'answer') return;
		
		const { signal, offerHash } = data || {}; // remoteInfo
		const { connected, nonPublicNeighborsCount, isTooMany, isHalfReached } = this.#localTopologyInfo;
		if (isTooMany || connected[senderId]) return;

		if (signal.type === 'answer') { // ANSWER SHORT CIRCUIT => Rich should connect poor, and poor should connect rich.
			if (this.peerStore.addConnectingPeer(senderId, signal, offerHash) !== true) return;
			const delta = Math.abs(nonPublicNeighborsCount - this.#getOverlap(senderId).nonPublicCount);
			const bonusPerDeltaPoint = this.maxBonus / DISCOVERY.TARGET_NEIGHBORS_COUNT; // from 0 to maxBonus
			const bonus = Math.round(Math.min(this.maxBonus, delta * bonusPerDeltaPoint));
			return this.peerStore.assignSignal(senderId, signal, offerHash, CLOCK.time + bonus);
		}

		// OFFER
		if (nonPublicNeighborsCount > this.twiceTarget) return; // we are over connected, ignore the offer
		const { overlap, nonPublicCount } = this.#getOverlap(senderId);
		if (nonPublicCount > this.twiceTarget) return; // the sender is over connected, ignore the offer
		
		const offerItem = { senderId, data, overlap, neighborsCount: nonPublicCount, timestamp: CLOCK.time };
		this.offersQueue.updateOrderingBy(isHalfReached);
		this.offersQueue.pushSortTrim(offerItem);
	}
	tryConnectNextBootstrap(neighborsCount = 0, nonPublicNeighborsCount = 0) {
		if (this.bootstraps.length === 0) return;
		const publicConnectedCount = neighborsCount - nonPublicNeighborsCount;
		let connectingCount = 0;
		for (const id in this.peerStore.connecting) connectingCount++;

		// MINIMIZE BOOTSTRAP CONNECTIONS DEPENDING ON HOW MANY NEIGHBORS WE HAVE
		if (publicConnectedCount >= this.halfTarget) return; // already connected to enough bootstraps
		if (neighborsCount >= DISCOVERY.TARGET_NEIGHBORS_COUNT) return; // no more bootstrap needed
		if (connectingCount + nonPublicNeighborsCount > this.twiceTarget) return; // no more bootstrap needed

		const publicUrl = this.bootstraps[this.nextBootstrapIndex++ % this.bootstraps.length];
		if (this.bootstrapsConnectionState.get(publicUrl)) return; // already connecting/connected
		this.#connectToPublicNode(publicUrl);
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
		const result = { overlap: 0, nonPublicCount: 0, p1nCount: this.peerStore.getUpdatedPeerConnectionsCount(peerId1) };
		for (const id in p1n) if (!this.cryptoCodex.isPublicNode(id)) result.nonPublicCount++;
		for (const id of this.peerStore.standardNeighborsList) if (p1n[id]) result.overlap++;
		return result;
	}
	/** Get overlap information for multiple peers @param {string[]} peerIds */
	#getOverlaps(peerIds = []) { return peerIds.map(id => ({ id, ...this.#getOverlap(id) })); }
	#getFullWsUrl(url) {
		// Auto-detect protocol: use wss:// if in browser + HTTPS
		const isBrowser = typeof window !== 'undefined';
		const isSecure = isBrowser && window.location.protocol === 'https:';
		const protocol = isSecure ? 'wss://' : 'ws://';
		const hasWsSuffix = url.endsWith('/ws');
		const host = isBrowser && !hasWsSuffix ? window.location.host : url;

		// Build full URL if not already prefixed
		return url.startsWith('ws') ? url : `${protocol}${host}`;
	}
	#connectToPublicNode(publicUrl = 'localhost:8080') {
		let remoteId = null;
		const ws = new TRANSPORTS.WS_CLIENT(this.#getFullWsUrl(publicUrl)); ws.binaryType = 'arraybuffer';
		ws.onerror = (error) => console.error(`WebSocket error:`, error.stack);
		ws.onopen = () => {
			this.bootstrapsConnectionState.set(publicUrl, true);
			ws.onclose = () => {
				this.bootstrapsConnectionState.set(publicUrl, false);
				for (const cb of this.peerStore.callbacks.disconnect) cb(remoteId, 'out');
			}
			ws.onmessage = (data) => {
				if (remoteId) for (const cb of this.peerStore.callbacks.data) cb(remoteId, data.data);
				else { // FIRST MESSAGE SHOULD BE HANDSHAKE WITH ID
					const d = new Uint8Array(data.data); if (d[0] > 127) return; // not unicast, ignore
					const message = this.cryptoCodex.readUnicastMessage(d);
					if (!message) return; // invalid unicast message, ignore

					const { route, type, neighborsList } = message;
					if (type !== 'handshake' || route.length !== 2) return;

					const { signatureStart, pubkey, signature } = message;
					const signedData = d.subarray(0, signatureStart);
					if (!this.cryptoCodex.verifySignature(pubkey, signature, signedData)) return;

					remoteId = route[0];
					this.peerStore.digestPeerNeighbors(remoteId, neighborsList); // Update known store
					this.peerStore.connecting[remoteId]?.in?.close(); // close incoming connection if any
					if (!this.peerStore.connecting[remoteId]) this.peerStore.connecting[remoteId] = {};
					this.peerStore.connecting[remoteId].out = new PeerConnection(remoteId, ws, 'out', true);
					for (const cb of this.peerStore.callbacks.connect) cb(remoteId, 'out');
				}
			};
			ws.send(this.cryptoCodex.createUnicastMessage('handshake', null, [this.id, this.id], this.peerStore.neighborsList));
		};		
	}
	#tryToSpreadSDP(nonPublicNeighborsCount = 0, isHalfReached = false) { // LOOP TO SELECT ONE UNSEND READY OFFER AND BROADCAST IT
		if (!this.peerStore.neighborsList.length) return; // no neighbors, no need to spread offers
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
			const value = overlapInfo[isHalfReached ? 'overlap' : 'nonPublicCount'];
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
			if (id === this.id || this.cryptoCodex.isPublicNode(id) || this.peerStore.isKicked(id)) continue;
			else if (this.peerStore.connected[id] || this.peerStore.connecting[id]) continue;
			
			const { overlap, nonPublicCount } = this.#getOverlap(id);
			if (nonPublicCount > DISCOVERY.TARGET_NEIGHBORS_COUNT) continue; // the peer is over connected, ignore it
			if (bestValue === null) bestValue = isHalfReached ? overlap : nonPublicCount;
			if (isHalfReached && overlap > bestValue) continue; // only target lowest overlap
			if (!isHalfReached && nonPublicCount < bestValue) continue; // only target highest neighbors count
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
		let connectingCount = Object.keys(this.peerStore.connecting).length;
		this.offersQueue.updateOrderingBy(this.#localTopologyInfo.isHalfReached);
		this.offersQueue.removeOlderThan(TRANSPORTS.SDP_OFFER_EXPIRATION / 2); // remove close to expiration offers
		for (let i = 0; i < this.offersQueue.size; i++) {
			//if (connectingCount > this.twiceTarget * 2) break; // stop if we are over connecting
			const { senderId, data, timestamp, value } = this.offersQueue.bestOfferInfo;
			if (!senderId || !data || !timestamp) break;
			if (this.peerStore.connected[senderId] || this.peerStore.isKicked(senderId)) continue;
			if (this.peerStore.connecting[senderId]?.['in']) continue;
			bestValue = bestValue === null ? value : bestValue;
			if (bestValue !== value) break; // stop if the value is not the best anymore

			if (this.peerStore.addConnectingPeer(senderId, data.signal, data.offerHash) !== true) continue;
			this.peerStore.assignSignal(senderId, data.signal, data.offerHash, timestamp);
			connectingCount++;
		}
	}
	
	/** Kick the peer with the biggest overlap (any round of 2.5sec is isTooMany)
	 * - If all peers have the same overlap, kick the one with the most non-public neighbors */
	#improveTopologyByKickingPeers() {
		const overlaps = this.#getOverlaps(this.peerStore.standardNeighborsList);
		const sortedPeers = overlaps.sort((a, b) => b.overlap - a.overlap || b.nonPublicCount - a.nonPublicCount);
		this.peerStore.kickPeer(sortedPeers[0].id, 60_000, 'improveTopology');
	}
}