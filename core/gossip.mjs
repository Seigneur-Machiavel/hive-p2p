import { GOSSIP } from '../utils/p2p_params.mjs';
import { xxHash32 } from '../utils/xxhash32.mjs';

/**
 * @typedef {import('./peer-store.mjs').PeerStore} PeerStore
 */

export class GossipMessage {
	senderId;
	topic;
	data;
	TTL;

	/** @param {string} senderId @param {string} topic @param {string | Uint8Array} data @param {number} TTL */
	constructor(senderId, topic, data, TTL = 3) {
		this.senderId = senderId;
		this.topic = topic;
		this.data = data;
		this.TTL = TTL;
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
	/** @type {Record<string, number>} */
	seenTimeouts = {}; // Map of message hashes to their expiration timestamps
	messagesByHashes = {}; // Map of message hashes to their content

	/** @type {BloomFilterCacheEntry[]} */ cache = [];
	cleanupDurationWarning = 10;

	// PUBLIC API
	addMessage(senderId, topic, data, TTL = GOSSIP.TTL.default) {
		const h = xxHash32(`${senderId}${topic}${JSON.stringify(data)}`);
		const n = Date.now();
		let forwardMessage = true;
		if (this.seenTimeouts[h] && n < this.seenTimeouts[h]) forwardMessage = false; // already exists and not expired
		else this.#addEntry(senderId, topic, data, h, n + (TTL * 10_000));
		this.#cleanupOldestEntry(n); // cleanup expired cache

		return forwardMessage;
	}
	/** @param {'asc' | 'desc'} order */
	getMessagesHistoryByTime(order = 'asc') {
		const messages = Object.entries(this.messagesByHashes).map(([hash, { senderId, topic, data }]) => ({
			hash, senderId, topic, data, timeout: this.seenTimeouts[hash],
		}));
		return messages.sort((a, b) => (order === 'asc' ? a.timeout - b.timeout : b.timeout - a.timeout));
	}

	// PRIVATE METHODS
	#addEntry(senderId, topic, data, hash, timeout) {
		this.cache.push({ hash, senderId, topic, data, expiration: timeout });
	}
	#cleanupOldestEntry(n = Date.now()) {
		let eraseUntil = 0; // cache is ordered by insertion time, stop at first non-expired
		for (let i = 0; i < this.cache.length; i++)
			if (this.cache[i].expiration > n) break;
			else eraseUntil = i;

		if (eraseUntil === 0) return; // nothing to erase
		this.cache.splice(0, eraseUntil + 1); // remove all expired entries

		// debug log
		//console.warn(`entriesCount: ${this.cache.length});
	}
}

export class Gossip {
	bloomFilter = new DegenerateBloomFilter();
	id;
	peerStore;

	/** @type {Record<string, Function[]>} */
	callbacks = {
		"peer_connected": [(senderId, data) => this.peerStore.handlePeerConnectedGossipEvent(senderId, data)],
		'peer_disconnected': [(senderId, data) => this.peerStore.unlinkPeers(data, senderId)],
		// Add more gossip event handlers here
	};

	/** @param {string} peerId @param {PeerStore} peerStore */
	constructor(peerId, peerStore) {
		this.id = peerId;
		this.peerStore = peerStore;
	}

	/** Gossip a message to all connected peers > will be forwarded to all peers
	 * @param {string} topic @param {string | Uint8Array} data @param {number} [TTL] */
	broadcast(topic, data, TTL = GOSSIP.TTL.default) {
		const message = new GossipMessage(this.id, topic, data, TTL);
		for (const peerId in this.peerStore.connected) this.peerStore.sendMessageToPeer(peerId, message);
	}
	/** Broadcast a message to a specific peer (TTL = 0)
	 * @param {string} targetPeerId @param {string} senderId @param {string} topic @param {string | Uint8Array} data */
	broadcastToPeer(targetPeerId, senderId, topic, data) {
		const message = new GossipMessage(senderId, topic, data, 0);
		this.peerStore.sendMessageToPeer(targetPeerId, message); // verify the 0
	}
	/** @param {string} from @param {GossipMessage} message @param {string | Uint8Array} serializedMessage @param {number} [verbose] */
	handleGossipMessage(from, message, serializedMessage, verbose = 0) {
		if (this.peerStore.isBanned(from)) return; // ignore messages from banned peers
		const { senderId, topic, data, TTL } = message;
		if (this.bloomFilter.addMessage(senderId, topic, data, TTL) === false) return; // already processed this message
		for (const cb of this.callbacks[topic] || []) cb(senderId, data);

		if (TTL < 1) return; // stop forwarding if TTL is 0
		if (this.id === senderId) return; // avoid sending our own message again
		const transmissionRate = GOSSIP.TRANSMISSION_RATE[topic] || GOSSIP.TRANSMISSION_RATE.default;
		for (const [peerId, conn] of Object.entries(this.peerStore.connected)) {
			if (peerId === from) continue; // avoid sending back to sender
			if (Math.random() > transmissionRate) continue; // apply gossip transmission rate
			try { conn.transportInstance.send(JSON.stringify(new GossipMessage(senderId, topic, data, TTL - 1))); }
			catch (error) { if (verbose > 1) console.error(`Error sending gossip message from ${this.id} to ${peerId}:`, error.stack); }
		}
	}
}