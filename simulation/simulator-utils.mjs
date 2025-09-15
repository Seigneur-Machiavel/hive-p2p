import { UNICAST, GOSSIP } from '../core/global_parameters.mjs';

export class MessageQueue {
	typesInTheQueue = [];
	queue = [];
	onMessage;

	/** @param {Function} onMessage */
	constructor(onMessage) { this.onMessage = onMessage; this.#start(); }

	push(message, avoidMultipleMessageWithSameType = true) {
		const typeAlreadyInQueue = this.typesInTheQueue.includes(message.type);
		if (avoidMultipleMessageWithSameType && typeAlreadyInQueue) return;
		if (!typeAlreadyInQueue) this.typesInTheQueue.push(message.type);
		this.queue.push(message);
	}
	#getNextMessage() {
		const msg = this.queue.pop();
		this.typesInTheQueue = this.typesInTheQueue.filter(type => type !== msg.type);
		return msg;
	}
	async #start() { // Message processing loop
		while (true) {
			await this.onMessage(this.#getNextMessage());
			await new Promise(resolve => setTimeout(resolve, 10)); // prevent blocking the event loop
		}
	}
	reset() {
		this.typesInTheQueue = [];
		this.queue = [];
	}
}

function statsFormating(stats) {
	return JSON.stringify(stats).replaceAll('"','').replaceAll(':',': ').replaceAll('{', '{ ').replaceAll('}', ' }').replaceAll(',', ', ');
}

export class Statician { // DO NOT ADD VARIABLES, JUST COUNTERS !!
	gossip = 0;
	unicast = 0;

	constructor(sVARS, peers, delay = 10_000) {
		setInterval(() => {
			const nextPeerToInit = sVARS.nextPeerToInit > 0 ? sVARS.nextPeerToInit - 1 : 0;
			console.info(`%c${Math.floor((Date.now() - sVARS.startTime) / 1000)} sec elapsed | Active nodes: ${sVARS.publicInit + nextPeerToInit}/${Object.keys(peers.all).length} | STATS/sec: ${this.#getSimulationStatsPerSecond(delay)}`, 'color: yellow;');
			for (const key in this) this[key] = 0;
		}, delay);
	}
	#getSimulationStatsPerSecond(delay, formating = true) {
		const divider = delay / 1000;
		const stats = {}
		for (const key in this) stats[key] = Math.round(this[key] / divider);
		return !formating ? stats : statsFormating(stats);
	}
}

export class SubscriptionsManager {
	cryptoCodec;
	/** @type {Function} */ sendFnc;
	/** @type {Record<string, Record<string, import('../core/node.mjs').NodeP2P>} */ peers;
	unicastCount = { session: 0, total: 0 };
	gossipCount = { session: 0, total: 0 };
	tmpTopic = {};	// Total Gossip "Msg Per Topic"
	tmpType = {}; 	// Total Unicast "Msg Per Type"
	mpTopic = {}; 	// Session Gossip "Msg Per Topic"
	mpType = {}; 	// Session Unicast "Msg Per Type"
	
	unicastBandwidth = { session: 0, total: 0 }; // in bytes
	gossipBandwidth = { session: 0, total: 0 }; // in bytes
	tbTopic = {}; 	// Total Gossip "Bandwidth Per Topic"
	tbType = {}; 	// Total Unicast "Bandwidth Per Type"
	bTopic = {}; 	// Session Gossip "Bandwidth Per Topic"
	bType = {}; 	// Session Unicast "Bandwidth Per Type"

	onPeerMessage = null; // currently subscribed peer
	interval;

