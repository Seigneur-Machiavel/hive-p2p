import wrtc from 'wrtc';
import { NODE, TRANSPORT } from './global_parameters.mjs';

// DEBUG / SIMULATION
import { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } from '../simulation/test-transports.mjs';

/** 
 * @typedef {import('ws').WebSocket} WebSocket
 * @typedef {import('simple-peer').Instance} SimplePeerInstance
 */

export class PeerConnection {
	transportInstance;
	connStartTime;
	isWebSocket;
	direction;
	peerId;

	/** 
	 * @param {string} peerId @param {SimplePeerInstance | WebSocket} transportInstance @param {'in' | 'out'} direction */
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
	id;
	verbose = 0;
	constructor(id = 'toto', verbose = 0) { this.id = id; this.verbose = verbose; }
	/** @type {SimplePeerInstance | null} */ offerInstance = null;

	onSignal = null; // function(remoteId, signalData)
	onConnect = null; // function(remoteId, transportInstance)

	creatingOffer = false; // flag
	readyOffer = null;
	currentAnswerPeerId = null; // -> onSignal 'answer' -> respond to the right peer
	/** @type {Record<string, boolean>} key: peerId, value: true */ receivedAnswers = {}; // flag
	/** @type {Array<{peerId: string, signal: any, score: number}>} */ answers = [];

	offerCreationTimeout = null;
	interval = setInterval(() => {
		if (this.creatingOffer) return; // already creating one

		if (this.readyOffer && this.offerInstance) { // already have an offer => try to use answers
			if (!this.onSignal) throw new Error('No onSignal callback defined in SdpOfferManager');
			if (this.currentAnswerPeerId) return; // already processing an answer

			const rndomIndex = Math.random() * this.answers.length | 0;
			const answer = this.answers.splice(rndomIndex, 1)[0];
			if (!answer) return;

			this.currentAnswerPeerId = answer.peerId;
			this.offerInstance.signal(answer.signal);
			return;
		}

		this.creatingOffer = true;
		this.offerInstance = this.#createOffererInstance();
		this.offerCreationTimeout = setTimeout(() => {
			this.offerInstance?.destroy();
			this.readyOffer = null;
			this.creatingOffer = false;
		}, 5_000);
	}, 100);
	#createOffererInstance() {
		const instance = new TRANSPORT.PEER({ initiator: true, trickle: false, wrtc });
		instance.on('error', error => this.#onError(error));
		instance.on('signal', data => { // trickle: false => only one signal event with the full offer
			const { candidate, type } = data; // with trickle, we need to adapt the approach.
			if (!data || candidate) return; // ignore trickle candidates -> wait for the full offer
			
			if (type === 'answer') {
				if (!this.onSignal) throw new Error('No onSignal callback defined in SdpOfferManager');
				if (!this.currentAnswerPeerId) return;
				this.onSignal(this.currentAnswerPeerId, data); // cb > peerStore > Node > Node.sendMessage() [Send directly to peer]
			}
			
			if (type !== 'offer') throw new Error(`Unexpected signal type from offerer instance: ${type}`);

			if (this.offerCreationTimeout) clearTimeout(this.offerCreationTimeout);
			this.offerCreationTimeout = null;
			this.offerInstance = instance;
			this.readyOffer = data;
			this.creatingOffer = false;
		});
		instance.on('connect', () => { // cb > peerStore > Node > Node.#onConnect()
			if (!this.onConnect) throw new Error('No onConnect callback defined in SdpOfferManager');
			if (!this.offerInstance) throw new Error('No transport instance available in SdpOfferManager');
			this.onConnect(this.currentAnswerPeerId, this.offerInstance, 'out');
			this.offerInstance = null; // release instance -> handled by peerStore now
			this.reset();
		});

		return instance;
	}
	#onError = (error) => {
		if (!this.verbose) return;
		if (this.verbose < 2 && error.message.includes('Missing transport instance')) return; // avoid logging
		if (this.verbose < 2 && error.message.includes('Failed to create answer')) return; // avoid logging
		if (this.verbose < 3 && error.message.includes('Transport instance already')) return; // avoid logging
		if (this.verbose < 3 && error.message.includes('is already linked')) return; // avoid logging
		if (this.verbose > 2 && error.message.includes('Simulated failure')) return console.warn(error.message);
		if (this.verbose < 3 && error.message.includes('Simulated failure')) return; // avoid logging
		if (this.verbose < 2 && error.message.includes('Failed to digest')) return; // avoid logging
		if (this.verbose < 2 && error.message.includes('No peer found')) return; // avoid logging
		if (this.verbose < 2 && error.message === 'cannot signal after peer is destroyed') return; // avoid logging
		console.error(`transportInstance ERROR => `, error.stack);
	};
	reset() {
		this.offerInstance?.destroy();
		this.offerInstance = null;
		this.readyOffer = null;
		this.currentAnswerPeerId = null;
		this.receivedAnswers = {};
		this.answers = [];
	}

	addSignalAnswer(remoteId, signal) {
		if (!signal || signal.type !== 'answer') return; // ignore non-answers
		if (!this.readyOffer) return; // no offer ready, ignore answer
		if (this.receivedAnswers[remoteId]) return; // already have an answer for this peerId	
		this.receivedAnswers[remoteId] = true; // flag it
		this.answers.push({ peerId: remoteId, signal, score: 0 });
	}
	/** @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} remoteSDP */
	getPeerConnexionForSignal(remoteId, remoteSDP, verbose = 0) {
		try {
			if (!remoteSDP || !remoteSDP.type || !remoteSDP.sdp) throw new Error('Wrong remote SDP provided');
			
			const { type, sdp } = remoteSDP;
			if (type !== 'offer' && type !== 'answer') throw new Error('Invalid remote SDP type');
			if (type === 'offer' && !sdp) throw new Error('No SDP in the remote SDP offer');
			if (type === 'answer' && !sdp) throw new Error('No SDP in the remote SDP answer');
			
			const instance = type === 'answer' ? this.offerInstance : new TRANSPORT.PEER({ initiator: false, trickle: false, wrtc });
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
		this.offerInstance?.destroy();
	}
}