import { CLOCK, GOSSIP, DISCOVERY } from './global_parameters.mjs';
import { xxHash32 } from '../libs/xxhash32.mjs';

export class GossipMessage { // TYPE DEFINITION
	topic = 'gossip';
	timestamp;
	neighborsList;
	HOPS;
	senderId;
	pubkey;
	data;
	signature;

	/** @param {string} topic @param {number} timestamp @param {string[]} neighborsList @param {number} HOPS @param {string} senderId @param {string} pubkey @param {string | Uint8Array | Object} data @param {string | undefined} signature */
	constructor(topic, timestamp, neighborsList, HOPS, senderId, pubkey, data, signature) { // PROBABLY DEPRECATED
		this.topic = topic; this.timestamp = timestamp; this.neighborsList = neighborsList;
		this.HOPS = HOPS; this.senderId = senderId; this.pubkey = pubkey; this.data = data;
		this.signature = signature;
	}
}

/** - 'BloomFilterCacheEntry' Definition
 * @typedef {Object} BloomFilterCacheEntry
 * @property {string} hash
 * @property {string} senderId
 * @property {string} topic
 * @property {Uint8Array} serializedMessage
 * @property {number} expiration
 */
class DegenerateBloomFilter {
	cryptoCodex;
	xxHash32UsageCount = 0;
	/** @type {Record<string, number>} */
	seenTimeouts = {}; // Map of message hashes to their expiration timestamps
	
	/** @type {BloomFilterCacheEntry[]} */ cache = [];
	cleanupFrequency = 100;
	cleanupIn = 100;
	cleanupDurationWarning = 10;

	/** @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex */
	constructor(cryptoCodex) { this.cryptoCodex = cryptoCodex; }

	// PUBLIC API
	/** @param {'asc' | 'desc'} order */
	getGossipHistoryByTime(order = 'asc') {
		const lightenHistory = this.cache.map(e => ({ senderId: e.senderId, topic: e.topic, data: e.serializedMessage }));
		return order === 'asc' ? lightenHistory : lightenHistory.reverse();
	}
	/** @param {Uint8Array} serializedMessage */
	addMessage(serializedMessage) {
    	const n = CLOCK.time;
		const { marker, neighLength, timestamp, dataLength, pubkey, associatedId } = this.cryptoCodex.readBufferHeader(serializedMessage);
		if (n - timestamp > GOSSIP.EXPIRATION) return;

		const hashableData = serializedMessage.subarray(0, 47 + neighLength + dataLength);
		const h = xxHash32(hashableData);
		this.xxHash32UsageCount++;
		if (this.seenTimeouts[h]) return;

		const topic = GOSSIP.MARKERS_BYTES[marker];
		const senderId = associatedId;
		const expiration = n + GOSSIP.CACHE_DURATION;
		this.cache.push({ hash: h, senderId, topic, serializedMessage, timestamp, expiration });
		this.seenTimeouts[h] = expiration;

		if (--this.cleanupIn <= 0) this.#cleanupOldestEntries(n);
		return { hash: h, isNew: !this.seenTimeouts[h] };
	}
	#cleanupOldestEntries(n = CLOCK.time) {
		let firstValidIndex = -1;
		for (let i = 0; i < this.cache.length; i++)
			if (this.cache[i].expiration <= n) delete this.seenTimeouts[this.cache[i].hash];
			else if (firstValidIndex === -1) firstValidIndex = i;
		
		if (firstValidIndex > 0) this.cache = this.cache.slice(firstValidIndex);
		else if (firstValidIndex === -1) this.cache = [];
		this.cleanupIn = this.cleanupFrequency;
	}
}

export class Gossip {
	cryptoCodex;
	verbose;
	id;
	peerStore;
	bloomFilter;
	/** @type {Record<string, Function[]>} */ callbacks = { message_handle: [] };
	
	/** @param {string} peerId @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {import('./peer-store.mjs').PeerStore} peerStore */
	constructor(peerId, cryptoCodex, peerStore, verbose = 0) {
		this.cryptoCodex = cryptoCodex;
		this.verbose = verbose;
		this.id = peerId;
		this.peerStore = peerStore;
		this.bloomFilter = new DegenerateBloomFilter(cryptoCodex);
	}

