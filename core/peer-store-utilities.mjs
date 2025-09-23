import { CLOCK, SIMULATION, NODE } from './global_parameters.mjs';
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
	setConnected() { this.connStartTime = CLOCK.time; this.pendingUntil = 0; }
	getConnectionDuration() { return this.connStartTime ? CLOCK.time - this.connStartTime : 0; }
	close() { this.isWebSocket ? this.transportInstance?.close() : this.transportInstance?.destroy(); }
}
export class KnownPeer { // known peer, not necessarily connected
	/** CAUTION: Call this one only in PeerStore.unlinkPeers() */
	connectionsCount;
	neighbors;

	/** @param {Record<string, number>} neighbors key: peerId, value: timestamp */
	constructor(neighbors = {}) {
		this.neighbors = neighbors;
		this.connectionsCount = Object.keys(neighbors).length;
	}

	/** Set or update neighbor @param {string} peerId @param {number} [timestamp] */
	setNeighbor(peerId, timestamp = CLOCK.time) {
		if (!this.neighbors[peerId]) this.connectionsCount++;
		this.neighbors[peerId] = timestamp;
	}
	/** Unset neighbor @param {string} peerId */
	unsetNeighbor(peerId) {
		if (this.neighbors[peerId]) this.connectionsCount--;
		delete this.neighbors[peerId];
	}
}
export class Punisher { // manage kick and ban of peers
	/** @type {Record<string, number>} */ ban = {};
	/** @type {Record<string, number>} */ kick = {};

	/** @param {string} peerId @param {'kick' | 'ban'} [type] default: kick @param {number} [duration] default: 60_000 */
	sanctionPeer(peerId, type = 'kick', duration = 60_000) {
		this[type][peerId] = CLOCK.time + duration;
	}
	/** @param {string} peerId @param {'kick' | 'ban'} [type] default: kick */
	isSanctioned(peerId, type = 'kick') {
		if (!this[type][peerId]) return false;
		if (this[type][peerId] < CLOCK.time) delete this[type][peerId];
		else return true;
	}
}