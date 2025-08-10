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

export class DirectMessage {
	route;
	type = 'signal';
	data;
	isFlexible;

	/**
	 * @param {string[]} route chain of peerIds to reach the target, start by sender, end by target
	 * @param {string} type type of message
	 * @param {string | Uint8Array} data message content, should be encrypted with target peer's public key
	 * @param {boolean} isFlexible Whether the message can be sent through a different route if the primary route fails, default is false
	 */
	constructor(route, type, data, isFlexible = false) {
		this.route = route;
		this.type = type;
		this.data = data;
		this.isFlexible = isFlexible;
	}
}
