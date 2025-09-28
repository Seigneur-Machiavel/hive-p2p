import { CLOCK, NODE, TRANSPORTS, LOG_CSS } from './config.mjs';
import { xxHash32 } from '../libs/xxhash32.mjs';
async function getWrtc() {
    if (typeof globalThis.RTCPeerConnection !== 'undefined') return undefined;
    return (await import('wrtc')).default;
}
const wrtc = await getWrtc();

/** - 'OfferObj' Definition
 * @typedef {Object} OfferObj
 * @property {number} timestamp
 * @property {boolean} isUsed // => if true => should be deleted
 * @property {number} sentCounter
 * @property {Object} signal
 * @property {import('simple-peer').Instance} offererInstance
 * @property {boolean} isDigestingOneAnswer Flag to avoid multiple answers handling at the same time (DISCOVERY.LOOP_DELAY (2.5s) will be doubled (5s) between two answers handling)
 * @property {Array<{peerId: string, signal: any, timestamp: number, used: boolean}>} answers
 * @property {Record<string, boolean>} answerers key: peerId, value: true */

export class OfferManager { // Manages the creation of SDP offers and handling of answers
	id;
	verbose;
	stunUrls;

	/** @param {string} id @param {Array<{urls: string}>} stunUrls */
	constructor(id, stunUrls, verbose = 0) { this.id = id; this.verbose = verbose; this.stunUrls = stunUrls; }

	onSignalAnswer = null; 		// function(remoteId, signalData, offerHash)
	onConnect = null; 			// function(remoteId, transportInstance)
	
	/** @type {Record<number, import('simple-peer').Instance>} key: expiration timestamp */
	offerInstanceByExpiration = {};
	creatingOffer = false; 		// flag to avoid multiple simultaneous creations (shared between all offers)
	offerCreationTimeout = null; // sequential creation timeout (shared between all offers)
	offersToCreate = TRANSPORTS.MAX_SDP_OFFERS;
	/** @type {Record<string, OfferObj>} key: offerHash **/ offers = {};

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
			offerCount++; // [live at the first line of the loop] used just below -> avoid Object.keys() call
			const offer = this.offers[hash];
			if (offer.isDigestingOneAnswer) { offer.isDigestingOneAnswer = false; continue; }
			if (offer.offererInstance.destroyed) continue; // offerer destroyed
			
			const unusedAnswers = offer.answers.filter(a => !a.used);
			if (!unusedAnswers.length) continue; // no answers available
			
			const newestAnswer = unusedAnswers.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
			if (!newestAnswer) continue; // all answers are used

