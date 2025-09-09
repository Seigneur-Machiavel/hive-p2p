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
export class Punisher {
	/** @type {Record<string, number>} */ ban = {};
	/** @type {Record<string, number>} */ kick = {};

	/** @param {string} peerId @param {Record<string, PeerConnection>} connected */
	sanctionPeer(peerId, connected, type = 'kick', duration = 60_000) {
		this[type][peerId] = Date.now() + duration;
	}
	isSanctioned(peerId, type = 'kick') {
		if (!this[type][peerId]) return false;
		if (this[type][peerId] < Date.now()) delete this[type][peerId];
		else return true;
	}
}
export class SdpOfferManager {
	verbose = 0;
	transportInstancer = NODE.USE_TEST_TRANSPORT ? TestTransport : SimplePeer;
	/** @type {SimplePeer.Instance | null} */ #transportInstance = null;

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

			const rndomIndex = Math.random() * this.#answers.length | 0;
			const answer = this.#answers.splice(rndomIndex, 1)[0];
			if (!answer) return;

			this.currentAnswerPeerId = answer.peerId;
			this.#transportInstance?.signal(answer.signal);
			return;
		}

		// no offer => create one
		this.#createOffer().then(offer => this.readyOffer = offer).catch(() => {});
	}, 50);

	#createOffer(timeout = 5_000) {
		return new Promise((resolve, reject) => {
			const instance = new this.transportInstancer({ initiator: true, trickle: true, wrtc });
			instance.on('error', error => {
				this.#onError(error);
				this.currentAnswerPeerId = null;
				reject?.(error);
			});
			instance.on('signal', data => { this.#onSignal(data); resolve?.(data); });
			instance.on('connect', () => this.#onConnect(instance));
			this.#transportInstance = instance;
			setTimeout(() => reject(new Error('SDP offer generation timeout')), timeout);
		},);
	}
	#onError = (error) => {
		if (!this.verbose) return;
		if (!NODE.USE_TEST_TRANSPORT) {
			console.error(`Transport Instance Error:`, error);
			return;
		}
		if (error.message.includes('Missing transport instance')) return; // avoid logging
		if (error.message.includes('Failed to create answer')) return; // avoid logging
		if (error.message.includes('Transport instance already')) return; // avoid logging
		if (error.message.includes('is already linked')) return; // avoid logging
		if (error.message.includes('Simulated failure')) return; // avoid logging
		if (error.message.includes('Failed to digest')) return; // avoid logging
		if (error.message.includes('No peer found')) return; // avoid logging
		if (error.message === 'cannot signal after peer is destroyed') return; // avoid logging
		console.error(`transportInstance ERROR => `, error.stack);
	};
	#onSignal(signalData) { // cb > peerStore > Node > Node.sendMessage() [Send directly to peer]
		if (!signalData || signalData.type !== 'answer') return;
		if (!this.onSignal) throw new Error('No onSignal callback defined in SdpOfferManager');
		if (!this.currentAnswerPeerId) return;
		this.onSignal(this.currentAnswerPeerId, signalData);
	}
	#onConnect(instance) {			// cb > peerStore > Node > Node.#onConnect()
		if (!this.onConnect) throw new Error('No onConnect callback defined in SdpOfferManager');
		if (!instance) throw new Error('No transport instance available in SdpOfferManager');
		this.onConnect(this.currentAnswerPeerId, instance, 'out');
		this.#transportInstance = null; // release instance -> handled by peerStore now
		this.reset();
	}
	reset() {
		if (this.#transportInstance) this.#transportInstance.destroy();
		this.readyOffer = null;
		this.#transportInstance = null;
		this.currentAnswerPeerId = null;
		this.#receivedAnswers = {};
		this.#answers = [];
	}

	addSignalAnswer(remoteId, signal) {
		if (!signal || signal.type !== 'answer') return; // ignore non-answers
		if (!this.readyOffer) return; // no offer ready, ignore answer
		if (this.#receivedAnswers[remoteId]) return; // already have an answer for this peerId	
		this.#receivedAnswers[remoteId] = true; // flag it
		this.#answers.push({ peerId: remoteId, signal, score: 0 });
	}
	/** @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} remoteSDP */
	getPeerConnexionForSignal(remoteId, remoteSDP, verbose = 0) {
		try {
			if (!remoteSDP || !remoteSDP.type || !remoteSDP.sdp) throw new Error('Wrong remote SDP provided');
			
			const { type, sdp } = remoteSDP;
			if (type !== 'offer' && type !== 'answer') throw new Error('Invalid remote SDP type');
			if (type === 'offer' && !sdp) throw new Error('No SDP in the remote SDP offer');
			if (type === 'answer' && !sdp) throw new Error('No SDP in the remote SDP answer');
			
			const instance = type === 'answer' ? this.#transportInstance : new this.transportInstancer({ initiator: false, trickle: true, wrtc });
			if (!instance) throw new Error('Failed to create transport instance for the given remote SDP');
			
			if (type === 'offer') { // assign callbacks (offer only, answer is already done)
				instance.on('error', (error) => this.#onError(error));
				instance.on('signal', (data) => this.onSignal(remoteId, data));
				instance.on('connect', () => this.onConnect(remoteId, instance, 'in'));
			}

			return new PeerConnection(remoteId, instance, type === 'offer' ? 'in' : 'out');	
		} catch (error) {
			if (verbose > 0) console.error('Error getting transport instance for remote SDP:', error.message);
			return null;
		}
	}
	destroy() {
		clearInterval(this.interval);
		this.#transportInstance?.destroy();
	}
}