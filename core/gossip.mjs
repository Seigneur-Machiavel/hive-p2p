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
	verbose;
	id;
	peerStore;
	bloomFilter = new DegenerateBloomFilter();
	/** @type {Record<string, Function[]>} */ callbacks = {};

	/** @param {string} peerId @param {PeerStore} peerStore */
	constructor(peerId, peerStore, verbose = 0) {
		this.verbose = verbose;
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
		if (!this.bloomFilter.addMessage(this.id, topic, data, timestamp)) return; // avoid re-processing our own message
		
		const serializedData = GossipMessage.serialize(this.id, topic, data, timestamp, ttl || GOSSIP.TTL[topic] || GOSSIP.TTL.default);
		const targetsId = targetId ? [targetId] : Object.keys(this.peerStore.connected);
		if (this.verbose > 3) console.log(`(${this.id}) Gossip ${topic}, to ${JSON.stringify(targetsId)}: ${data}`);
		for (const peerId of targetsId) this.#broadcastToPeer(peerId, serializedData);
	}
	/** @param {string} targetId @param {any} serializedData */
	#broadcastToPeer(targetId, serializedData) {
		const transportInstance = this.peerStore.connected[targetId]?.transportInstance;
		if (!transportInstance) return { success: false, reason: `Transport instance is not available for peer ${targetId}.` };
		try { transportInstance.send(serializedData); }
		catch (error) { this.peerStore.connected[targetId]?.close(); }
	}
	/** @param {string} from @param {GossipMessage} message @param {string | Uint8Array} serializedMessage */
	handleGossipMessage(from, message, serializedMessage) {
		if (this.peerStore.isBanned(from)) return; // ignore messages from banned peers

		// FOR SECURITY WE CAN:
		// DECRYPT MESSAGE WITH (pubKey === 'from')
		// DECRYPT DATA WITH (pubKey === 'senderId')
		const { senderId, topic, data, timestamp, TTL } = message;
		for (const cb of this.callbacks['message_handle'] || []) cb(senderId, data); // mainly used in debug
		if (!this.bloomFilter.addMessage(senderId, topic, data, timestamp)) return; // already processed this message
		
		if (this.verbose > 3)
			if (senderId === from) console.log(`(${this.id}) Gossip ${topic} from ${senderId}: ${data}`);
			else console.log(`(${this.id}) Gossip ${topic} from ${senderId} (by: ${from}): ${data}`);

		if (senderId === this.id) // DEBUG
			throw new Error(`#${this.id}#${from}# Received our own message back from peer ${from}.`);
		for (const cb of this.callbacks[topic] || []) cb(senderId, data);

		if (TTL < 1) return; // stop forwarding if TTL is 0
		//if (this.id === senderId) return; // avoid sending our own message again => SHOULD NOT HAPPEN!!
		if (topic === 'handshake') return { from, senderId };

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

		return { from, senderId };
	}
}