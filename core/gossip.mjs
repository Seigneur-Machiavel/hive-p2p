import { GOSSIP } from './global_parameters.mjs';
import { xxHash32 } from '../utils/xxhash32.mjs';

export class GossipMessage {
	topic = 'gossip';
	timestamp;
	HOPS;
	senderId;
	pubkey;
	data;
	signature;

	/** @param {string} topic @param {number} timestamp @param {number} HOPS @param {string} senderId @param {string} pubkey @param {string | Uint8Array | Object} data @param {string | undefined} signature */
	constructor(topic, timestamp, HOPS, senderId, pubkey, data, signature) { // PROBABLY DEPRECATED
		this.topic = topic; this.timestamp = timestamp; this.HOPS = HOPS;
		this.senderId = senderId; this.pubkey = pubkey; this.data = data;
		this.signature = signature;
	}
}

/** - 'BloomFilterCacheEntry' Definition
 * @typedef {Object} BloomFilterCacheEntry
 * @property {string} hash
 * @property {string} senderId
 * @property {string} topic
 * @property {string | Uint8Array | Object} data
 * @property {number} expiration
 */

class DegenerateBloomFilter {
	xxHash32UsageCount = 0;
	/** @type {Record<string, number>} */
	seenTimeouts = {}; // Map of message hashes to their expiration timestamps
	
	/** @type {BloomFilterCacheEntry[]} */ cache = [];
	cleanupFrequency = 100;
	cleanupIn = 100;
	cleanupDurationWarning = 10;

	// PUBLIC API
	/** @param {'asc' | 'desc'} order */
	getGossipHistoryByTime(order = 'asc') {
		const lightenHistory = this.cache.map(e => ({ senderId: e.senderId, topic: e.topic, data: e.data }));
		return order === 'asc' ? lightenHistory : lightenHistory.reverse();
	}
	addMessage(senderId, topic, data, timestamp) {
    	const n = Date.now();
		if (n - timestamp > GOSSIP.EXPIRATION) return;

		const h = xxHash32(`${senderId}${topic}${JSON.stringify(data)}`);
		this.xxHash32UsageCount++;
		if (this.seenTimeouts[h]) return;

		const expiration = n + GOSSIP.CACHE_DURATION;
		this.cache.push({ hash: h, senderId, topic, data, timestamp, expiration });
		this.seenTimeouts[h] = expiration;

		if (--this.cleanupIn <= 0) this.#cleanupOldestEntries(n);
		return { hash: h, isNew: !this.seenTimeouts[h] };
	}
	#cleanupOldestEntries(n = Date.now()) {
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
	cryptoCodec;
	verbose;
	id;
	peerStore;
	bloomFilter = new DegenerateBloomFilter();
	/** @type {Record<string, Function[]>} */ callbacks = { message_handle: [] };

	/** @param {string} peerId @param {import('./crypto-codec.mjs').CryptoCodec} cryptoCodec @param {import('./peer-store.mjs').PeerStore} peerStore */
	constructor(peerId, cryptoCodec, peerStore, verbose = 0) {
		this.cryptoCodec = cryptoCodec;
		this.verbose = verbose;
		this.id = peerId;
		this.peerStore = peerStore;
	}

	/** @param {string} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) this.callbacks[callbackType] = [callback];
		else this.callbacks[callbackType].push(callback);
	}
	/** Gossip a message to all connected peers > will be forwarded to all peers
	 * @param {string | Uint8Array | Object} data @param {string} topic @param {number} [HOPS] */
	broadcastToAll(data, topic = 'gossip', HOPS) {
		const timestamp = Date.now();
		if (!this.bloomFilter.addMessage(this.id, topic, data, timestamp)) return; // avoid re-processing our own message
		
		const hops = HOPS || GOSSIP.HOPS[topic] || GOSSIP.HOPS.default;
		const serializedData = this.cryptoCodec.createGossipMessage(topic, data, hops);
		const targetIds = Object.keys(this.peerStore.connected);
		if (this.verbose > 3) console.log(`(${this.id}) Gossip ${topic}, to ${JSON.stringify(targetIds)}: ${data}`);
		for (const peerId of targetIds) this.#broadcastToPeer(peerId, serializedData);
	}
	/** @param {string} targetId @param {any} serializedData */
	#broadcastToPeer(targetId, serializedData) {
		if (targetId === this.id) throw new Error(`Refusing to send a gossip message to self (${this.id}).`);
		const transportInstance = this.peerStore.connected[targetId]?.transportInstance;
		if (!transportInstance) return { success: false, reason: `Transport instance is not available for peer ${targetId}.` };
		try { transportInstance.send(serializedData); }
		catch (error) { this.peerStore.connected[targetId]?.close(); }
	}
	/** @param {string} from @param {string | Uint8Array | Object} serialized */
	handleGossipMessage(from, serialized) {
		if (this.peerStore.isBanned(from)) return; // ignore messages from banned peers

		// ==> NOTE: WE SHOULD SIGN THE MESSAGE AND VERIFY THE SIGNATURE <==
		const message = this.cryptoCodec.readGossipMessage(serialized);
		if (!message) throw new Error(`Failed to deserialize gossip message from ${from}.`);
		
		const { topic, timestamp, HOPS, senderId, data } = message;
		for (const cb of this.callbacks.message_handle || []) cb(senderId, data); // Simulator counter is placed here
		if (!this.bloomFilter.addMessage(senderId, topic, data, timestamp)) return; // already processed this message
		
		if (this.verbose > 3)
			if (senderId === from) console.log(`(${this.id}) Gossip ${topic} from ${senderId}: ${data}`);
			else console.log(`(${this.id}) Gossip ${topic} from ${senderId} (by: ${from}): ${data}`);
		if (senderId === this.id) throw new Error(`#${this.id}#${from}# Received our own message back from peer ${from}.`);

		for (const cb of this.callbacks[topic] || []) cb(senderId, data); // specific topic callback
		if (HOPS < 1) return; // stop forwarding if HOPS is 0

		const neighbours = Object.entries(this.peerStore.connected);
		const nCount = neighbours.length;
		const trm = Math.max(1, nCount / GOSSIP.TRANSMISSION_RATE.NEIGHBOURS_PONDERATION);
		const tRateBase = GOSSIP.TRANSMISSION_RATE[topic] || GOSSIP.TRANSMISSION_RATE.default;
		const transmissionRate = Math.pow(tRateBase, trm);
		const avoidTransmissionRate = nCount < GOSSIP.TRANSMISSION_RATE.MIN_NEIGHBOURS_TO_APPLY_PONDERATION;
		//const messageWithDecrementedHOPS = new GossipMessage(topic, timestamp, HOPS - 1, senderId, message.pubkey, data);
		const serializedToTransmit = this.cryptoCodec.decrementGossipHops(serialized);
		for (const [peerId, conn] of neighbours) {
			if (peerId === from) continue; // avoid sending back to sender
			if (!avoidTransmissionRate && Math.random() > transmissionRate) continue; // apply gossip transmission rate
			this.#broadcastToPeer(peerId, serializedToTransmit);
		}

		return { from, senderId };
	}
}