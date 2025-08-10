// HERE WE ARE BASICALLY COPYING THE PRINCIPLE OF "SimplePeer"

class Sandbox {
	static SIGNAL_TIMEOUT = 8_000;

	/** @type {Array<Object<string, boolean>>} */
	peersConnections = [];
	/** @type {Array<TestTransport>} */
	peers = [];
	inscribePeer(peer) {
		const peerIndex = this.peers.length;
		this.peers.push(peer);
		this.peersConnections[peerIndex] = {};
		return peerIndex;
	}
	#createLinkBetweenPeers(peerIndexA, peerIndexB) {
		const [indexAstr, indexBstr] = [peerIndexA.toString(), peerIndexB.toString()];
		this.peersConnections[indexAstr] = this.peersConnections[indexAstr] || {};
		this.peersConnections[indexBstr] = this.peersConnections[indexBstr] || {};
		this.peersConnections[indexAstr][indexBstr] = true;
		this.peersConnections[indexBstr][indexAstr] = true;
		this.peers[peerIndexA].callbacks.connect.forEach(cb => cb()); // emit connect event for peer A
		this.peers[peerIndexB].callbacks.connect.forEach(cb => cb()); // emit connect event for peer B
	}
	#deleteLinkBetweenPeers(peerIndexA, peerIndexB) {
		const [indexAstr, indexBstr] = [peerIndexA.toString(), peerIndexB.toString()];
		if (this.peersConnections[indexAstr]?.[indexBstr])
			delete this.peersConnections[indexAstr][indexBstr];
		if (this.peersConnections[indexBstr]?.[indexAstr])
			delete this.peersConnections[indexBstr][indexAstr];

		if (Object.keys(this.peersConnections[indexAstr]).length === 0)
			delete this.peersConnections[indexAstr];
		if (Object.keys(this.peersConnections[indexBstr]).length === 0)
			delete this.peersConnections[indexBstr];
	}
	sendData(fromPeerIndex, toPeerIndex, data) {
		if (!this.arePeersLinked(fromPeerIndex, toPeerIndex)) {
			console.error(`No link exists between peers ${fromPeerIndex} and ${toPeerIndex}`);
			return false;
		}
		const peer = this.peers[toPeerIndex];
		for (const cb of peer.callbacks.data) cb(data); // emit data event
		return true;
	}
	destroyPeer(peerIndex) {
		const sdp = this.PENDING_OFFERS[peerIndex];
		if (sdp !== undefined) this.#destroySignal(peerIndex, sdp.id);
		for (const peerIndexB of Object.keys(this.peersConnections[peerIndex] || {}))
			this.#deleteLinkBetweenPeers(peerIndex, peerIndexB);
	}
	arePeersLinked(peerIndexA, peerIndexB) {
		const [indexAstr, indexBstr] = [peerIndexA.toString(), peerIndexB.toString()];
		const linkA = this.peersConnections[indexAstr]?.[indexBstr];
		const linkB = this.peersConnections[indexBstr]?.[indexAstr];
		return linkA === true && linkB === true;
	}
	PENDING_OFFERS = {}; // key: peerIndex, value: signalData
	OFFERS_EMITTERS = {}; // key: signalId, value: peerIndex
	PENDING_ANSWERS = {}; // key: peerIndex, value: signalData
	ANSWER_EMITTERS = {}; // key: signalId, value: peerIndex

	#addSignalOffer(peerIndex, signalData) {
		this.PENDING_OFFERS[peerIndex] = signalData;
		this.OFFERS_EMITTERS[signalData.id] = peerIndex;
		setTimeout(() => this.#destroySignal(peerIndex, signalData.id), Sandbox.SIGNAL_TIMEOUT);
	}
	#addSignalAnswer(peerIndex, signalData) {
		this.PENDING_ANSWERS[peerIndex] = signalData;
		this.ANSWER_EMITTERS[signalData.id] = peerIndex;
		setTimeout(() => this.#destroySignal(peerIndex, signalData.id), Sandbox.SIGNAL_TIMEOUT);
	}
	buildSDP(peerIndex, type = 'offer') {
		const SDP = {
			type,
			sdp: {
				id: Math.random().toString(36).substring(2),
				v: '0',
				o: `- ${Math.random().toString(36).substring(2)} ${Math.floor(Math.random() * 1000000)} 2 IN IP4 127.0.0.1\r\n`,
				s: '-',
				t: '0 0',
				a: [
					'group:BUNDLE 0',
					'msid-semantic: WMS',
					'ice-ufrag:Cvvt',
					'ice-pwd:6jB1TY+roP0E44NQEavy9shl',
					'ice-options:trickle',
					'fingerprint:sha-256 FF:16:35:3A:3D:C2:5C:CD:A5:5D:21:B3:4E:31:3F:0B:5B:0B:3C:15:5B:59:A8:2C:A0:34:4E:8C:81:48:75:7D',
					'setup:actpass',
					'mid:0',
					'sctp-port:5000',
					'max-message-size:262144'
				]
			}
		}
		if (type === 'offer') this.#addSignalOffer(peerIndex, SDP.sdp);
		else if (type === 'answer') this.#addSignalAnswer(peerIndex, SDP.sdp);
		else return console.error(`Invalid signal type: ${type}. Expected 'offer' or 'answer'.`);

		return SDP;
	}
	#destroySignal(peerIndex) {
		const offer = this.PENDING_OFFERS[peerIndex];
		const answer = this.PENDING_ANSWERS[peerIndex];
		if (offer) {
			delete this.PENDING_OFFERS[peerIndex];
			delete this.OFFERS_EMITTERS[offer.id];
		} else if (answer) {
			delete this.PENDING_ANSWERS[peerIndex];
			delete this.ANSWER_EMITTERS[answer.id];
		}
	}
	digestSignal(SDP, receiverPeerIndex) {
		const { type, sdp } = SDP;
		if (type !== 'answer' && type !== 'offer') return console.error(`Invalid signal type: ${type}. Expected 'offer' or 'answer'.`), { success: false };

		const peerIndex = type === 'offer' ? this.OFFERS_EMITTERS[sdp.id] : this.ANSWER_EMITTERS[sdp.id];
		const receiverPeer = this.peers[receiverPeerIndex];
		if (peerIndex === undefined || receiverPeer === undefined) return;

		if (type === 'answer') {
			this.#destroySignal(peerIndex, sdp.id);
			this.#createLinkBetweenPeers(peerIndex, receiverPeerIndex);
			return { success: true, peerIndex };
		}

		
		return {
			success: peerIndex !== undefined,
			peerIndex,
			signalData: peerIndex !== undefined ? this.buildSDP(receiverPeerIndex, 'answer') : undefined
		};
	}
}
const SANDBOX = new Sandbox();