	/** @param {string} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) this.callbacks[callbackType] = [callback];
		else this.callbacks[callbackType].push(callback);
	}
	/** Gossip a message to all connected peers > will be forwarded to all peers
	 * @param {string | Uint8Array | Object} data @param {string} topic @param {number} [HOPS] */
	broadcastToAll(data, topic = 'gossip', HOPS) {
		const hops = HOPS || GOSSIP.HOPS[topic] || GOSSIP.HOPS.default;
		const neighbors = Object.keys(this.peerStore.connected);
		const serializedMessage = this.cryptoCodex.createGossipMessage(topic, data, hops, neighbors);
		if (!this.bloomFilter.addMessage(serializedMessage)) return; // avoid sending duplicate messages
		if (this.verbose > 3) console.log(`(${this.id}) Gossip ${topic}, to ${JSON.stringify(neighbors)}: ${data}`);
		for (const peerId of neighbors) this.#broadcastToPeer(peerId, serializedMessage);
	}
	/** @param {string} targetId @param {any} serializedMessage */
	#broadcastToPeer(targetId, serializedMessage) {
		if (targetId === this.id) throw new Error(`Refusing to send a gossip message to self (${this.id}).`);
		const transportInstance = this.peerStore.connected[targetId]?.transportInstance;
		if (!transportInstance) return { success: false, reason: `Transport instance is not available for peer ${targetId}.` };
		try { transportInstance.send(serializedMessage); }
		catch (error) { this.peerStore.connected[targetId]?.close(); }
	}
	sendGossipHistoryToPeer(peerId) {
		const gossipHistory = this.bloomFilter.getGossipHistoryByTime('asc');
		for (const entry of gossipHistory) this.#broadcastToPeer(peerId, entry.data);
	}
	/** @param {string} from @param {Uint8Array} serialized */
	handleGossipMessage(from, serialized) {
		if (this.peerStore.isBanned(from)) return; // ignore messages from banned peers
		for (const cb of this.callbacks.message_handle || []) cb(); // Simulator counter before filtering
		if (!this.bloomFilter.addMessage(serialized)) return; // already processed this message

		// ==> NOTE: WE SHOULD SIGN THE MESSAGE AND VERIFY THE SIGNATURE <==
		const message = this.cryptoCodex.readGossipMessage(serialized);
		if (!message) throw new Error(`Failed to deserialize gossip message from ${from}.`);
		
		const { topic, timestamp, neighborsList, HOPS, senderId, data } = message;
		
		if (this.verbose > 3)
			if (senderId === from) console.log(`(${this.id}) Gossip ${topic} from ${senderId}: ${data}`);
			else console.log(`(${this.id}) Gossip ${topic} from ${senderId} (by: ${from}): ${data}`);
		if (senderId === this.id) throw new Error(`#${this.id}#${from}# Received our own message back from peer ${from}.`);

		this.peerStore.digestPeerNeighbors(senderId, neighborsList);
		for (const cb of this.callbacks[topic] || []) cb(senderId, data, HOPS, message); // specific topic callback
		if (HOPS < 1) return; // stop forwarding if HOPS is 0

		const nCount = this.peerStore.neighborsList.length;
		const trm = Math.max(1, nCount / GOSSIP.TRANSMISSION_RATE.NEIGHBOURS_PONDERATION);
		const tRateBase = GOSSIP.TRANSMISSION_RATE[topic] || GOSSIP.TRANSMISSION_RATE.default;
		const transmissionRate = Math.pow(tRateBase, trm);
		const avoidTransmissionRate = nCount < GOSSIP.TRANSMISSION_RATE.MIN_NEIGHBOURS_TO_APPLY_PONDERATION;
		const serializedToTransmit = this.cryptoCodex.decrementGossipHops(serialized);
		for (const peerId of this.peerStore.neighborsList)
			if (peerId === from) continue; // avoid sending back to sender
			else if (!avoidTransmissionRate && Math.random() > transmissionRate) continue; // apply gossip transmission rate
			else this.#broadcastToPeer(peerId, serializedToTransmit);
	}
}