import wrtc from 'wrtc';
import { SIMULATION, NODE, TRANSPORT } from './global_parameters.mjs';
import { xxHash32 } from '../utils/xxhash32.mjs';
const { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } = SIMULATION.ENABLED ? await import('../simulation/test-transports.mjs') : {};

/** 
 * @typedef {import('ws').WebSocket} WebSocket
 * @typedef {import('simple-peer').Instance} SimplePeerInstance
 */

export class PeerConnection {
	pendingUntil;
	transportInstance;
	connStartTime;
	isWebSocket;
	direction;
	peerId;

	/** 
	 * @param {string} peerId @param {SimplePeerInstance | WebSocket} transportInstance @param {'in' | 'out'} direction @param {boolean} [isWebSocket] default: false */
	constructor(peerId, transportInstance, direction, isWebSocket = false) {
		this.transportInstance = transportInstance;
		this.isWebSocket = isWebSocket;
		this.direction = direction;
		this.peerId = peerId;
		this.pendingUntil = Date.now() + NODE.CONNECTION_UPGRADE_TIMEOUT;
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

	/** @param {string} peerId */
	sanctionPeer(peerId, type = 'kick', duration = 60_000) {
		this[type][peerId] = Date.now() + duration;
	}
	isSanctioned(peerId, type = 'kick') {
		if (!this[type][peerId]) return false;
		if (this[type][peerId] < Date.now()) delete this[type][peerId];
		else return true;
	}
}
/**
 * @typedef {Object} OfferObj
 * @property {number} timestamp
 * @property {boolean} isUsed // => if true => should be deleted
 * @property {number} sentCounter
 * @property {Object} signal
 * @property {SimplePeerInstance} offererInstance
 * @property {Array<{peerId: string, signal: any, score: number}>} answers
 * @property {Record<string, boolean>} answerers key: peerId, value: true */
export class SdpOfferManager {
	id;
	verbose = 0;
	constructor(id = 'toto', verbose = 0) { this.id = id; this.verbose = verbose; }
	
	onSignal = null; // function(remoteId, signalData, offerHash)
	onConnect = null; // function(remoteId, transportInstance)
	
	creatingOffer = false; // flag
	offers_to_create = TRANSPORT.SDP_OFFERS_TO_CREATE;
	/** @type {Record<string, OfferObj>} key: offerHash **/ offers = {};

	offerCreationTimeout = null;
	interval = setInterval(() => {
		// CLEAR USED AND EXPIRED OFFERS
		const now = Date.now();
		for (const [hash, offer] of Object.entries(this.offers)) {
			if (offer.isUsed) { delete this.offers[hash]; continue; } // used offer => remove it (handled by peerStore)
			if (offer.timestamp + TRANSPORT.SDP_OFFER_EXPIRATION > now) continue; // not expired yet
			offer.offererInstance?.destroy();
			delete this.offers[hash];
		}

		// TRY TO USE AVAILABLE ANSWERS
		for (const [hash, offer] of Object.entries(this.offers)) {
			if (!offer.answers.length) continue; // no answers available
			const randomIndex = Math.random() * offer.answers.length | 0;
			const answer = offer.answers[randomIndex];
			offer.offererInstance.signal(answer.signal);
			if (this.verbose > 2) console.log(`(SdpOfferManager) Using answer from ${answer.peerId} for offer ${hash}`);
		}

		if (this.creatingOffer) return; // already creating one
		if (Object.keys(this.offers).length >= this.offers_to_create) return; // already have enough offers
		
		// CREATE NEW OFFER
		this.creatingOffer = true;
		const instance = this.#createOffererInstance();
		this.offerCreationTimeout = setTimeout(() => { // => on failure or cleaned up on signal
			this.offerCreationTimeout = null;
			instance?.destroy();
			this.creatingOffer = false; // release flag
		}, 5_000);
	}, 500);
	#createOffererInstance() {
		const instance = new TRANSPORT.PEER({ initiator: true, trickle: false, wrtc });
		instance.on('error', error => this.#onError(error));
		instance.on('signal', data => { // trickle: false => only one signal event with the full offer
			const { candidate, type } = data; // with trickle, we need to adapt the approach.
			if (!data || candidate) throw new Error('Unexpected signal data from offerer instance: ' + JSON.stringify(data));
			if (type !== 'offer') throw new Error('Unexpected signal type from offerer instance: ' + type);
			
			// OFFER READY
			if (this.offerCreationTimeout) clearTimeout(this.offerCreationTimeout);
			this.offerCreationTimeout = null;

			const offerHash = xxHash32(JSON.stringify(data)); // UN PEU BLOQUE ICI (connect on voudrait identifer le peer)
			instance.on('connect', () => { // cb > peerStore > Node > Node.#onConnect()
				if (this.offers[offerHash]) this.offers[offerHash].isUsed = true;
				this.onConnect(undefined, instance);
			});
			this.offers[offerHash] = { timestamp: Date.now(), sentCounter: 0, signal: data, offererInstance: instance, answers: [], answerers: {}, isUsed: false };
			this.creatingOffer = false; // release flag
		});

		return instance;
	}
	#onError = (error) => {
		if (this.verbose < 1) return; // avoid logging
		if (this.verbose < 3 && error.message.startsWith('Simulated failure')) return; // avoid logging
		if (this.verbose < 2 && error.message.startsWith('Failed to digest')) return; // avoid logging
		if (this.verbose < 2 && error.message.startsWith('No peer found')) return; // avoid logging
		if (this.verbose < 2 && error.message.startsWith('Missing transport instance')) return; // avoid logging
		if (this.verbose < 2 && error.message.startsWith('Failed to create answer')) return; // avoid logging
		if (this.verbose < 3 && error.message.startsWith('Transport instance already')) return; // avoid logging
		if (this.verbose < 2 && error.message === 'cannot signal after peer is destroyed') return; // avoid logging