			newestAnswer.used = true;
			const receivedSince = now - newestAnswer.timestamp;
			if (receivedSince > NODE.CONNECTION_UPGRADE_TIMEOUT / 2) continue; // remote peer will break the connection soon, don't use this answer
			offer.offererInstance.signal(newestAnswer.signal);
			offer.isDigestingOneAnswer = true;
			if (this.verbose > 2) console.log(`(${this.id}) Using answer from ${newestAnswer.peerId} for offer ${hash} (received since ${receivedSince} ms)`);
		}

		if (this.creatingOffer) return; // already creating one or unable to send
		if (offerCount >= this.offersToCreate) return; // already have enough offers
		
		// CREATE NEW OFFER
		this.creatingOffer = true;
		const expiration = now + (TRANSPORTS.SIGNAL_CREATION_TIMEOUT || 8_000);
		const instance = this.#createOffererInstance(expiration);
		this.offerInstanceByExpiration[expiration] = instance;
	};
	#createOffererInstance(expiration) {
		const iceCompleteTimeout = TRANSPORTS.ICE_COMPLETE_TIMEOUT || 1_000;
		const instance = new TRANSPORTS.PEER({ initiator: true, trickle: false, iceCompleteTimeout, wrtc, config: { iceServers: this.stunUrls } });
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
	/** @param {Error} error @param {string} incl @param {number} level @param {'includes' | 'startsWith'} searchMode (Prefer 'startsWith' for performance) */
	#logAndOrIgnore(error, incl = '', level = 2, searchMode = 'includes') { // if false => log it fully, if true => ignore it (message logged or ignored based on level)
		if (searchMode[0] === 'i' && !error.message.includes(incl)) return false;
		else if (!error.message.startsWith(incl)) return false;
		if (this.verbose >= level) console.info(`%cOfferManager => ${error.message}`, LOG_CSS.PEER_STORE);
		return true;
	}
	#onError = (error) => {
		if (this.verbose < 1) return; // avoid logging
		// PRODUCTION (SimplePeer ERRORS) --|
		if (this.#logAndOrIgnore(error, 'Ice connection failed', 2)) return;
		if (this.#logAndOrIgnore(error, 'Connection failed', 2)) return;
		// --PRODUCTION ----------------- --|

		if (this.#logAndOrIgnore(error, 'Remote transport instance', 3, 'startsWith')) return;
		if (this.#logAndOrIgnore(error, 'Simulated failure', 4, 'startsWith')) return;
		if (this.#logAndOrIgnore(error, 'No peer found', 4, 'startsWith')) return;
		if (this.#logAndOrIgnore(error, 'Missing transport instance', 2, 'startsWith')) return;
		if (this.#logAndOrIgnore(error, 'Failed to create answer', 2, 'startsWith')) return;
		if (this.#logAndOrIgnore(error, 'Transport instance', 3, 'startsWith')) return;
		if (this.#logAndOrIgnore(error, 'cannot signal after peer is destroyed', 3, 'startsWith')) return;
		if (this.#logAndOrIgnore(error, 'No pending', 3)) return;
		if (this.#logAndOrIgnore(error, 'is already linked', 3)) return;
		if (this.#logAndOrIgnore(error, 'There is already a pending', 3)) return;
		if (this.#logAndOrIgnore(error, 'closed the connection', 3)) return;
		if (this.#logAndOrIgnore(error, 'No transport instance found for id:', 3)) return;

		if (this.verbose > 0) console.error(`transportInstance ERROR => `, error.stack);
	};
	/** @param {string} remoteId @param {{type: 'answer', sdp: Record<string, string>}} signal @param {string} offerHash @param {number} timestamp receptionTimestamp */
	addSignalAnswer(remoteId, signal, offerHash, timestamp) {
		if (!signal || signal.type !== 'answer' || !offerHash) return; // ignore non-answers or missing offerHash
		if (!this.offers[offerHash] || this.offers[offerHash].answerers[remoteId]) return; // already have an answer from this peerId
		this.offers[offerHash].answerers[remoteId] = true; // mark as having answered - one answer per peerId
		this.offers[offerHash].answers.push({ peerId: remoteId, signal, timestamp });
		if (this.verbose > 3) console.log(`(OfferManager) Added answer from ${remoteId} for offer ${offerHash}`);
	}
	/** @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} signal @param {string} [offerHash] offer only */
	getTransportInstanceForSignal(remoteId, signal, offerHash) {
		try {
			if (!signal || !signal.type || !signal.sdp) throw new Error('Wrong remote SDP provided');
			
			const { type, sdp } = signal;
			if (type !== 'offer' && type !== 'answer') throw new Error('Invalid remote SDP type');
			if (type === 'offer' && !sdp) throw new Error('No SDP in the remote SDP offer');
			if (type === 'answer' && !sdp) throw new Error('No SDP in the remote SDP answer');
			
			if (type === 'answer') { // NEED TO FIND THE PENDING OFFERER INSTANCE
				const instance = offerHash ? this.offers[offerHash]?.offererInstance : null;
				if (!instance) throw new Error('No pending offer found for the given offer hash to accept the answer');
				return instance;
			}
			
			// type === 'offer' => CREATE ANSWERER INSTANCE
			const iceCompleteTimeout = TRANSPORTS.ICE_COMPLETE_TIMEOUT || 1_000;
			const instance = new TRANSPORTS.PEER({ initiator: false, trickle: false, iceCompleteTimeout, wrtc, config: { iceServers: this.stunUrls } });
			instance.on('error', (error) => this.#onError(error));
			instance.on('signal', (data) => this.onSignalAnswer(remoteId, data, offerHash));
			instance.on('connect', () => this.onConnect(remoteId, instance));
			return instance;
		} catch (error) {
			if (error.message.startsWith('No pending offer found') && this.verbose < 2) return null; // avoid logging
			if (this.verbose > 1 && error.message.startsWith('No pending offer found')) return console.info(`%c${error.message}`, LOG_CSS.PEER_STORE);
			if (this.verbose > 0) console.error(error.stack);
		}
	}
	destroy() {
		for (const offerHash in this.offers) this.offers[offerHash].offererInstance?.destroy();
	}
}