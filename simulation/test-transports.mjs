import { Sandbox } from './tranports-sandbox.mjs';
const SANDBOX = new Sandbox();

class TestWsEventManager { // manage init() and close() to avoid timeout usage
	/** @type {Array<{ connId: string, clientWsId: string, time: number }> } */ toInit = [];
	/** @type {Array<{ remoteWsId: string, time: number }> } */ toClose = [];

	initInterval = setInterval(() => {
		if (this.toInit.length <= 0) return;
		const n = Date.now();
		const toInit = this.toInit;
		this.toInit = [];
		for (const { connId, clientWsId, time } of toInit)
			if (time > n) this.toInit.push({ connId, clientWsId, time }); // not yet
			else {
				const conn = SANDBOX.wsConnections[connId];
				if (!conn) continue;
				conn?.init(clientWsId); // init connection
			}
	}, 500);
	closeInterval = setInterval(() => {
		if (this.toClose.length <= 0) return;
		const n = Date.now();
		const toClose = this.toClose;
		this.toClose = [];
		for (const { remoteWsId, time } of toClose) {
			const remoteWs = SANDBOX.wsConnections[remoteWsId];
			const closeHandlerReady = remoteWs?.onclose || (remoteWs?.callbacks?.close || []).length;
			if (!closeHandlerReady || time > n) this.toClose.push({ remoteWsId, time }); // not yet
			else remoteWs?.close(); // close connection
		}
	}, 500);

	scheduleInit(connId, clientWsId, delay = 500) { this.toInit.push({ connId, clientWsId, time: Date.now() + delay }); }
	scheduleClose(remoteWsId, delay = 100) { this.toClose.push({ remoteWsId, time: Date.now() + delay }); }
}
const TEST_WS_EVENT_MANAGER = new TestWsEventManager();

// // HERE WE ARE BASICALLY COPYING THE PRINCIPLE OF "WebSocket"
export class TestWsConnection { // WebSocket like
	id;
	remoteWsId;
	delayBeforeConnectionTry = 500;
	readyState = 0;
	url; // outgoing connection only
	// SERVER CALLBACKS
	callbacks = { message: [], close: [], error: [] }
	// CLIENT CALLBACKS
	onmessage; onopen; onclose; onerror;

	constructor(url = 'ws://...', clientWsConnection) {
		if (!clientWsConnection) this.url = url;
		SANDBOX.inscribeWsConnection(this);
		TEST_WS_EVENT_MANAGER.scheduleInit(this.id, clientWsConnection?.id, this.delayBeforeConnectionTry);
	}
	init(clientWsId) {
		if (this.readyState === 3) return; // already closed
		if (this.remoteWsId) return; // already initialized
		if (clientWsId) this.remoteWsId = clientWsId;
		else this.remoteWsId = SANDBOX.connectToWebSocketServer(this.url, this, TestWsConnection);

		if (!this.remoteWsId && clientWsId)
			setTimeout(() => this.#dispatchError(new Error(`Failed to connect to WebSocket server at ${this.url}`)), 5_000);

		if (this.remoteWsId) this.readyState = 1; // OPEN
		if (this.remoteWsId && this.onopen) this.onopen();
	}
	on(event, callback) {
		if (!this.callbacks[event]) return console.error(`Unknown event: ${event}`);
		this.callbacks[event].push(callback);
	}
	close() {
		if (this.closing) return;
		this.closing = true;
		this.readyState = 3; // CLOSED
		this.callbacks.close.forEach(cb => cb()); // emit close event
		if (this.onclose) this.onclose();
		if (this.remoteWsId) TEST_WS_EVENT_MANAGER.scheduleClose(this.remoteWsId, 100);
	}
	send(message) {
		if (!this.remoteWsId) {
			console.error(`No WebSocket server found for URL: ${this.url}`);
			this.close(); // disconnected, abort operation
			return;
		}
		SANDBOX.enqueueWsMessage(this.remoteWsId, message);
	}
	#dispatchError(error) {
		this.callbacks.error.forEach(cb => cb(error));
		if (this.onerror) this.onerror(error);
	}
}
export class TestWsServer { // WebSocket like
	url;
	clients = new Set();
	maxClients = 10;
	callbacks = {
		connection: [(conn) => {
			if (this.closing) return TEST_WS_EVENT_MANAGER.scheduleClose(conn, 100);
			if (this.clients.size < this.maxClients) this.clients.add(conn);
			else TEST_WS_EVENT_MANAGER.scheduleClose(conn, 100); // max clients reached, close connection
		}],
		close: [],
		error: []
	};
	cleanerInterval = setInterval(() => this.cleaner(), 2_000);

