import wrtc from 'wrtc';
import { CLOCK, SIMULATION, NODE, TRANSPORTS } from './global_parameters.mjs';
import { xxHash32 } from '../libs/xxhash32.mjs';
const { SANDBOX, ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER } = SIMULATION.ENABLED ? await import('../simulation/test-transports.mjs') : {};

export class PeerConnection { // WebSocket or WebRTC connection wrapper
	pendingUntil;
	transportInstance;
	connStartTime;
	isWebSocket;
	direction;
	peerId;

	/** Connection to a peer, can be WebSocket or WebRTC, can be connecting or connected
	 * @param {string} peerId
	 * @param {import('simple-peer').Instance | import('ws').WebSocket} transportInstance
	 * @param {'in' | 'out'} direction @param {boolean} [isWebSocket] default: false */
	constructor(peerId, transportInstance, direction, isWebSocket = false) {
		this.transportInstance = transportInstance;
		this.isWebSocket = isWebSocket;
		this.direction = direction;
		this.peerId = peerId;
		this.pendingUntil = CLOCK.time + NODE.CONNECTION_UPGRADE_TIMEOUT;
	}
	setConnected() { this.connStartTime = CLOCK.time; }
	getConnectionDuration() { return this.connStartTime ? CLOCK.time - this.connStartTime : 0; }
	close() { this.isWebSocket ? this.transportInstance?.close() : this.transportInstance?.destroy(); }
}
export class KnownPeer { // known peer, not necessarily connected
	neighbors;
	connectionsCount;

	/** @param {Record<string, number>} neighbors key: peerId, value: timestamp */
	constructor(neighbors = {}) {
		this.neighbors = neighbors;
		this.connectionsCount = Object.keys(neighbors).length;
	}
	
	setNeighbor(peerId, timestamp = CLOCK.time) {
		if (!this.neighbors[peerId]) this.connectionsCount++;
		this.neighbors[peerId] = timestamp; // not used for now, we can set Object in value easily
	}
	unsetNeighbor(peerId) {
		if (this.neighbors[peerId]) this.connectionsCount--;
		delete this.neighbors[peerId];
	}
}
export class Punisher { // manage kick and ban of peers
	/** @type {Record<string, number>} */ ban = {};
	/** @type {Record<string, number>} */ kick = {};

	/** @param {string} peerId */
	sanctionPeer(peerId, type = 'kick', duration = 60_000) {
		this[type][peerId] = CLOCK.time + duration;
	}
	isSanctioned(peerId, type = 'kick') {
		if (!this[type][peerId]) return false;
		if (this[type][peerId] < CLOCK.time) delete this[type][peerId];
		else return true;
	}
}

/** - 'bootstrapInfo' Definition & 'OfferObj' Definition
 * @typedef {Object} bootstrapInfo
 * @property {string} id
 * @property {string} publicUrl
 * 
 * @typedef {Object} OfferObj
 * @property {number} timestamp
 * @property {boolean} isUsed // => if true => should be deleted
 * @property {number} sentCounter
 * @property {Object} signal
 * @property {import('simple-peer').Instance} offererInstance
 * @property {Array<{peerId: string, signal: any, timestamp: number, used: boolean}>} answers
 * @property {Record<string, boolean>} answerers key: peerId, value: true */

export class SdpOfferManager { // Manages the creation of SDP offers and handling of answers
	id;
	stunUrls = [];
	verbose = 0;
	/** @param {Array<bootstrapInfo>} bootstraps */
	constructor(id = 'toto', bootstraps = [], verbose = 0) {
		this.id = id;
		this.#deriveSTUNServers(bootstraps);
		this.verbose = verbose;
	}

	onSignalAnswer = null; // function(remoteId, signalData, offerHash)
	onConnect = null; // function(remoteId, transportInstance)
	
	creatingOffer = false; // flag
	offersToCreate = TRANSPORTS.MAX_SDP_OFFERS;
	/** @type {Record<string, OfferObj>} key: offerHash **/ offers = {};

	offerCreationTimeout = null;
	offerInstanceByExpiration = {};

