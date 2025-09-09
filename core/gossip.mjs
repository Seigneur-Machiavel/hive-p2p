import { GOSSIP } from './global_parameters.mjs';
import { xxHash32 } from '../utils/xxhash32.mjs';

/**
 * @typedef {import('./peer-store.mjs').PeerStore} PeerStore
 */

export class GossipMessage {
	/** @type {string} */ senderId;
	/** @type {string} */ topic;
	/** @type {string | Uint8Array} */ data;
	/** @type {number} */ timestamp;
	/** @type {number} */ TTL;

	/** @param {string} senderId @param {string} topic @param {string | Uint8Array} data
	 * @param {number} timestamp @param {number} [TTL] default: 3 */
	static serialize(senderId, topic, data, timestamp, TTL = 3) {
		return 'G' + GOSSIP.SERIALIZER({ senderId, topic, data, timestamp, TTL });
	}
	static deserialize(serialized) {
		return GOSSIP.DESERIALIZER(serialized.slice(1));
	}
}

/**
 * @typedef {Object} BloomFilterCacheEntry
 * @property {string} hash
 * @property {string} senderId
 * @property {string} topic
 * @property {string | Uint8Array} data
 * @property {number} expiration
 */
class DegenerateBloomFilter {
	xxHash32UsageCount = 0;
	/** @type {Record<string, number>} */
	seenTimeouts = {}; // Map of message hashes to their expiration timestamps

	/** @type {BloomFilterCacheEntry[]} */ cache = [];
	#cacheStartIndex = 0;
	cleanupDurationWarning = 10;

	// PUBLIC API
	addMessage(senderId, topic, data, timestamp) {
		const n = Date.now();
		if (n - timestamp > GOSSIP.EXPIRATION) return; // ignore expired messages
		const h = xxHash32(`${senderId}${topic}${JSON.stringify(data)}`);
		this.xxHash32UsageCount++;
		let forwardMessage = true;
		if (this.seenTimeouts[h] && n < this.seenTimeouts[h]) forwardMessage = false; // already exists and not expired
		else this.#addEntry(senderId, topic, data, timestamp, h, n + GOSSIP.CACHE_DURATION);
		this.#cleanupOldestEntries(n); // cleanup expired cache
		
		//if (this.xxHash32UsageCount % 1000 === 0) console.log(`xxHash32 usage count: ${this.xxHash32UsageCount}, cache size: ${this.cache.length}`);
		return forwardMessage;
	}
	/** @param {'asc' | 'desc'} order */
	getGossipHistoryByTime(order = 'asc') {
		if (this.#cacheStartIndex >= this.cache.length) return [];
		const activeCache = this.cache.slice(this.#cacheStartIndex);
		const lightenHistory = activeCache.map(e => ({ senderId: e.senderId, topic: e.topic, data: e.data }));
		return order === 'asc' ? lightenHistory : lightenHistory.reverse();
	}

	// PRIVATE METHODS
	#addEntry(senderId, topic, data, timestamp, hash, expiration) {
		this.seenTimeouts[hash] = expiration;
		this.cache.push({ hash, senderId, topic, data, timestamp, expiration });
	}
	#cleanupOldestEntries(n = Date.now()) {
		while (this.#cacheStartIndex < this.cache.length && 
		       this.cache[this.#cacheStartIndex].expiration < n) {
			delete this.seenTimeouts[this.cache[this.#cacheStartIndex].hash];
			this.#cacheStartIndex++;
		}

		// Periodic compaction to prevent the cache from becoming too large
		if (this.#cacheStartIndex <= this.cache.length / 2) return;
		this.cache = this.cache.slice(this.#cacheStartIndex);
		this.#cacheStartIndex = 0;
	}
}
export class Gossip {
	id;
	peerStore;
	bloomFilter = new DegenerateBloomFilter();
	/** @type {Record<string, Function[]>} */ callbacks = {};

	/** @param {string} peerId @param {PeerStore} peerStore */
	constructor(peerId, peerStore) {
		this.id = peerId;
		this.peerStore = peerStore;
	}

	/** @param {string} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) this.callbacks[callbackType] = [callback];
		else this.callbacks[callbackType].unshift(callback);
	}
	/** Gossip a message to all connected peers > will be forwarded to all peers
	 * @param {string} topic @param {string | Uint8Array} data @param {number} [timestamp]
	 * @param {string} [targetId] @param {number} [ttl] */
	broadcast(topic, data, targetId, timestamp = Date.now(), ttl) {
		this.bloomFilter.addMessage(this.id, topic, data, timestamp); // avoid re-processing our own message
		const serializedData = GossipMessage.serialize(this.id, topic, data, timestamp, ttl || GOSSIP.TTL[topic] || GOSSIP.TTL.default);
		if (targetId) return this.#broadcastToPeer(targetId, serializedData);
		for (const peerId in this.peerStore.connected) this.#broadcastToPeer(peerId, serializedData);
	}
	/** @param {string} targetId @param {any} serializedData */
	#broadcastToPeer(targetId, serializedData) {
		const transportInstance = this.peerStore.connected[targetId]?.transportInstance;
		if (!transportInstance) return { success: false, reason: `Transport instance is not available for peer ${targetId}.` };
		try { transportInstance.send(serializedData); }
		catch (error) { this.peerStore.connected[targetId]?.close(); }
	}
	/** @param {string} from @param {GossipMessage} message @param {string | Uint8Array} serializedMessage @param {number} [verbose] */
	handleGossipMessage(from, message, serializedMessage, verbose = 0) {
		if (this.peerStore.isBanned(from)) return; // ignore messages from banned peers

		// HERE WE DECRYPT MESSAGE WITH (pubKey === 'from')
		const { senderId, topic, data, timestamp, TTL } = message;
		for (const cb of this.callbacks['message_handle'] || []) cb(senderId, data); // mainly used in debug
		if (this.bloomFilter.addMessage(senderId, topic, data, timestamp) === false) return; // already processed this message
		for (const cb of this.callbacks[topic] || []) cb(senderId, data);

		if (TTL < 1) return; // stop forwarding if TTL is 0
		if (this.id === senderId) return; // avoid sending our own message again
		if (topic === 'hello_public') return { senderId: from, forwardedTo: 0, TTL, transmissionRate: 0 };

		const neighbours = Object.entries(this.peerStore.connected);
		const nCount = neighbours.length;
		const trm = Math.max(1, nCount / GOSSIP.TRANSMISSION_RATE_MOD);
		const tRateBase = GOSSIP.TRANSMISSION_RATE[topic] || GOSSIP.TRANSMISSION_RATE.default;
		const transmissionRate = Math.pow(tRateBase, trm);
		const avoidTransmissionRate = nCount < GOSSIP.MIN_NEIGHBOURS_TO_APPLY_TRANSMISSION_RATE; // 4: true, 5: false
		const messageWithDecrementedTTL = GossipMessage.serialize(senderId, topic, data, timestamp, TTL - 1);
		for (const [peerId, conn] of neighbours) {
			if (peerId === from) continue; // avoid sending back to sender
			if (!avoidTransmissionRate && Math.random() > transmissionRate) continue; // apply gossip transmission rate
			this.#broadcastToPeer(peerId, messageWithDecrementedTTL);
		}

		return { senderId: from, forwardedTo: nCount, TTL, transmissionRate };
	}
}