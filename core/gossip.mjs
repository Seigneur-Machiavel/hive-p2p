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
		if (n - timestamp > GOSSIP.EXPIRATION) return; // ignore expired messages
		const h = xxHash32(`${senderId}${topic}${JSON.stringify(data)}`);
		this.xxHash32UsageCount++;

		const isPresent = this.seenTimeouts[h];
		const isExpired = this.seenTimeouts[h] && n >= this.seenTimeouts[h];
		if (isPresent && !isExpired) return; // already exists and not expired
		
		const expiration = n + GOSSIP.CACHE_DURATION;
		if (!isPresent) this.cache.push({ hash: h, senderId, topic, data, timestamp, expiration });
		this.seenTimeouts[h] = expiration;

		if (--this.cleanupIn > 0) return { hash: h, isExpired, isPresent };

		this.#cleanupOldestEntries(n); // cleanup expired cache
		this.cleanupIn = this.cleanupFrequency;
		return { hash: h, isExpired, isPresent };
	}

	#cleanupOldestEntries(n = Date.now()) {
		for (let i = 0; i < this.cache.length; i++)
			if (this.cache[i].expiration <= n) delete this.seenTimeouts[this.cache[i].hash];
			else if (i) return this.cache = this.cache.slice(i);
			else return; // nothing to clean
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
		this.bloomFilter.id = peerId; // DEBUG
	}

	/** @param {string} callbackType @param {Function} callback */
	on(callbackType, callback) {
		if (!this.callbacks[callbackType]) this.callbacks[callbackType] = [callback];
		else this.callbacks[callbackType].push(callback);
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
		
		if (!this.bloomFilter.addMessage(senderId, topic, data, timestamp)) return; // already processed this message
		if (senderId === this.id) // DEBUG
			throw new Error(`Received our own message back from peer ${from}.`);
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
			if (peerId === this.id) // DEBUG
				throw new Error(`Refusing to send a gossip message to self (${this.id}).`);
			if (!avoidTransmissionRate && Math.random() > transmissionRate) continue; // apply gossip transmission rate
			this.#broadcastToPeer(peerId, messageWithDecrementedTTL);
		}

		return { senderId: from, forwardedTo: nCount, TTL, transmissionRate };
	}
}