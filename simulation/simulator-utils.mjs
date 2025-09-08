import { GossipMessage } from '../core/gossip.mjs';
import { DirectMessage } from '../core/unicast.mjs';
/**
 * @typedef {import('../core/node.mjs').NodeP2P} NodeP2P
 */

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

	constructor(sVARS, peers, delay = 10_000) {
		setInterval(() => {
			const nextPeerToInit = sVARS.nextPeerToInit > 0 ? sVARS.nextPeerToInit - 1 : 0;
			console.info(`%c${Math.floor((Date.now() - sVARS.startTime) / 1000)} sec elapsed | Active nodes: ${sVARS.publicInit + nextPeerToInit}/${Object.keys(peers.all).length} | STATS/sec: ${this.#getStatsPerSecond(delay)}`, 'color: yellow;');
			//console.log(`%c~STATS/sec: ${this.#getStatsPerSecond(delay)}`, 'color: yellow;');
			for (const key in this) this[key] = 0;
		}, delay);
	}
	#getStatsPerSecond(delay, formating = true) {
		const divider = delay / 1000;
		const stats = {}
		for (const key in this) stats[key] = Math.round(this[key] / divider);
		return !formating ? stats : statsFormating(stats);
	}
}

export class SubscriptionsManager {
	/** @type {Function} */ sendFnc;
	/** @type {Record<string, Record<string, NodeP2P>} */ peers;
	unicastCount = { session: 0, total: 0 };
	gossipCount = { session: 0, total: 0 };
	tmpTopic = {}; // Gossip "Msg Per Topic" (total)
	tmpType = {}; //  Unicast "Msg Per Type" (total)
	mpTopic = {}; //  Gossip "Msg Per Topic" (session)
	mpType = {}; //   Unicast "Msg Per Type" (session)

	onPeerMessage = null; // currently subscribed peer
	interval;

	constructor(sendFnc, peers, delay = 10_000) {
		console.info('SubscriptionsManager initialized');
		this.sendFnc = sendFnc;
		this.peers = peers;
		const divider = delay / 1000;
		this.interval = setInterval(() => {
			const sessionGossipSec = Math.round(this.gossipCount.session / divider);
			const sessionUnicastSec = Math.round(this.unicastCount.session / divider);
			const [gossipLog, unicastLog] = [this.#getStatsPerSecond('gossip', divider), this.#getStatsPerSecond('unicast', divider)];
			if (gossipLog) console.log(`%c~GOSSIP/sec (total: ${sessionGossipSec}): ${gossipLog}`, 'color: fuchsia;');
			if (unicastLog) console.log(`%c~UNICAST/sec (total: ${sessionUnicastSec}): ${unicastLog}`, 'color: cyan;');

			// RESET SESSION COUNTERS
			this.gossipCount.session = 0;
			this.unicastCount.session = 0;
			for (const key in this.mpTopic) this.mpTopic[key] = 0;
			for (const key in this.mpType) this.mpType[key] = 0;
		}, delay);
	}
	/** @param {'gossip' | 'unicast'} type */
	#getStatsPerSecond(type, divider, formating = true) {
		const stats = {}
		const target = type === 'gossip' ? this.mpTopic : this.mpType;
		for (const [key, value] of Object.entries(target)) stats[key] = Math.round(value / divider);
		if (Object.keys(stats).length === 0) return null;
		if (Object.values(stats).every(v => v === 0)) return null;
		return !formating ? stats : statsFormating(stats);
	}
	addPeerMessageListener(peerId) {
		const peer = this.peers.all[peerId];
		if (!peer) return false;
		
		this.onPeerMessage = peerId; // set flag
			
		// Listen to all GOSSIP messages from this peer
		peer.peerStore.on('data', (remoteId, data) => {
			//const d = JSON.parse(data);
			const identifier = data[0];
			const d = identifier === 'U' ? DirectMessage.deserialize(data) : GossipMessage.deserialize(data);
			this.sendFnc({ type: 'peerMessage', remoteId, data: data.slice(1) }); // without identifier
			if (d.topic) { // gossip message
				this.tmpTopic[d.topic] ? this.tmpTopic[d.topic]++ : this.tmpTopic[d.topic] = 1;
				this.mpTopic[d.topic] ? this.mpTopic[d.topic]++ : this.mpTopic[d.topic] = 1;
				this.gossipCount.total++;
				this.gossipCount.session++;
			} else { // unicast message
				this.tmpType[d.type] ? this.tmpType[d.type]++ : this.tmpType[d.type] = 1;
				this.mpType[d.type] ? this.mpType[d.type]++ : this.mpType[d.type] = 1;
				this.unicastCount.total++;
				this.unicastCount.session++;
			}
		});
		return true;
	}
	removePeerMessageListener() {
		const peer = this.peers.all[this.onPeerMessage];
		if (peer) peer.peerStore.callbacks.data.splice(0, 1);
		this.onPeerMessage = null;
	}
	destroy(returnNewInstance = false) {
		this.removePeerMessageListener();
		if (this.interval) clearInterval(this.interval);
		if (returnNewInstance) return new SubscriptionsManager(this.sendFnc, this.peers);
	}
};