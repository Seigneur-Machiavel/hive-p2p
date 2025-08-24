// HERE WE ARE BASICALLY COPYING THE PRINCIPLE OF "SimplePeer"

class Sandbox {
	// --- WebSocket Simulation ---
	/** @type {Record<string, TestWsServer>} */
	publicWsServers = {};
	inscribeWebSocketServer(url, testWsServer) {
		this.publicWsServers[url] = testWsServer;
	}
	removeWebSocketServer(url) {
		delete this.publicWsServers[url];
	}
	/** @param {string} url @param {TestWsConnection} testWsConnection */
	connectToWebSocketServer(url, testWsConnection) {
		const server = this.publicWsServers[url];
		if (!server) return;
		const serverWsConnection = new TestWsConnection(server, testWsConnection);
		server.callbacks.connection.forEach(cb => cb(serverWsConnection)); // emit connection event
		return serverWsConnection;
	}

	// --- SimplePeer Simulation ---
	static SIGNAL_TIMEOUT = 8_000;

	// -------------
	globalIndex = 0; // index to attribute transportInstances ID
	/** @type {Record<string, TestTransport>} */
	connections = {};
	/** @type {Record<string, TestTransport>} */
	transportInstances = {};
	inscribeInstance(transportInstance) {
		const transportId = this.globalIndex++;
		this.transportInstances[transportId] = transportInstance;
		return transportId;
	}
	#linkInstances(idA, idB) {
		const [ tA, tB ] = [this.transportInstances[idA], this.transportInstances[idB]];
		if (!tA || !tB) return; // one instances missing
		if (tA.closing || tB.closing) return; // one of the instances is closing

		const conns = this.connections;
		if (conns[idA] || conns[idB]) return; // at least one is already linked