	/** @param {Function} sendFnc @param {Record<string, Record<string, import('../core/node.mjs').NodeP2P}>} peers @param {import('../core/crypto-codec.mjs').CryptoCodec} cryptoCodec @param {number} [delay] default: 10 seconds */
	constructor(sendFnc, peers, cryptoCodec, delay = 10_000) {
		console.info('SubscriptionsManager initialized');
		this.sendFnc = sendFnc;
		this.peers = peers;
		this.cryptoCodec = cryptoCodec;
		const divider = delay / 1000;
		this.interval = setInterval(() => {
			const sessionGossipSec = Math.round(this.gossipCount.session / divider);
			const sessionUnicastSec = Math.round(this.unicastCount.session / divider);
			const sessionGossipBandwidthSec = Math.round(this.gossipBandwidth.session / divider);
			const sessionUnicastBandwidthSec = Math.round(this.unicastBandwidth.session / divider);
			const [gossipLog, unicastLog] = [this.#getPeerStatsPerSecond('gossip', 'count', divider), this.#getPeerStatsPerSecond('unicast', 'count', divider)];
			const [gossipBandwidthLog, unicastBandwidthLog] = [this.#getPeerStatsPerSecond('gossip', 'bandwidth', divider), this.#getPeerStatsPerSecond('unicast', 'bandwidth', divider)];
			//if (gossipLog) console.log(`%c~GOSSIP/sec (total: ${sessionGossipSec} [${sessionGossipBandwidthSec} bytes]): ${gossipLog} [bytes: ${gossipBandwidthLog}]`, 'color: fuchsia;');
			//if (unicastLog) console.log(`%c~UNICAST/sec (total: ${sessionUnicastSec} [${sessionUnicastBandwidthSec} bytes]): ${unicastLog} [bytes: ${unicastBandwidthLog}]`, 'color: cyan;');

			if (gossipLog) console.log(`%c~GOSSIP/sec (total: ${sessionGossipSec}): ${gossipLog}`, 'color: fuchsia;');
			if (gossipBandwidthLog) console.log(`%c~GOSSIP BANDWIDTH/sec (total: ${sessionGossipBandwidthSec} bytes): ${gossipBandwidthLog}`, 'color: fuchsia;');
			if (unicastLog) console.log(`%c~UNICAST/sec (total: ${sessionUnicastSec}): ${unicastLog}`, 'color: cyan;');
			if (unicastBandwidthLog) console.log(`%c~UNICAST BANDWIDTH/sec (total: ${sessionUnicastBandwidthSec} bytes): ${unicastBandwidthLog}`, 'color: cyan;');

			// RESET SESSION COUNTERS
			this.gossipCount.session = 0;
			this.unicastCount.session = 0;
			this.gossipBandwidth.session = 0;
			this.unicastBandwidth.session = 0;
			for (const key in this.mpTopic) this.mpTopic[key] = 0;
			for (const key in this.mpType) this.mpType[key] = 0;
			for (const key in this.bTopic) this.bTopic[key] = 0;
			for (const key in this.bType) this.bType[key] = 0;
		}, delay);
	}
	/** @param {'gossip' | 'unicast'} type @param {'count' | 'bandwidth'} mode @param {number} divider @param {boolean} [formating] default: true */
	#getPeerStatsPerSecond(type, mode, divider, formating = true) {
		const stats = {};
		const targets = mode === 'count'
		? type === 'gossip' ? this.mpTopic : this.mpType
		: type === 'gossip' ? this.bTopic : this.bType;

		for (const [key, value] of Object.entries(targets)) stats[key] = Math.round(value / divider);
		if (Object.keys(stats).length === 0) return null;
		if (Object.values(stats).every(v => v === 0)) return null;
		return !formating ? stats : statsFormating(stats);
	}
	#countMessage(topicOrType, isGossip) {
		if (isGossip) {
			this.tmpTopic[topicOrType] ? this.tmpTopic[topicOrType]++ : this.tmpTopic[topicOrType] = 1;
			this.mpTopic[topicOrType] ? this.mpTopic[topicOrType]++ : this.mpTopic[topicOrType] = 1;
			this.gossipCount.total++;
			this.gossipCount.session++;
		} else {
			this.tmpType[topicOrType] ? this.tmpType[topicOrType]++ : this.tmpType[topicOrType] = 1;
			this.mpType[topicOrType] ? this.mpType[topicOrType]++ : this.mpType[topicOrType] = 1;
			this.unicastCount.total++;
			this.unicastCount.session++;
		}
	}
	#countBandwidth(topicOrType, byteLength, isGossip) {
		if (isGossip) {
			this.tbTopic[topicOrType] ? this.tbTopic[topicOrType] += byteLength : this.tbTopic[topicOrType] = byteLength;
			this.bTopic[topicOrType] ? this.bTopic[topicOrType] += byteLength : this.bTopic[topicOrType] = byteLength;
			this.gossipBandwidth.total += byteLength;
			this.gossipBandwidth.session += byteLength;
		} else {
			this.tbType[topicOrType] ? this.tbType[topicOrType] += byteLength : this.tbType[topicOrType] = byteLength;
			this.bType[topicOrType] ? this.bType[topicOrType] += byteLength : this.bType[topicOrType] = byteLength;
			this.unicastBandwidth.total += byteLength;
			this.unicastBandwidth.session += byteLength;
		}
	}
	setPeerMessageListener(peerId) {
		this.#removeExistingPeerMessageListener();
		const peer = this.peers.all[peerId];
		if (!peer) return false;
		
		this.onPeerMessage = peerId; // set flag
			
		// Listen to all GOSSIP messages from this peer
		/** @param {string} remoteId @param {Uint8Array} data */
		peer.peerStore.on('data', (remoteId, data) => {
			const markerByte = data[0];
			try {
				if (GOSSIP.MARKERS_BYTES[markerByte]) { // gossip message
					const d = this.cryptoCodec.readGossipMessage(data);
					this.#countMessage(d.topic, true);
					this.#countBandwidth(d.topic, data.length, true);
					this.sendFnc({ type: 'peerMessage', remoteId, data: d }); // without identifier
				} else if (UNICAST.MARKERS_BYTES[markerByte]) { // unicast message
					const d = this.cryptoCodec.readUnicastMessage(data);
					this.#countMessage(d.type, false);
					this.#countBandwidth(d.type, data.length, false);
					this.sendFnc({ type: 'peerMessage', remoteId, data: d }); // without identifier
				}
			} catch (error) { console.error(`Error processing message from ${remoteId}, markerByte ${markerByte}:`, error.stack); }
		});
		return true;
	}
	#removeExistingPeerMessageListener() {
		if (this.onPeerMessage === null) return;
		const peer = this.peers.all[this.onPeerMessage];
		if (peer) peer.peerStore.callbacks.data.pop(); // BUG ?
		this.onPeerMessage = null;
	}
};