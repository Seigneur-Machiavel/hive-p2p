import { CLOCK } from '../services/clock.mjs';
import { GOSSIP, UNICAST, LOG_CSS } from './config.mjs';

// TRUST_BALANCE = seconds of ban if negative - never exceed MAX_TRUST if positive
// Growing each second by 1000ms until 0
// Lowered each second by 100ms until 0 (avoid attacker growing balances on multiple disconnected peers)

const BYTES_COUNT_PERIOD 			= 10_000; 		// 10 seconds
const MAX_UNICAST_BYTES_PER_PERIOD 	= 1_000_000; 	// 1MB per period
const MAX_GOSSIP_BYTES_PER_PERIOD 	= 100_000; 		// 100KB per period

const MAX_TRUST 	= 		3_600_000; 		// +3600 seconds = 1 hour of good behavior
export const TRUST_VALUES = {
	// POSITIVE IDENTITY
	VALID_SIGNATURE: 		+10_000, 		// +10 seconds
	VALID_POW: 				+300_000, 		// +5 minutes
	// POSITIVE MESSAGES
	UNICAST_RELAYED: 		+5_000, 		// +5 seconds

	// NEGATIVE IDENTITY
	//WRONG_ID_PREFIX: 		-300_000, 		// -5 minutes
	WRONG_SIGNATURE: 		-600_000, 		// -10 minutes
	WRONG_POW: 				-100_000_000, 	// -100_000 seconds = 27 hours - should never happen with valid nodes

	// NEGATIVE MESSAGES
	WRONG_SERIALIZATION: 	-60_000, 		// -1 minute
	GOSSIP_FLOOD: 			-60_000, 		// -1 minute per message
	UNICAST_FLOOD: 			-30_000, 		// -30 seconds per message
	HOPS_EXCEEDED: 			-300_000, 		// -5 minutes
	UNICAST_INVALID_ROUTE: 	-60_000, 		// -1 minute
	FAILED_HANDSHAKE: 		-600_000, 		// -10 minutes ??? => TODO
	WRONG_LENGTH: 			-600_000, 		// -10 minutes
};
export class Arbiter {
	id; cryptoCodex; verbose;

	/** - Key: peerId,  Value: trustBalance
	 * - trustBalance = milliseconds of ban if negative
	 * @type {Record<string, number>} */
	trustBalances = {};
	bytesCounters = { gossip: {}, unicast: {} };
	bytesCounterResetIn = 0;

	/** @param {string} selfId @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {number} verbose */
	constructor(selfId, cryptoCodex, verbose = 0) {
		this.id = selfId; this.cryptoCodex = cryptoCodex; this.verbose = verbose;
	}

	tick() {
		for (const peerId in this.trustBalances) {
			let balance = this.trustBalances[peerId];
			if (balance === 0) continue; // increase to 0 or decrease slowly to 0
			else balance = balance < 0 ? Math.min(0, balance + 1_000) : Math.max(0, balance - 100);
		}
	
		// RESET GOSSIP BYTES COUNTER
		if (this.bytesCounterResetIn - 1_000 > 0) return;
		this.bytesCounterResetIn = BYTES_COUNT_PERIOD;
		this.bytesCounters = { gossip: {}, unicast: {} };
	}

	/** Call from HiveP2P module only!
	 * @param {string} peerId
	 * @param {'WRONG_SERIALIZATION'} action */
	countPeerAction(peerId, action) {
		if (TRUST_VALUES[action]) return this.adjustTrust(peerId, TRUST_VALUES[action]);
	}
	/** @param {string} peerId @param {number} delta @param {string} [reason] */
	adjustTrust(peerId, delta, reason = 'na') { // Internal and API use - return true if peer isn't banished
		if (peerId === this.id) return; // self
		if (delta) this.trustBalances[peerId] = Math.min(MAX_TRUST, (this.trustBalances[peerId] || 0) + delta);
		if (delta && this.verbose > 3) console.log(`%c(Arbiter: ${this.id}) ${peerId} +${delta}ms (${reason}). Updated: ${this.trustBalances[peerId]}ms.`, LOG_CSS.ARBITER);
		if (this.isBanished(peerId) && this.verbose > 1) console.log(`%c(Arbiter: ${this.id}) Peer ${peerId} is now banished.`, LOG_CSS.ARBITER);
	}
	isBanished(peerId = 'toto') { return (this.trustBalances[peerId] || 0) < 0; }

