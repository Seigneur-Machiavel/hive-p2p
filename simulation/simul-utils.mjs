import { SIMULATION, NODE, UNICAST, GOSSIP } from '../core/global_parameters.mjs';
import { CryptoCodex } from '../core/crypto-codex.mjs';

export class MessageQueue {
	/** @type {Record<string, any>} */
	messageQueuesByTypes = {};
	onMessage;

	/** @param {Function} onMessage */
	constructor(onMessage) { this.onMessage = onMessage; }

	// replace any existing message of the same type
	push(message) { this.messageQueuesByTypes[message.type] = message; }
	async tick() { // Message processing loop
		const messagesList = Object.values(this.messageQueuesByTypes);
		this.messageQueuesByTypes = {};
		for (const message of messagesList) await this.onMessage(message);
	}
}

function statsFormating(stats) {
	return JSON.stringify(stats).replaceAll('"','').replaceAll(':',': ').replaceAll('{', '{ ').replaceAll('}', ' }').replaceAll(',', ', ');
}

export class Statician { // DO NOT ADD VARIABLES, JUST COUNTERS !!
	gossip = 0;
	unicast = 0;
	/** @param {Object} sVARS @param {Record<string, Record<string, import('../core/node.mjs').NodeP2P>>} peers @param {number} verbose @param {number} [delay] default: 10 seconds */
	constructor(sVARS, peers, delay = 10_000) {
		const verbose = NODE.DEFAULT_VERBOSE;
		setInterval(() => {
			const peersConnectionsCount = [];
			let establishedWrtcConnCount = 0;
			let wrtcToEstablishCount = 0;
			for (const peerId in peers.all) {
				if (CryptoCodex.isPublicNode(peerId)) continue;
				if (!peers.all[peerId].started) continue;
				wrtcToEstablishCount++;
				const standardNeighborsCount = peers.all[peerId].peerStore.standardNeighborsList.length;
				if (standardNeighborsCount === 0) continue;
				establishedWrtcConnCount++;
				peersConnectionsCount.push(standardNeighborsCount);
			}
			const averagePeersConnections = peersConnectionsCount.length === 0 ? 0 : (peersConnectionsCount.reduce((a, b) => a + b, 0) / peersConnectionsCount.length).toFixed(1);

			if (verbose) console.info(`%c${Math.floor((Date.now() - sVARS.startTime) / 1000)}sec elapsed | Active: ${sVARS.publicInit + (sVARS.nextPeerToInit - 1)}/${Object.keys(peers.all).length} (${establishedWrtcConnCount}/${wrtcToEstablishCount} est. WebRTC | ${averagePeersConnections} avg conns on the ${establishedWrtcConnCount})`, 'color: yellow;');
			if (verbose) console.info(`%c--STATS/sec: ${this.#getSimulationStatsPerSecond(delay)}`, 'color: yellow;');
			for (const key in this) this[key] = 0;
		}, delay);
	}
	#getSimulationStatsPerSecond(delay, formating = true) {
		const divider = delay / 1000;
		const stats = {}
		for (const key in this) stats[key] = Math.round(this[key] / divider);
		return formating ? statsFormating(stats) : stats;
	}
}
export class TransmissionAnalyzer {
	verbose;
	sVARS;
	peers;
	gossip = {
		/** @type {Map<string, { time: number, count: number, hops: number} }>} */
		receptions: new Map(),
		nonce: 'ffffff',
		sendAt: 0,
	}

