import { VARS, xxHash32 } from "./p2p_utils.mjs";

/**
 * @typedef {import('./peer.mjs').PeerStore} PeerStore
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
	msgHashes = {};
	cleanupDurationWarning = 10;
	cleanupIntervalTime = 1000;
	cleanupInterval;

	constructor() {
		this.cleanupInterval = setInterval(() => {
			const now = Date.now();
			for (const [hash, timestamp] of Object.entries(this.msgHashes))
				if (now > timestamp) delete this.msgHashes[hash];

			const cleanupTime = Date.now() - now;
			if (cleanupTime < this.cleanupDurationWarning) return;
			console.warn(`Gossip message cleanup took longer than expected: ${cleanupTime}ms`);
		}, VARS.GOSSIP_CLEANUP_INTERVAL);
	}
	addMessage(senderId, topic, data, TTL = VARS.GOSSIP_MESSAGE_TTL) {
		const h = xxHash32(`${senderId}${topic}${JSON.stringify(data)}`);
		const n = Date.now();
		if (this.msgHashes[h] && n < this.msgHashes[h]) return false; // already exists and not expired
		else this.msgHashes[h] = n + (TTL * 1000);
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
	broadcast(topic, data, TTL = VARS.GOSSIP_DEFAULT_TTL) {
		const message = new GossipMessage(this.id, topic, data, TTL);
		for (const peerId in this.peerStore.store.connected) this.peerStore.sendMessageToPeer(peerId, message);
	}
	/** @param {string} from @param {GossipMessage} message @param {string | Uint8Array} serializedMessage @param {number} [verbose] */
	handleGossipMessage(from, message, serializedMessage, verbose = 0) {
		//if (this.bloomFilter.addMessage(serializedMessage) === false) return; // already processed this message
		const { senderId, topic, data, TTL } = message;
		if (this.bloomFilter.addMessage(senderId, topic, data, TTL) === false) return; // already processed this message
		for (const cb of this.callbacks[topic] || []) cb(senderId, data);

		if (TTL < 1) return; // stop forwarding if TTL is 0
		if (this.id === senderId) return; // avoid sending our own message again
		const transmissionRate = VARS.GOSSIP_TRANSMISSION_RATE[topic] || VARS.GOSSIP_TRANSMISSION_RATE.default;
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