	// MESSAGE VERIFICATION
	/** @param {string} peerId @param {number} byteLength @param {'gossip' | 'unicast'} type */
	countMessageBytes(peerId, byteLength, type) {
		if (!this.bytesCounters[type][peerId]) this.bytesCounters[type][peerId] = 0;
		this.bytesCounters[type][peerId] += byteLength;
		const [maxByte, penality] = type === 'gossip'
		? [MAX_GOSSIP_BYTES_PER_PERIOD, TRUST_VALUES.GOSSIP_FLOOD]
		: [MAX_UNICAST_BYTES_PER_PERIOD, TRUST_VALUES.UNICAST_FLOOD];
		// If under the limit, return true -> else apply penality and return undefined
		if (this.bytesCounters[type][peerId] < maxByte) return true;
		return this.adjustTrust(peerId, penality, `Message ${type} flood detected`);
	}
	/** Call from HiveP2P module only! @param {string} from @param {any} message @param {Uint8Array} serialized @param {number} [powCheckFactor] default: 0.01 (1%) */
	async digestMessage(from, message, serialized, powCheckFactor = .01) {
		const { senderId, pubkey, topic, expectedEnd } = message; // avoid powControl() on banished peers
		if (!this.#signatureControl(from, message, serialized)) return;
		if (!this.#lengthControl(from, topic ? 'gossip' : 'unicast', serialized, expectedEnd)) return;

		const routeOrHopsOk = topic ? this.#hopsControl(from, message) : this.#routeLengthControl(from, message);
		if (!routeOrHopsOk) return;
		
		if (this.isBanished(from) || this.isBanished(senderId)) return;
		if (this.trustBalances[senderId] > TRUST_VALUES.VALID_POW) return true; // we check only low trust balances
		if (Math.random() < powCheckFactor) await this.#powControl(senderId, pubkey);
		return true;
	}
	/** @param {string} from @param {import('./gossip.mjs').GossipMessage} message @param {Uint8Array} serialized */
	#signatureControl(from, message, serialized) {
		try {
			const { pubkey, signature, signatureStart } = message;
			const signedData = serialized.subarray(0, signatureStart);
			const signatureValid = this.cryptoCodex.verifySignature(pubkey, signature, signedData);
			if (!signatureValid) throw new Error('Gossip signature invalid');
			this.adjustTrust(from, TRUST_VALUES.VALID_SIGNATURE, 'Gossip signature valid');
			return true;
		} catch (error) {
			if (this.verbose > 1) console.error(`%c(Arbiter: ${this.id}) Error during signature verification from ${from}: ${error.stack}`, LOG_CSS.ARBITER);
			if (this.verbose > 2) console.log(`%c(Arbiter) signatureControl() error details: ${message}`, LOG_CSS.ARBITER);
		}
		this.adjustTrust(from, TRUST_VALUES.WRONG_SIGNATURE, 'Gossip signature invalid');
	}
	/** @param {string} from @param {'gossip' | 'unicast'} type */
	#lengthControl(from, type, serialized, expectedEnd) {
		if (!expectedEnd || serialized.length === expectedEnd) return true;
		this.adjustTrust(from, TRUST_VALUES.WRONG_LENGTH, `${type} message length mismatch`);
	}
	/** GOSSIP only @param {string} from @param {import('./gossip.mjs').GossipMessage} message */
	#hopsControl(from, message) {
		if (message.HOPS <= (GOSSIP.HOPS[message.topic] || GOSSIP.HOPS.default)) return true;
		this.adjustTrust(from, TRUST_VALUES.HOPS_EXCEEDED, 'Gossip HOPS exceeded');
	}
	/** UNICAST only @param {string} from @param {import('./unicast.mjs').DirectMessage} message */
	#routeLengthControl(from, message) {
		if (message.route.length <= UNICAST.MAX_HOPS) return true;
		this.adjustTrust(from, TRUST_VALUES.HOPS_EXCEEDED, 'Unicast HOPS exceeded');
	}
	/** ONLY APPLY AFTER #signatureControl() - @param {string} senderId @param {Uint8Array} pubkey */
	async #powControl(senderId, pubkey) {
		const isValid = await this.cryptoCodex.pubkeyDifficultyCheck(pubkey);
		if (isValid) this.adjustTrust(senderId, TRUST_VALUES.VALID_POW, 'Gossip PoW valid');
		else this.adjustTrust(senderId, TRUST_VALUES.WRONG_POW, 'Gossip PoW invalid');
	}
}