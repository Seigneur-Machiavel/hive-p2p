import { GOSSIP } from './utils/p2p_params.mjs';
import { xxHash32 } from './utils/xxhash32.mjs';

/**
 * @typedef {import('./p2p_peerStore.mjs').PeerStore} PeerStore
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

class DegenerateBloomFilter {
	/** @type {Record<string, number>} */
	seenTimeouts = {};
	msgHashes = [];
	nMHi = 0; // Next Message Hash Index to control
	cleanupDurationWarning = 10;
	cleanupIntervalTime = 1000;
	cleanupInterval;

	// TRYING TO OPTIMIZE THIS CRAP
	addMessage(senderId, topic, data, TTL = GOSSIP.TTL.default) {
		const h = xxHash32(`${senderId}${topic}${JSON.stringify(data)}`);
		const n = Date.now();
		let forwardMessage = true;
		if (this.seenTimeouts[h] && n < this.seenTimeouts[h]) forwardMessage = false; // already exists and not expired
		else this.#addMessageHash(h, n + (TTL * 1000)); // add/update timeout
		this.#cleanupNext(n); // cleanup next message hash if needed

		return forwardMessage;
	}
	#addMessageHash(h, t) {
		if (!this.seenTimeouts[h]) this.msgHashes.push(h);
		this.seenTimeouts[h] = t; // add/update timeout
	}
	#cleanupNext(now = Date.now()) {
		this.nMHi = (this.nMHi + 1) % this.msgHashes.length;
		const t = this.msgHashes[this.nMHi];
		if (t && now > t) delete this.seenTimeouts[this.nMHi];
	}
	destroy() {
		clearInterval(this.cleanupInterval);
	}
}

export class Gossip {
	bloomFilter = new DegenerateBloomFilter();
	id;
	peerStore;

	/** @type {Record<string, Function[]>} */
	callbacks = {
		'peer_connected': [(senderId, data) => this.peerStore.linkPeers(data, senderId)],
		'peer_disconnected': [(senderId, data) => this.peerStore.unlinkPeers(data, senderId)],
		// Add more gossip event handlers here
	};

	/** @param {string} peerId @param {PeerStore} peerStore */
	constructor(peerId, peerStore) {
		this.id = peerId;
		this.peerStore = peerStore;
	}

	/** @param {string} topic @param {string | Uint8Array} data @param {number} [TTL] */
	broadcast(topic, data, TTL = GOSSIP.TTL.default) {
		const message = new GossipMessage(this.id, topic, data, TTL);
		for (const peerId in this.peerStore.store.connected) this.peerStore.sendMessageToPeer(peerId, message);
	}
	/** @param {string} from @param {GossipMessage} message @param {string | Uint8Array} serializedMessage @param {number} [verbose] */
	handleGossipMessage(from, message, serializedMessage, verbose = 0) {
		if (this.peerStore.isBanned(from)) return; // ignore messages from banned peers
		//if (this.bloomFilter.addMessage(serializedMessage) === false) return; // already processed this message
		const { senderId, topic, data, TTL } = message;
		if (this.bloomFilter.addMessage(senderId, topic, data, TTL) === false) return; // already processed this message
		for (const cb of this.callbacks[topic] || []) cb(senderId, data);

		if (TTL < 1) return; // stop forwarding if TTL is 0
		if (this.id === senderId) return; // avoid sending our own message again
		const transmissionRate = GOSSIP.TRANSMISSION_RATE[topic] || GOSSIP.TRANSMISSION_RATE.default;
		for (const [peerId, conn] of Object.entries(this.peerStore.store.connected)) {
			if (peerId === from) continue; // avoid sending back to sender
			if (Math.random() > transmissionRate) continue; // apply gossip transmission rate
			try { conn.transportInstance.send(JSON.stringify(new GossipMessage(senderId, topic, data, TTL - 1))); }
			catch (error) { if (verbose > 1) console.error(`Error sending gossip message from ${this.id} to ${peerId}:`, error.stack); }
		}
	}
	destroy() {
		this.bloomFilter.destroy();
	}
}