	constructor(opts = { port, host: domain }) {
		this.url = `ws://${opts.host}:${opts.port}`;
		SANDBOX.inscribeWebSocketServer(this.url, this);
	}
	cleaner() {
		for (const client of this.clients) if (client.readyState === 3) this.clients.delete(client);
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
	/** @type {number} */
	static signalCreationDelay = { min: 100, max: 500 }; // truly random between 100 and 500ms
	/** @type {boolean} */
	initiator;
	/** @type {boolean} */
	trickle;
	/** @type {any} */
	wrtc;
}
class ICECandidateEmitter {
	/** @type {Array<{ transport: TestTransport, SDP: string, time: number }>} */ sdpToEmit = [];

	emitInterval = setInterval(() => {
		if (this.sdpToEmit.length <= 0) return;
		const n = Date.now();
		const toEmit = this.sdpToEmit;
		this.sdpToEmit = [];
		for (const { transport, SDP, time } of toEmit)
			if (time > n) this.sdpToEmit.push({ transport, SDP, time }); // not yet
			else transport?.callbacks?.signal?.forEach(cb => cb(SDP)); // emit signal event
	}, 500);

	emit(transport, SDP) {
		const delayRange = TestTransportOptions.signalCreationDelay;
		const delay = Math.floor(Math.random() * (delayRange.max - delayRange.min + 1)) + delayRange.min;
		this.sdpToEmit.push({ transport, SDP, time: Date.now() + delay });
	}
}
const ICE_CANDIDATE_EMITTER = new ICECandidateEmitter();

export class TestTransport { // SimplePeer like
	id = null;
	remoteId = null; // Can send message only if corresponding remoteId on both sides
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

		if (!this.initiator) return; // standby
		const signalData = SANDBOX.buildSDP(this.id, 'offer'); // emit signal event 'offer'
		ICE_CANDIDATE_EMITTER.emit(this, signalData);
	}

	destroy(errorMsg = null) {
		if (this.closing) return;
		this.closing = true;
		if (errorMsg) this.dispatchError(errorMsg);

		this.callbacks.close?.forEach(cb => cb());
		SANDBOX.destroyTransport(this.id);
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
		if (remoteSDP.type === 'offer' && SANDBOX.PENDING_OFFERS[this.id]) return this.dispatchError(`Signal with ID ${this.id} already exists.`);
		if (!remoteSDP.sdp || !remoteSDP.sdp.id || (remoteSDP.type !== 'offer' && remoteSDP.type !== 'answer')) return this.dispatchError('Invalid remote SDP:', remoteSDP);

		const { success, signalData, reason } = SANDBOX.digestSignal(remoteSDP, this.id);
		if (!success) return this.dispatchError(reason || `Failed to digest signal for peer: ${this.id}`);
		if (signalData) ICE_CANDIDATE_EMITTER.emit(this, signalData);
	}
	/** @param {string | Uint8Array} message */
	send(message) {
		const { success, reason } = SANDBOX.sendData(this.id, this.remoteId, message);
		if (reason?.includes('is closing')) return this.destroy(reason);
		if (!success) console.warn(reason);
	}
	close() {
		this.destroy();
	}
}