		if (this.verbose < 3 && error.message.startsWith('No pending')) return; // avoid logging
		if (this.verbose > 2 && error.message.startsWith('No pending')) return console.info(`%c${error.message}`, 'color: orange;');
		
		if (this.verbose < 3 && error.message.includes('is already linked')) return; // avoid logging
		if (this.verbose > 2 && error.message.startsWith('Simulated failure')) return console.info(`%c${error.message}`, 'color: orange;');
		
		if (this.verbose < 3 && error.message.startsWith('There is already a pending')) return; // avoid logging
		if (this.verbose > 2 && error.message.startsWith('There is already a pending')) return console.info(`%c${error.message}`, 'color: orange;');
		
		if (this.verbose < 3 && error.message.includes('closed the connection')) return; // avoid logging
		if (this.verbose > 2 && error.message.includes('closed the connection')) return console.info(`%c${error.message}`, 'color: orange;');
		console.error(`transportInstance ERROR => `, error.stack);
	};
	addSignalAnswer(remoteId, signal, offerHash) { // OFFER HASH NEEDED IN HERE
		if (!signal || signal.type !== 'answer' || !offerHash) return; // ignore non-answers or missing offerHash
		if (!this.offers[offerHash] || this.offers[offerHash].answerers[remoteId]) return; // already have an answer from this peerId
		this.offers[offerHash].answerers[remoteId] = true; // mark as having answered - one answer per peerId
		this.offers[offerHash].answers.push({ peerId: remoteId, signal, score: 0 });
		if (this.verbose > 3) console.log(`(SdpOfferManager) Added answer from ${remoteId} for offer ${offerHash}`);
	}
	/** @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} signal @param {string} [offerHash] offer only */
	getPeerConnexionForSignal(remoteId, signal, offerHash) {
		try {
			if (!signal || !signal.type || !signal.sdp) throw new Error('Wrong remote SDP provided');
			
			const { type, sdp } = signal;
			if (type !== 'offer' && type !== 'answer') throw new Error('Invalid remote SDP type');
			if (type === 'offer' && !sdp) throw new Error('No SDP in the remote SDP offer');
			if (type === 'answer' && !sdp) throw new Error('No SDP in the remote SDP answer');
			
			if (type === 'answer') { // NEED TO FIND THE PENDING OFFERER INSTANCE
				const instance = offerHash ? this.offers[offerHash]?.offererInstance : null;
				if (!instance) throw new Error('No pending offer found for the given offer hash to accept the answer');
				return new PeerConnection(remoteId, instance, 'out');
			}
			
			// type === 'offer' => CREATE ANSWERER INSTANCE
			const instance = new TRANSPORT.PEER({ initiator: false, trickle: false, wrtc });
			instance.on('error', (error) => this.#onError(error));
			instance.on('signal', (data) => this.onSignal(remoteId, data, offerHash));
			instance.on('connect', () => this.onConnect(remoteId, instance));
			return new PeerConnection(remoteId, instance, 'in');
		} catch (error) { if (this.verbose > 3) console.error(error.message); }
	}
	destroy() {
		clearInterval(this.interval);
		for (const [offerHash, offerObj] of Object.entries(this.offers)) offerObj.offererInstance?.destroy();
	}
}