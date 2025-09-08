import wrtc from 'wrtc';
import SimplePeer from 'simple-peer';
import { TestTransport } from '../simulation/test-transports.mjs';
import { NODE } from './global_parameters.mjs';

/** @typedef {import('ws').WebSocket} WebSocket */

export class PeerConnection {
	transportInstance;
	connStartTime;
	isWebSocket;
	direction;
	peerId;

	/** 
	 * @param {string} peerId @param {SimplePeer.Instance | WebSocket} transportInstance @param {'in' | 'out'} direction */
	constructor(peerId, transportInstance, direction = 'in', isWebSocket = false) {
		this.transportInstance = transportInstance;
		this.isWebSocket = isWebSocket;
		this.direction = direction;
		this.peerId = peerId;
	}
	getConnectionDuration() { return this.connStartTime ? Date.now() - this.connStartTime : 0; }
	close() { this.isWebSocket ? this.transportInstance?.close() : this.transportInstance?.destroy(); }
}
export class KnownPeer {
	id;
	neighbours;
	connectionsCount;

	/** @param {string} id @param {Record<string, number>} neighbours key: peerId, value: timestamp */
	constructor(id, neighbours = {}) {
		this.id = id;
		this.neighbours = neighbours;
		this.connectionsCount = Object.keys(neighbours).length;
	}
	
	setNeighbour(peerId, timestamp = Date.now()) {
		if (!this.neighbours[peerId]) this.connectionsCount++;
		this.neighbours[peerId] = timestamp;
	}
	unsetNeighbour(peerId) {
		if (this.neighbours[peerId]) this.connectionsCount--;
		delete this.neighbours[peerId];
	}
}
export class SdpOfferManager {
	transportInstancer = NODE.USE_TEST_TRANSPORT ? TestTransport : SimplePeer;
	/** @type {SimplePeer.Instance | null} */ #transportInstance = null;

	onError = null; // function(remoteId, error)
	onSignal = null; // function(remoteId, signalData)
	onConnect = null; // function(remoteId, transportInstance)

	readyOffer = null;
	currentAnswerPeerId = null; // -> onSignal 'answer' -> respond to the right peer
	/** @type {Record<string, boolean>} key: peerId, value: true */ #receivedAnswers = {}; // flag
	/** @type {Array<{peerId: string, signal: any, score: number}>} */ #answers = [];

	interval = setInterval(() => {
		if (this.readyOffer && this.#transportInstance) { // already have an offer => try to use answers
			if (!this.onSignal) throw new Error('No onSignal callback defined in SdpOfferManager');
			if (this.currentAnswerPeerId) return; // already processing an answer
			//const answer = this.#answers.shift();
			//if (!answer) return;
			const rndomIndex = Math.random() * this.#answers.length | 0;
			const answer = this.#answers.splice(rndomIndex, 1)[0];
			if (!answer) return;
			this.currentAnswerPeerId = answer.peerId;
			this.#transportInstance?.signal(answer.signal);
			return;
		}

		// no offer => create one
		this.#createOffer().then(offer => {
			this.#receivedAnswers = {};
			this.#answers = [];
			this.readyOffer = offer;
		}).catch(() => {});
	}, 500);

	#createOffer(timeout = 5_000) {
		return new Promise((resolve, reject) => {
			this.#transportInstance = new this.transportInstancer({ initiator: true, trickle: true, wrtc });
			this.#transportInstance.on('error', error => { 
				this.onError(error);
				this.currentAnswerPeerId = null;
				reject(error);
			});
			this.#transportInstance.on('signal', data => { this.#onSignal(data); resolve(data); });
			this.#transportInstance.on('connect', () => this.#onConnect());
			setTimeout(() => reject(new Error('SDP offer generation timeout')), timeout);
		});
	}
	#onSignal(signalData) { // cb > peerStore > Node > Node.sendMessage() [Send directly to peer]
		if (!signalData || signalData.type !== 'answer') return;
		if (!this.onSignal) throw new Error('No onSignal callback defined in SdpOfferManager');
		if (!this.currentAnswerPeerId) return;
		this.onSignal(this.currentAnswerPeerId, signalData);
	}
	#onConnect() {			// cb > peerStore > Node > Node.#onConnect()
		if (!this.onConnect) throw new Error('No onConnect callback defined in SdpOfferManager');
		if (!this.#transportInstance) throw new Error('No transport instance available in SdpOfferManager');
		this.onConnect(this.currentAnswerPeerId, this.#transportInstance, 'out');

		this.#transportInstance = null;
		this.currentAnswerPeerId = null;
		this.readyOffer = null;
	}

	addSignalAnswer(remoteId, signal) {
		if (!signal || signal.type !== 'answer') return; // ignore non-answers
		if (!this.readyOffer) return; // no offer ready, ignore answer
		if (this.#receivedAnswers[remoteId]) return; // already have an answer for this peerId	
		this.#receivedAnswers[remoteId] = true; // flag it
		this.#answers.push({ peerId: remoteId, signal, score: 0 });
	}
	/** @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} remoteSDP */
	getTransportInstanceForSignal(remoteSDP) {
		if (!remoteSDP) throw new Error('No remote SDP provided to getTransportInstanceForSignal');
		if (remoteSDP.type === 'offer' && !remoteSDP.sdp) throw new Error('No SDP in the remote SDP offer');
		if (remoteSDP.type === 'answer' && !remoteSDP.sdp) throw new Error('No SDP in the remote SDP answer');
		if (remoteSDP.type === 'offer') return new this.transportInstancer({ initiator: false, trickle: true, wrtc });
		if (remoteSDP.type === 'answer') return this.#transportInstance;
	}
	destroy() {
		clearInterval(this.interval);
		this.#transportInstance?.destroy();
	}
}
export class Punisher {
	/** @type {Record<string, number>} */ ban = {};
	/** @type {Record<string, number>} */ kick = {};

	/** @param {string} peerId @param {Record<string, PeerConnection>} connected */
	sanctionPeer(peerId, connected, type = 'kick', duration = 60_000) {
		this[type][peerId] = Date.now() + duration;
		connected[peerId]?.close();
	}
	isSanctioned(peerId, type = 'kick') {
		if (!this[type][peerId]) return false;
		if (this[type][peerId] < Date.now()) delete this[type][peerId];
		else return true;
	}
}