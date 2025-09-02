// HERE WE ARE BASICALLY COPYING THE PRINCIPLE OF "SimplePeer"
import { Sandbox } from './tranports-sandbox.mjs';
const SANDBOX = new Sandbox();

export class TestWsConnection { // WebSocket like
	/** @type {TestWsConnection} */
	remoteWs;
	delayBeforeConnectionTry = 500;
	readyState = 0;
	url; // outgoing connection only
	callbacks = {
		message: [],
		close: []
	}
	onmessage;
	onopen;
	onclose;
	onerror;

	constructor(url = 'ws://...', clientWsConnection) {
		if (!clientWsConnection) this.url = url;
		setTimeout(() => this.#init(clientWsConnection), this.delayBeforeConnectionTry);
	}
	#init(clientWsConnection) {
		if (clientWsConnection) this.remoteWs = clientWsConnection;
		else this.remoteWs = SANDBOX.connectToWebSocketServer(this.url, this, TestWsConnection);

		//if (!this.remoteWs) console.error(`Failed to connect to WebSocket server at ${this.url}`);
		if (!this.remoteWs && clientWsConnection)
			setTimeout(() => this.#dispatchError(new Error(`Failed to connect to WebSocket server at ${this.url}`)), 10_000);

		if (this.remoteWs) this.readyState = 1; // OPEN
		if (this.remoteWs && this.onopen) this.onopen();
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
		setTimeout(() => { if (this.remoteWs) this.remoteWs.close(); }, 100);
	}
	send(message) {
		if (!this.remoteWs) {
			console.error(`No WebSocket server found for URL: ${this.url}`);
			this.close(); // disconnected, abort operation
		}

		//const serialized = JSON.stringify(message);
		this.remoteWs?.callbacks.message.forEach(cb => cb(message)); // emit message event
		if (this.remoteWs?.onmessage) this.remoteWs.onmessage({ data: message }); // emit onmessage event
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
		connection: [ (conn) => this.clients.size < this.maxClients ? this.clients.add(conn) : conn.close() ],
		close: [ (conn) => this.clients.delete(conn) ],
		error: []
	};

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

class TestTransportOptions {
	/** @type {number} */
	signalCreationDelay = 250;
	static defaultSignalCreationDelay = 1000;
	/** @type {boolean} */
	initiator;
	/** @type {boolean} */
	trickle;
	/** @type {any} */
	wrtc;
}

class TransportPool {
	inUse = new Map(); 
	/** @type {TestTransport[]} */ available = [];
	
	constructor(maxSize = 100) { this.maxSize = maxSize; }

	get() {
		if (this.available.length > 0) {
			const transport = this.available.pop();
			transport.reset();
			return transport;
		}
		return new TestTransport();
	}
	release(transport) {
		if (this.available.length >= this.maxSize) transport.destroy();
		else {
			transport.callbacks = {};
			this.available.push(transport);
		}
	}
}

const TRANSPORT_POOL = new TransportPool();

export class TestTransport { // SimplePeer like
	id = 0;
	remoteId = null;
	// SimplePeer.Options: { initiator: !remoteSDP, trickle: true, wrtc }
	callbacks = { connect: [], close: [], data: [], signal: [], error: [] };
	signalCreationDelay;
	initiator;
	trickle;
	wrtc;
	/** @param {TestTransportOptions} opts */
	constructor(opts = { initiator: false, trickle: true, wrtc: null, timeout: 5000 }) {
		this.id = SANDBOX.inscribeInstance(this);
		this.signalCreationDelay = opts.signalCreationDelay || TestTransportOptions.defaultSignalCreationDelay;
		this.initiator = opts.initiator;
		this.trickle = opts.trickle;
		this.wrtc = opts.wrtc;

		if (!this.initiator) return; // standby
		const SDP = SANDBOX.buildSDP(this.id, 'offer'); // emit signal event 'offer'
		setTimeout(() => this.callbacks.signal.forEach(cb => cb(SDP)), this.signalCreationDelay);
	}

	reset() {
		this.remoteId = null;
		this.closing = false;
		this.callbacks = { connect: [], close: [], data: [], signal: [], error: [] };
	}
	destroy(errorMsg = null) {
		if (this.closing) return;
		this.closing = true;
		if (!errorMsg) this.callbacks.close?.forEach(cb => cb());
		else this.dispatchError(errorMsg);
		SANDBOX.destroyTransport(this.id);
		setTimeout(() => TRANSPORT_POOL.release(this), 1000);
	}
	static create(opts) {
		const transport = TRANSPORT_POOL.get();
		transport.constructor.call(transport, opts);
		return transport;
	}

	on(event, callbacks) {
		if (this.callbacks[event]) this.callbacks[event].push(callbacks);
	}
	dispatchError(message) {
		this.callbacks.error.forEach(cb => cb(new Error(message)));
	}
	signal(remoteSDP) {
		if (remoteSDP.type === 'offer' && SANDBOX.PENDING_OFFERS[this.id])
			return this.dispatchError(`Signal with ID ${remoteSDP.sdp.id} already exists.`);
		if (!remoteSDP.sdp || !remoteSDP.sdp.id || remoteSDP.type !== 'offer' && remoteSDP.type !== 'answer')
			return this.dispatchError('Invalid remote SDP:', remoteSDP);

		const result = SANDBOX.digestSignal(remoteSDP, this.id);
		if (!result) return this.dispatchError(`Failed to digest signal for peer: ${this.id}`);

		const { success, remoteId, signalData } = result;
		if (!success) return this.dispatchError(`No peer found with signal ID: ${remoteSDP.sdp.id}`);

		this.remoteId = remoteId;
		if (signalData) this.callbacks.signal.forEach(cb => cb(signalData)); // emit signal event 'answer'
	}
	/** @param {string | Uint8Array} message */
	send(message) {
		const { success, reason } = SANDBOX.sendData(this.id, this.remoteId, message);
		//if (!success) this.destroy(reason);
	}
	close() {
		this.destroy();
	}
}