		conns[idA] = tB;
		conns[idB] = tA;
		tA.callbacks.connect.forEach(cb => cb()); // emit connect event for transportInstance A
		tB.callbacks.connect.forEach(cb => cb()); // emit connect event for transportInstance B
		return true;
	}
	sendData(fromId, toId, data) {
		if (fromId === undefined) return { success: false, reason: `Cannot send message from id: ${fromId}` };
		if (toId === undefined) return { success: false, reason: `Cannot send message to id: ${toId}` };
		const transportInstance = this.connections[fromId];
		if (!transportInstance) return { success: false, reason: `No transport instance found for id: ${fromId}` };
		if (transportInstance.id !== toId) return { success: false, reason: `Wrong id for transportInstance ${fromId} !== ${toId}` };
		for (const cb of transportInstance.callbacks.data) cb(data); // emit data event
		return { success: true };
	}
	destroyTransport(id) {
		const sdp = this.PENDING_OFFERS[id];
		if (sdp !== undefined) this.#destroySignal(id, sdp.id);

		this.connections[id]?.close(); // close remote instance
		this.transportInstances[id]?.close(); // close local instance

		setTimeout(() => { // cleanup after short delay to digest close events
			delete this.connections[id];
			delete this.transportInstances[id];
		}, 1000);
	}
	PENDING_OFFERS = {}; // key: id, value: signalData
	OFFERS_EMITTERS = {}; // key: signalId, value: id
	PENDING_ANSWERS = {}; // key: id, value: signalData
	ANSWER_EMITTERS = {}; // key: signalId, value: id
	cleanupInterval = setInterval(() => this.#cleanupExpiredSignals(), 2000);

	#cleanupExpiredSignals() {
		const now = Date.now();
		const timeout = Sandbox.SIGNAL_TIMEOUT;
		for (const [id, entry] of Object.entries(this.PENDING_OFFERS)) {
			if (now - entry.timestamp > timeout) {
				delete this.PENDING_OFFERS[id];
				delete this.OFFERS_EMITTERS[entry.signalData.id];
			}
		}
		
		for (const [id, entry] of Object.entries(this.PENDING_ANSWERS)) {
			if (now - entry.timestamp > timeout) {
				delete this.PENDING_ANSWERS[id];
				delete this.ANSWER_EMITTERS[entry.signalData.id];
			}
		}
	}
	#addSignalOffer(id, signalData) {
		this.PENDING_OFFERS[id] = signalData;
		this.OFFERS_EMITTERS[signalData.id] = id;
		//setTimeout(() => this.#destroySignal(id, signalData.id), Sandbox.SIGNAL_TIMEOUT);
	}
	#addSignalAnswer(id, signalData) {
		this.PENDING_ANSWERS[id] = signalData;
		this.ANSWER_EMITTERS[signalData.id] = id;
		//setTimeout(() => this.#destroySignal(id, signalData.id), Sandbox.SIGNAL_TIMEOUT);
	}
	buildSDP(id, type = 'offer') {
		const SDP = {
			type,
			sdp: {
				id: Math.random().toString(36).substring(2),
				v: '0',
				o: `- ${Math.random().toString(36).substring(2)} ${Math.floor(Math.random() * 1000000)} 2 IN IP4 127.0.0.1\r\n`,
				s: '-',
				t: '0 0',
				a: [
					'group:BUNDLE 0',
					'msid-semantic: WMS',
					'ice-ufrag:Cvvt',
					'ice-pwd:6jB1TY+roP0E44NQEavy9shl',
					'ice-options:trickle',
					'fingerprint:sha-256 FF:16:35:3A:3D:C2:5C:CD:A5:5D:21:B3:4E:31:3F:0B:5B:0B:3C:15:5B:59:A8:2C:A0:34:4E:8C:81:48:75:7D',
					'setup:actpass',
					'mid:0',
					'sctp-port:5000',
					'max-message-size:262144'
				]
			}
		}
		if (type === 'offer') this.#addSignalOffer(id, SDP.sdp);
		else if (type === 'answer') this.#addSignalAnswer(id, SDP.sdp);
		else return console.error(`Invalid signal type: ${type}. Expected 'offer' or 'answer'.`);

		return SDP;
	}
	#destroySignal(id) {
		const offer = this.PENDING_OFFERS[id];
		const answer = this.PENDING_ANSWERS[id];
		if (offer) {
			delete this.PENDING_OFFERS[id];
			delete this.OFFERS_EMITTERS[offer.id];
		} else if (answer) {
			delete this.PENDING_ANSWERS[id];
			delete this.ANSWER_EMITTERS[answer.id];
		}
	}
	digestSignal(SDP, receiverId) {
		const { type, sdp } = SDP;
		if (type !== 'answer' && type !== 'offer') return console.error(`Invalid signal type: ${type}. Expected 'offer' or 'answer'.`), { success: false };

		const signalAssociatedId = type === 'offer' ? this.OFFERS_EMITTERS[sdp.id] : this.ANSWER_EMITTERS[sdp.id];
		const receiver = this.transportInstances[receiverId];
		if (signalAssociatedId === undefined || receiver === undefined) return;

		if (type === 'answer') {
			this.#destroySignal(signalAssociatedId, sdp.id);
			if (this.#linkInstances(signalAssociatedId, receiverId)) return { success: true, remoteId: signalAssociatedId };
			else return console.error(`Failed to link transport instances for e:${signalAssociatedId} => r:${receiverId}`), { success: false };
		}
		
		return {
			success: signalAssociatedId !== undefined,
			remoteId: signalAssociatedId,
			signalData: signalAssociatedId !== undefined ? this.buildSDP(receiverId, 'answer') : undefined
		};
	}
}
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
		else this.remoteWs = SANDBOX.connectToWebSocketServer(this.url, this);

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
		this.remoteWs.callbacks.message.forEach(cb => cb(message)); // emit message event
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

export class TestTransport { // SimplePeer like
	id = 0;
	remoteId = null;
	// SimplePeer.Options: { initiator: !remoteSDP, trickle: true, wrtc }
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

	callbacks = {
		connect: [],
		close: [],
		data: [],
		signal: [],
		error: []
	};
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
	destroy(errorMsg = null) {
		if (this.closing) return;
		this.closing = true;
		if (!errorMsg) this.callbacks.close.forEach(cb => cb()); // emit close event
		else this.dispatchError(errorMsg);
		SANDBOX.destroyTransport(this.id);
	}
}