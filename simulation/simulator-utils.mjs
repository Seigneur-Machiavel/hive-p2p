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
	peers;
	sVARS;
	totalMsg = 0;
	sessionMsg = 0;
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
			console.info(`${Math.floor((Date.now() - this.sVARS.startTime) / 1000)} sec elapsed ----------------------`);
			console.info(`Total messages: ${this.totalMsg} (+${this.sessionMsg})`);
			for (const topic in this.TMPT) console.info(`Topic "${topic}" messages:  ${this.TMPT[topic]} (+${this.MTP[topic] || 0})`);
			for (const topic in this.MTP) this.MTP[topic] = 0; // reset per topic count
			this.sessionMsg = 0; // reset session count
		}, delay);
	}
	addPeerMessageListener(peerId) {
		const peer = this.peers.all[peerId];
		if (!peer) return false;
		
		this.onPeerMessage = peerId;
		peer.peerStore.on('data', (remoteId, d) => {
			const data = JSON.parse(d);
			this.sendFnc({ type: 'peerMessage', remoteId, data: JSON.stringify(data) });
			if (data.topic) {
				this.TMPT[data.topic] ? this.TMPT[data.topic]++ : this.TMPT[data.topic] = 1;
				this.MTP[data.topic] ? this.MTP[data.topic]++ : this.MTP[data.topic] = 1;
			}
			this.totalMsg++; this.sessionMsg++;
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