class TestTransportOptions {
	/** @type {number} */
	signalCreationDelay = 1000;
	static defaultSignalCreationDelay = 1000;
	/** @type {boolean} */
	initiator;
	/** @type {boolean} */
	trickle;
	/** @type {any} */
	wrtc;
}

export class TestTransport {
	peerIndex = 0;
	remotePeerIndex = null;
	// SimplePeer.Options: { initiator: !remoteSDP, trickle: true, wrtc }
	signalCreationDelay;
	initiator;
	trickle;
	wrtc;
	/** @param {TestTransportOptions} opts */
	constructor(opts = { initiator: false, trickle: true, wrtc: null, timeout: 5000 }) {
		this.peerIndex = SANDBOX.inscribePeer(this);
		this.signalCreationDelay = opts.signalCreationDelay || TestTransportOptions.defaultSignalCreationDelay;
		this.initiator = opts.initiator;
		this.trickle = opts.trickle;
		this.wrtc = opts.wrtc;

		if (!this.initiator) return; // standby
		const SDP = SANDBOX.buildSDP(this.peerIndex, 'offer'); // emit signal event 'offer'
		setTimeout(() => this.callbacks.signal.forEach(cb => cb(SDP)), this.signalCreationDelay);
	}

	callbacks = {
		connect: [],
		close: [],
		data: [],
		signal: [],
		error: []
	};
	on(event, callbacks) {
		if (this.callbacks[event]) this.callbacks[event].push(callbacks);
	}
	dispatchError(message) {
		const error = new Error(message);
		this.callbacks.error.forEach(cb => cb({ error }));
	}
	signal(remoteSDP) {
		if (remoteSDP.type === 'offer' && SANDBOX.PENDING_OFFERS[this.peerIndex])
			return this.dispatchError(`Signal with ID ${remoteSDP.sdp.id} already exists.`);
		if (!remoteSDP.sdp || !remoteSDP.sdp.id || remoteSDP.type !== 'offer' && remoteSDP.type !== 'answer')
			return this.dispatchError('Invalid remote SDP:', remoteSDP);

		const result = SANDBOX.digestSignal(remoteSDP, this.peerIndex);
		if (!result) return this.dispatchError(`Failed to digest signal for peer: ${this.peerIndex}`);

		const { success, peerIndex, signalData } = result;
		if (!success) return this.dispatchError(`No peer found with signal ID: ${remoteSDP.sdp.id}`);

		this.remotePeerIndex = peerIndex;
		if (signalData) this.callbacks.signal.forEach(cb => cb(signalData)); // emit signal event 'answer'
	}
	/** @param { string | Uint8Array } message */
	send(message) {
		const canSend = SANDBOX.arePeersLinked(this.peerIndex, this.remotePeerIndex);
		if (!canSend) return console.error(`No link exists between peers ${this.peerIndex} and ${this.remotePeerIndex}`);
		SANDBOX.sendData(this.peerIndex, this.remotePeerIndex, message);
	}
	close() {
		this.destroy();
	}
	destroy(errorMsg = null) {
		SANDBOX.destroyPeer(this.peerIndex);
		if (!errorMsg) this.callbacks.close.forEach(cb => cb()); // emit close event
		else this.callbacks.error.forEach(cb => cb(errorMsg));
		delete SANDBOX.peersConnections[this.peerIndex];
	}
}