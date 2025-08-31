/**
 * @typedef {import('../core/node.mjs').NodeP2P} NodeP2P
 */

export class MessageQueue {
	typesInTheQueue = [];
	queue = [];

	push(message, avoidMultipleMessageWithSameType = true) {
		const typeAlreadyInQueue = this.typesInTheQueue.includes(message.type);
		if (avoidMultipleMessageWithSameType && typeAlreadyInQueue) return;
		if (!typeAlreadyInQueue) this.typesInTheQueue.push(message.type);
		this.queue.push(message);
	}
	getNextMessage() {
		const msg = this.queue.pop();
		this.typesInTheQueue = this.typesInTheQueue.filter(type => type !== msg.type);
		return msg;
	}
	reset() {
		this.typesInTheQueue = [];
		this.queue = [];
	}
}

export class SubscriptionsManager {
	/** @type {Function} */ sendFnc;
	/** @type {Record<string, Record<string, NodeP2P>} */ peers;
	sVARS;
	unicastCount = { session: 0, total: 0 };
	gossipCount = { session: 0, total: 0 };
	TMPT = {}; // Gossip "total Msg Per Topic"
	MTP = {}; // Gossip "Msg Per Topic"
	onPeerMessage = null; // currently subscribed peer
	interval;

	constructor(sendFnc, peers, sVARS, delay = 10_000) {
		console.info('SubscriptionsManager initialized');
		this.sendFnc = sendFnc;
		this.peers = peers;
		this.sVARS = sVARS;
		this.interval = setInterval(() => {
			console.info(`${Math.floor((Date.now() - this.sVARS.startTime) / 1000)} sec elapsed | totalNodes in simulation: ${Object.keys(this.peers.all).length} ----------------------`);
			console.info(`Total gossip: ${this.gossipCount.total} (+${this.gossipCount.session}) | total unicast: ${this.unicastCount.total} (+${this.unicastCount.session})`);
			for (const topic in this.TMPT) console.info(`Topic "${topic}" messages:  ${this.TMPT[topic]} (+${this.MTP[topic] || 0})`);
			for (const topic in this.MTP) this.MTP[topic] = 0; // reset per topic count
			this.gossipCount.session = 0; // reset session count
			this.unicastCount.session = 0; // reset session count
		}, delay);
	}
	addPeerMessageListener(peerId) {
		const peer = this.peers.all[peerId];
		if (!peer) return false;
		
		this.onPeerMessage = peerId; // set flag
		const unicastMessageHandler = (senderId, data) => {
			this.unicastCount.total++; this.unicastCount.session++;
		}
		//peer.messager.on('message', (senderId, data) => unicastMessageHandler(senderId, data));
		peer.messager.on('signal', (senderId, data) => unicastMessageHandler(senderId, data));

		// Listen to all GOSSIP messages from this peer
		peer.peerStore.on('data', (remoteId, d) => {
			const data = JSON.parse(d);
			this.sendFnc({ type: 'peerMessage', remoteId, data: JSON.stringify(data) });
			if (data.topic) {
				this.TMPT[data.topic] ? this.TMPT[data.topic]++ : this.TMPT[data.topic] = 1;
				this.MTP[data.topic] ? this.MTP[data.topic]++ : this.MTP[data.topic] = 1;
			}
			this.gossipCount.total++; this.gossipCount.session++;
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
		if (returnNewInstance) return new SubscriptionsManager(this.sendFnc, this.peers, this.sVARS);
	}
};