	/** @param {Record<string, Record<string, import('../core/node.mjs').NodeP2P>>} peers @param {number} verbose @param {number} [delay] default: 10 seconds */
	constructor(sVARS, peers, verbose, delay = SIMULATION.DIFFUSION_TEST_DELAY) {
		this.sVARS = sVARS;
		this.peers = peers;
		this.verbose = verbose;
		setInterval(() => {
			const stats = this.#getTransmissionStats();
			if (stats && this.verbose) console.info(`%c[DIFFUSION]>> ${stats}`, 'color: hotpink;');
			// SEND A GOSSIP MESSAGE FROM A RANDOM PEER -> ALL PEERS SHOULD RECEIVE IT
			this.gossip.nonce = 'ffffff';
			this.gossip.receptions = new Map(); // key: peerId, value: { time: number, count: number }
			this.#sendDiffusionTestMessage();
		}, delay);
	}
	#getTransmissionStats(formating = true) {
		if (!this.gossip.sendAt) return null;
		const initializedPeersCount = this.sVARS.publicInit + this.sVARS.nextPeerToInit - 1;
		let cumulatedLatencies = 0;
		let cumulatedHops = 0;
		let maxHops = 0;
		let totalReceptions = 0;
		for (const [peerId, { time, count, hops }] of this.gossip.receptions) {
			cumulatedLatencies += time - this.gossip.sendAt;
			totalReceptions += count;
			cumulatedHops += hops;
			if (hops > maxHops) maxHops = hops;
		}
		const receptionsCount = this.gossip.receptions.size;
		const stats = {
			received: `${receptionsCount}/${initializedPeersCount - 1} (T:${totalReceptions})`,
			avgLatency: `${receptionsCount === 0 ? 0 : Math.round(cumulatedLatencies / receptionsCount)}ms`,
			hops: `${receptionsCount === 0 ? 0 : (cumulatedHops / receptionsCount).toFixed(1)} avg,${maxHops} max`,
		};
		if (formating) return statsFormating(stats);
		return stats;
	}
	#sendDiffusionTestMessage() { // Better to chose a connected peer ;)
		const peersIds = Object.keys(this.peers.all);
		if (peersIds.length === 0) return;
		for (let i = 0; i < 50; i++) { // try to find a connected peer
			const randomPeerId = peersIds[Math.floor(Math.random() * peersIds.length)];
			const peer = this.peers.all[randomPeerId];
			if (!peer.started || peer.peerStore.neighborsList.length === 0) continue;
			this.gossip.nonce = Math.floor(Math.random() * 1000000).toString(16).padStart(6, '0');
			this.gossip.sendAt = Date.now();
			peer.gossip.broadcastToAll(this.gossip.nonce, 'diffusion_test');
			break;
		}
	}
	/** @param {string} receiverId @param {string} nonce @param {number} HOPS  */
	analyze(receiverId, nonce, HOPS) {
		if (this.gossip.sendAt === 0) return; // we have not sent yet
		if (nonce !== this.gossip.nonce) return; // not our test message
		if (!this.gossip.sendAt) return; // we are not the sender
		const hops = GOSSIP.HOPS.diffusion_test - ( HOPS - 1 ) ; // not decremented yet, so -1
		if (!this.gossip.receptions.has(receiverId)) this.gossip.receptions.set(receiverId, { time: Date.now(), count: 1, hops });
		else this.gossip.receptions.get(receiverId).count++;
	}
}
export class SubscriptionsManager {
	verbose;
	cryptoCodex;
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

	/** @param {Function} sendFnc @param {Record<string, import('../core/node.mjs').NodeP2P>} peers @param {import('../core/crypto-codex.mjs').CryptoCodex} cryptoCodex @param {number} verbose @param {number} [delay] default: 10 seconds */
	constructor(sendFnc, peers, cryptoCodex, verbose, delay = 10_000) {
		console.info('SubscriptionsManager initialized');
		this.sendFnc = sendFnc;
		this.peers = peers;
		this.cryptoCodex = cryptoCodex;
		this.verbose = verbose;
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

			if (gossipLog && this.verbose) console.log(`%c~GOSSIP/sec (total: ${sessionGossipSec}): ${gossipLog}`, 'color: fuchsia;');
			if (gossipBandwidthLog && this.verbose) console.log(`%c~BANDWIDTH/sec (total: ${sessionGossipBandwidthSec} bytes): ${gossipBandwidthLog}`, 'color: fuchsia;');
			if (unicastLog && this.verbose) console.log(`%c~UNICAST/sec (total: ${sessionUnicastSec}): ${unicastLog}`, 'color: cyan;');
			if (unicastBandwidthLog && this.verbose) console.log(`%c~BANDWIDTH/sec (total: ${sessionUnicastBandwidthSec} bytes): ${unicastBandwidthLog}`, 'color: cyan;');

			// RESET SESSION COUNTERS
			this.gossipCount.session = 0;
			this.unicastCount.session = 0;
			this.gossipBandwidth.session = 0;
			this.unicastBandwidth.session = 0;
			this.mpTopic = {};
			this.mpType = {};
			this.bTopic = {};
			this.bType = {};
		}, delay);
	}
	/** @param {'gossip' | 'unicast'} type @param {'count' | 'bandwidth'} mode @param {number} divider @param {boolean} [formating] default: true */
	#getPeerStatsPerSecond(type, mode, divider, formating = true) {
		const stats = {};
		const targets = mode === 'count'
		? type === 'gossip' ? this.mpTopic : this.mpType
		: type === 'gossip' ? this.bTopic : this.bType;

		const suffix = mode === 'count' ? '' : ' bytes';
		for (const key in targets) stats[key] = `${mode === 'count' ? (targets[key] / divider).toFixed(1) : Math.round(targets[key])}${suffix}`;
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
					const d = this.cryptoCodex.readGossipMessage(data);
					if (!d) throw new Error('Failed to decode gossip message');
					this.#countMessage(d.topic, true);
					this.#countBandwidth(d.topic, data.length, true);
					this.sendFnc({ type: 'peerMessage', remoteId, data: d }); // without identifier
				} else if (UNICAST.MARKERS_BYTES[markerByte]) { // unicast message
					const d = this.cryptoCodex.readUnicastMessage(data);
					if (!d) throw new Error('Failed to decode unicast message');
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