	tick() { // called in peerStore to avoid multiple intervals
		const now = CLOCK.time;
		// CLEAR EXPIRED CREATOR OFFER INSTANCES
		for (const expiration in this.offerInstanceByExpiration) {
			const instance = this.offerInstanceByExpiration[expiration];
			if (now < expiration) continue; // not expired yet
			instance?.destroy();
			delete this.offerInstanceByExpiration[expiration];
			this.creatingOffer = false; // release flag
		}
			
		// CLEAR USED AND EXPIRED OFFERS
		for (const hash in this.offers) {
			const offer = this.offers[hash];
			if (offer.offererInstance.destroyed) { delete this.offers[hash]; continue; } // offerer destroyed
			if (offer.isUsed) { delete this.offers[hash]; continue; } // used offer => remove it (handled by peerStore)
			if (offer.timestamp + TRANSPORTS.SDP_OFFER_EXPIRATION > now) continue; // not expired yet
			offer.offererInstance?.destroy();
			delete this.offers[hash];
		}

		// TRY TO USE AVAILABLE ANSWERS
		let offerCount = 0;
		for (const hash in this.offers) {
			const offer = this.offers[hash];
			offerCount++; // used just behind -> avoid Object.keys() call
			if (offer.offererInstance.destroyed) continue; // offerer destroyed
			const unusedAnswers = offer.answers.filter(a => !a.used);
			if (!unusedAnswers.length) continue; // no answers available
			const newestAnswer = unusedAnswers.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
			if (!newestAnswer) continue; // all answers are used
			newestAnswer.used = true;
			const receivedSince = now - newestAnswer.timestamp;
			if (receivedSince > NODE.CONNECTION_UPGRADE_TIMEOUT / 2) continue; // remote peer will break the connection soon, don't use this answer
			offer.offererInstance.signal(newestAnswer.signal);
			//console.log(`(${this.id}) Using answer from ${newestAnswer.peerId} for offer ${hash} (received since ${receivedSince} ms)`);
			if (this.verbose > 2) console.log(`(SdpOfferManager) Using answer from ${newestAnswer.peerId} for offer ${hash} (received since ${receivedSince} ms)`);
		}

		if (this.creatingOffer) return; // already creating one or unable to send
		if (offerCount >= this.offersToCreate) return; // already have enough offers
		
		// CREATE NEW OFFER
		this.creatingOffer = true;
		const expiration = now + (TRANSPORTS.SIGNAL_CREATION_TIMEOUT || 8_000);
		const instance = this.#createOffererInstance(expiration);
		this.offerInstanceByExpiration[expiration] = instance;
	};
	/** @param {Array<bootstrapInfo>} bootstraps */
	#deriveSTUNServers(bootstraps) {
		for (const b of bootstraps) {
			const domain = b.publicUrl.split(':')[1].replace('//', '');
			const port = parseInt(b.publicUrl.split(':')[2]) + 1;
			this.stunUrls.push({ urls: `stun:${domain}:${port}` });
		}
		// CENTRALIZED STUN SERVERS FALLBACK (GOOGLE) - OPTIONAL
		/*this.stunUrls.push({ urls: 'stun:stun.l.google.com:19302' });
		this.stunUrls.push({ urls: 'stun:stun.l.google.com:5349' });
		this.stunUrls.push({ urls: 'stun:stun1.l.google.com:3478' });
		this.stunUrls.push({ urls: 'stun:stun1.l.google.com:5349' });*/
	}
	#createOffererInstance(expiration) {
		const instance = new TRANSPORTS.PEER({ initiator: true, trickle: false, wrtc, config: { iceServers: this.stunUrls } });
		instance.on('error', error => this.#onError(error));
		instance.on('signal', data => { // trickle: false => only one signal event with the full offer
			const { candidate, type } = data; // with trickle, we need to adapt the approach.
			if (!data || candidate) throw new Error('Unexpected signal data from offerer instance: ' + JSON.stringify(data));
			if (type !== 'offer') throw new Error('Unexpected signal type from offerer instance: ' + type);
			
			// OFFER READY
			delete this.offerInstanceByExpiration[expiration];
			const offerHash = xxHash32(JSON.stringify(data)); // UN PEU BLOQUE ICI (connect on voudrait identifer le peer)
			instance.on('connect', () => { // cb > peerStore > Node > Node.#onConnect()
				if (this.offers[offerHash]) this.offers[offerHash].isUsed = true;
				this.onConnect(undefined, instance);
			});
			this.offers[offerHash] = { timestamp: CLOCK.time, sentCounter: 0, signal: data, offererInstance: instance, answers: [], answerers: {}, isUsed: false };
			this.creatingOffer = false; // release flag
		});

		return instance;
	}
	#onError = (error) => {
		if (this.verbose < 1) return; // avoid logging
		// PRODUCTION (SimplePeer ERRORS)
		if (this.verbose < 2 && error.message.includes('Ice connection failed') ) return; // avoid logging
		if (this.verbose > 1 && error.message.includes('Ice connection failed') ) return console.info(`%c WRTC => ${error.message}`, 'color: orange;');
		if (this.verbose < 2 && error.message.includes('Connection failed')) return; // avoid logging
		if (this.verbose > 1 && error.message.includes('Connection failed')) return console.info(`%c WRTC => ${error.message}`, 'color: orange;');

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
		
		if (this.verbose > 0) console.error(`transportInstance ERROR => `, error.stack);
	};
	/** @param {string} remoteId @param {{type: 'answer', sdp: Record<string, string>}} signal @param {string} offerHash @param {number} timestamp receptionTimestamp */
	addSignalAnswer(remoteId, signal, offerHash, timestamp) {
		if (!signal || signal.type !== 'answer' || !offerHash) return; // ignore non-answers or missing offerHash
		if (!this.offers[offerHash] || this.offers[offerHash].answerers[remoteId]) return; // already have an answer from this peerId
		this.offers[offerHash].answerers[remoteId] = true; // mark as having answered - one answer per peerId
		this.offers[offerHash].answers.push({ peerId: remoteId, signal, timestamp });
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
			const instance = new TRANSPORTS.PEER({ initiator: false, trickle: false, wrtc, config: { iceServers: this.stunUrls } });
			instance.on('error', (error) => this.#onError(error));
			instance.on('signal', (data) => this.onSignalAnswer(remoteId, data, offerHash));
			instance.on('connect', () => this.onConnect(remoteId, instance));
			return new PeerConnection(remoteId, instance, 'in');
		} catch (error) { if (this.verbose > 3) console.error(error.message); }
	}
	destroy() {
		for (const offerHash in this.offers) this.offers[offerHash].offererInstance?.destroy();
	}
}