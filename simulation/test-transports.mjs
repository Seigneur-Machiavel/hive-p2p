import { SIMULATION } from '../core/global_parameters.mjs';
import { Sandbox, ICECandidateEmitter } from './tranports-sandbox.mjs';

class TestWsEventManager { // manage init() and close() to avoid timeout usage
	/** @type {Array<{ connId: string, clientWsId: string, time: number }> } */ toInit = [];
	/** @type {Array<{ remoteWsId: string, time: number }> } */ toClose = [];

	initInterval = setInterval(() => {
		if (this.toInit.length <= 0) return;
		const n = Date.now();
		const toInit = this.toInit;
		this.toInit = [];
		for (const { connId, time } of toInit)
			if (time > n) this.toInit.push({ connId, time }); // not yet
			else this.#connectToWebSocketServer(connId);
	}, 500);
	closeInterval = setInterval(() => {
		if (this.toClose.length <= 0) return;
		const n = Date.now();
		const toClose = this.toClose;
		this.toClose = [];
		for (const { wsId, remoteWsId, time } of toClose) {
			if (time > n) this.toClose.push({ wsId, remoteWsId, time }); // not yet
			else this.#disconnectWsInstances(wsId, remoteWsId);
		}
	}, 500);

	#connectToWebSocketServer(connId) {
		const conn = SANDBOX.wsConnections[connId];
		if (!conn) return;
		SANDBOX.connectToWebSocketServer(conn.url, conn.id, TestWsConnection);
	}
	#disconnectWsInstances(wsId, remoteWsId) {
		const ws = SANDBOX.wsConnections[wsId];
		const remoteWs = SANDBOX.wsConnections[remoteWsId];
		ws?.onclose?.(); // emit close event (client)
		remoteWs?.onclose?.(); // close connection (client)
		for (const cb of ws?.callbacks?.close || []) cb(); // emit close event (server)
		for (const cb of remoteWs?.callbacks?.close || []) cb(); // emit close event (server)
	}
	// API
	scheduleInit(connId, delay = 500) { this.toInit.push({ connId, time: Date.now() + delay }); }
	scheduleClose(wsId, remoteWsId, delay = 100) { this.toClose.push({ wsId, remoteWsId, time: Date.now() + delay }); }
}

// // HERE WE ARE BASICALLY COPYING THE PRINCIPLE OF "WebSocket"
export class TestWsConnection { // WebSocket like
	id;
	isTestTransport = true;
	remoteWsId = null;
	remoteId = false; // flag for debug
	delayBeforeConnectionTry = 500;
	readyState = 0;
	url; // outgoing connection only
	// SERVER CALLBACKS
	callbacks = { message: [], close: [], error: [] }
	// CLIENT CALLBACKS
	onmessage; onopen; onclose; onerror;

	constructor(url = 'ws://...', oppositeWsConnectionId) {
		SANDBOX.inscribeWsConnection(this);
		if (oppositeWsConnectionId) return;
		this.url = url;
		TEST_WS_EVENT_MANAGER.scheduleInit(this.id, this.delayBeforeConnectionTry);
	}
	init(remoteWsId) {
		if (!this.readyState === 3 || this.remoteWsId) {
			this.close(); // => ensure closure
			setTimeout(() => this.#dispatchError(`Failed to connect to WebSocket server at ${this.url}`), 1_000);
			return;
		}

		this.remoteWsId = remoteWsId;
		this.readyState = 1; // OPEN
		if (this.onopen) this.onopen();
	}
	on(event, callback) {
		if (!this.callbacks[event]) return console.error(`Unknown event: ${event}`);
		this.callbacks[event].push(callback);
	}
	close() {
		if (this.readyState === 3) return;
		this.readyState = 3; // CLOSED
		const remoteWs = SANDBOX.wsConnections[this.remoteWsId];
		if (remoteWs) remoteWs.readyState = 3; // CLOSED
		if (this.remoteWsId) TEST_WS_EVENT_MANAGER.scheduleClose(this.id, this.remoteWsId, 100);
	}
	send(message) {
		if (!this.remoteWsId) {
			console.error(`No WebSocket server found for URL: ${this.url}`);
			this.close(); // disconnected, abort operation
			return;
		}
		SANDBOX.enqueueWsMessage(this.id, this.remoteWsId, message);
	}
	#dispatchError(error) {
		this.callbacks.error.forEach(cb => cb(error));
		if (this.onerror) this.onerror(error);
	}
}
export class TestWsServer { // WebSocket like
	url;
	clients = new Set();
	maxClients = SIMULATION.MAX_WS_IN_CONNS || 20;
	callbacks = {
		connection: [],
		close: [],
		error: []
	};
	cleanerInterval = setInterval(() => {
		for (const client of this.clients)
			if (client.readyState === 3) this.clients.delete(client);
	}, 2_000);

	constructor(opts = { port, host: domain }) {
		this.url = `ws://${opts.host}:${opts.port}`;
		SANDBOX.inscribeWebSocketServer(this.url, this);
	}
	on(event, callback) {
		if (!this.callbacks[event]) return console.error(`Unknown event: ${event}`);
		this.callbacks[event].push(callback);
	}
	close() {
		if (this.closing) return;
		this.closing = true;
		SANDBOX.removeWebSocketServer(this.url);
		for (const cb of this.callbacks.close) cb();
	}
}

// HERE WE ARE BASICALLY COPYING THE PRINCIPLE OF "SimplePeer"
class TestTransportOptions {
	/** @type {boolean} */
	initiator;
	/** @type {boolean} */
	trickle;
	/** @type {any} */
	wrtc;
}

export class TestTransport { // SimplePeer like
	id = null;
	isTestTransport = true;
	remoteId = null; // Can send message only if corresponding remoteId on both sides
	remoteWsId = false; // flag for debug
	callbacks = { connect: [], close: [], data: [], signal: [], error: [] };
	initiator; 	// SimplePeer.Options
	trickle; 	// SimplePeer.Options
	wrtc; 		// SimplePeer.Options
	/** @param {TestTransportOptions} opts */
	constructor(opts = { initiator: false, trickle: true, wrtc: null, timeout: 5000 }) {
		SANDBOX.inscribeInstance(this);
		this.initiator = opts.initiator;
		this.trickle = opts.trickle;
		this.wrtc = opts.wrtc;
		if (this.initiator) ICE_CANDIDATE_EMITTER.buildSDP(this.id, 'offer');
	}

	on(event, callbacks) {
		if (this.callbacks[event]) this.callbacks[event].push(callbacks);
	}
	dispatchError(message) {
		this.callbacks.error.forEach(cb => cb(new Error(message)));
	}
	signal(remoteSDP) {
		if (this.closing) return;
		if (this.remoteId) return this.dispatchError(`Transport instance already connected to a remote ID: ${this.remoteId}`);
		if (!remoteSDP.sdp || !remoteSDP.sdp.id) return this.dispatchError('Invalid remote SDP:', remoteSDP);
		if (remoteSDP.type === 'answer' && !this.initiator) return this.dispatchError('Invalid remote SDP type: expecting an answer.');
		if (remoteSDP.type === 'offer' && this.initiator) return this.dispatchError('Invalid remote SDP type: expecting an offer.');

		ICE_CANDIDATE_EMITTER.digestSignal(remoteSDP, this.id);
	}
	/** @param {string | Uint8Array} message */
	send(message) {
		const { success, reason } = SANDBOX.sendData(this.id, this.remoteId, message);
		if (!success) this.destroy(reason);
	}
	close() {
		this.destroy();
	}
	destroy(errorMsg = null) {
		if (this.closing) return;
		this.closing = true;
		if (errorMsg) this.dispatchError(errorMsg);

		this.callbacks.close?.forEach(cb => cb());
		SANDBOX.destroyTransportAndAssociatedTransport(this.id);
	}
}

// INSTANCIATE
export const SANDBOX = new Sandbox();
export const ICE_CANDIDATE_EMITTER = new ICECandidateEmitter(SANDBOX);
export const TEST_WS_EVENT_MANAGER = new TestWsEventManager();