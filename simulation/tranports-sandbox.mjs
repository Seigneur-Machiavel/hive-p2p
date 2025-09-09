/**
 * Sandbox for testing WebSocket and transport connections.
 * 
 * @typedef {import('./test-transports.mjs').TestWsConnection} TestWsConnection
 * @typedef {import('./test-transports.mjs').TestWsServer} TestWsServer
 * @typedef {import('./test-transports.mjs').TestTransport} TestTransport
 */

/**
 * @typedef {Object} SignalData
 * @property {string} transportId
 * @property {number} expiration
 * @property {'offer' | 'answer'} type
 * @property {Object} sdp
 * @property {string} sdp.id
 */

const VERBOSE = 0; // 0=none, 1=links, 2=destroy, 3=all

export class Sandbox {
	wsGlobalIndex = 1; // index to attribute wsInstances IDs
	tGlobalIndex = 1; // index to attribute transportInstances IDs
	/** @type {Record<string, TestTransport>} */ transportInstances = {};
	/** @type {Record<string, TestWsConnection>} */ wsConnections = {};
	/** @type {Record<string, TestWsServer>} */ publicWsServers = {};

	// --- ICE SIMULATION ---
	SIGNAL_OFFER_TIMEOUT = 30_000;
	SIGNAL_ANSWER_TIMEOUT = 10_000;
	/** @type {Record<string, object>} */ PENDING_OFFERS = {}; // key: id, value: signalData
	/** @type {Record<string, object>} */ PENDING_ANSWERS = {}; // key: id, value: signalData
	cleanupInterval = setInterval(() => this.#cleanupExpiredSignals(), 2000);

	buildSDP(id, type = 'offer') {
		if (this.PENDING_OFFERS[id] || this.PENDING_ANSWERS[id]) return null; // already exists

		const timeout = type === 'offer' ? this.SIGNAL_OFFER_TIMEOUT : this.SIGNAL_ANSWER_TIMEOUT || 10_000;
		const signalData = {
			transportId: id,
			expiration: Date.now() + timeout,
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

		if (type === 'offer') this.PENDING_OFFERS[id] = signalData;
		else if (type === 'answer') this.PENDING_ANSWERS[id] = signalData;

		return signalData;
	}
	/** @param {SignalData} signalData @param {string} receiverId */
	digestSignal(signalData, receiverId) {
		const result = { success: false, signalData: null, reason: 'na' };
		const { transportId, type, sdp } = signalData;
		if (transportId === undefined || (type !== 'answer' && type !== 'offer')) {
			result.reason = `Invalid signal type: ${type}.`;
			return result;
		}

		const receiver = this.transportInstances[receiverId];
		if (receiver === undefined) {
			result.reason = `No transport instance found for receiver ID: ${receiverId}`;
			return result;
		}

		if (type === 'offer' && Math.random() < .2) { // 20% offer use failure in simulation
			result.reason = `Simulated failure for 'offer' signal from ${transportId} to ${receiverId}`;
			return result;
		}
		if (type === 'answer' && Math.random() < .15) { // 15% answer use failure in simulation
			result.reason = `Simulated failure for 'answer' signal from ${transportId} to ${receiverId}`;
			return result;
		}

		result.success = true;
		if (type === 'offer') {
			result.signalData = this.buildSDP(receiverId, 'answer');
			if (result.signalData) return result;
			result.success = false;
			result.reason = `Failed to create answer signal for receiver ID: ${receiverId}`;
		} else {
			const linkFailureMessage = this.#linkInstances(receiverId, transportId);
			result.success = linkFailureMessage ? false : true;
			result.reason = linkFailureMessage;
		}

		return result;
	}
	#cleanupExpiredSignals() {
		const now = Date.now();
		for (const [id, entry] of Object.entries(this.PENDING_OFFERS))
			if (now > entry.expiration) delete this.PENDING_OFFERS[id];
		
		for (const [id, entry] of Object.entries(this.PENDING_ANSWERS))
			if (now > entry.expiration) delete this.PENDING_ANSWERS[id];
	}
	#linkInstances(idA, idB) {
		const [ tA, tB ] = [ this.transportInstances[idA], this.transportInstances[idB] ];
		if (!tA || !tB) return `Missing transport instances: ${idA}=>${!!tA}, ${idB}=>${!!tB}`;
		if (tB.initiator && tA.initiator) return `Both transport instances cannot be initiators: ${idA}, ${idB}`;
		if (tA.closing || tB.closing) return `One of the transport instances is closing: ${idA}=>${tA.closing}, ${idB}=>${tB.closing}`;
		if (tA.remoteId) return `Transport instance tA: ${idA} is already linked to remoteId: ${tA.remoteId}`;
		if (tB.remoteId) return `Transport instance tB: ${idB} is already linked to remoteId: ${tB.remoteId}`;

		// CONSUME SIGNALS
		this.#destroySignals(idA);
		this.#destroySignals(idB);

		// LINK THEM
		tA.remoteId = idB;
		tB.remoteId = idA;

		if (VERBOSE > 0) console.log(`[SANDBOX] Linked transports: ${idA} <-> ${idB}`);

		// EMIT CONNECT EVENT ON BOTH SIDES
		tA.callbacks.connect.forEach(cb => cb()); // emit connect event for transportInstance A
		tB.callbacks.connect.forEach(cb => cb()); // emit connect event for transportInstance B
	}
	#destroySignals(transportId) {
		delete this.PENDING_OFFERS[transportId];
		delete this.PENDING_ANSWERS[transportId];
	}

	// --- WEBSOCKET SIMULATION ---
	inscribeWebSocketServer(url, testWsServer) {
		this.publicWsServers[url] = testWsServer;
	}
	removeWebSocketServer(url) {
		delete this.publicWsServers[url];
	}
	inscribeWsConnection(testWsConnection) {
		const id = (this.wsGlobalIndex++).toString();
		testWsConnection.id = id;
		this.wsConnections[id] = testWsConnection;
		if (VERBOSE > 2) console.log(`[SANDBOX] Inscribed wsConnection: ${testWsConnection.id}`);
	}
	connectToWebSocketServer(url, clientWsConnectionId, instancier) {
		const clientWsConnection = this.wsConnections[clientWsConnectionId];
		const server = this.publicWsServers[url];
		if (!clientWsConnection || !server || server.closing) return;
		if (server.clients.size >= server.maxClients) return; // max clients reached

		const serverWsConnection = new instancier(server, clientWsConnectionId);
		server.clients.add(serverWsConnection);
		serverWsConnection.init(clientWsConnection.id); // init server connection
		server.callbacks.connection.forEach(cb => cb(serverWsConnection)); // emit connection event on server

		clientWsConnection.init(serverWsConnection.id); // init client connection
	}
	// --- SimplePeer(WebRTC) SIMULATION ---
	inscribeInstance(transportInstance) {
		const transportId = (this.tGlobalIndex++).toString();
		transportInstance.id = transportId;
		this.transportInstances[transportId] = transportInstance;
		if (VERBOSE > 2) console.log(`[SANDBOX] Inscribed transport: ${transportId}`);
	}
	sendData(fromId, toId, data) {
		if (fromId === undefined) return { success: false, reason: `Cannot send message from id: ${fromId}` };
		if (toId === undefined) return { success: false, reason: `Cannot send message to id: ${toId}` };
		
		const senderInstance = this.transportInstances[fromId];
		if (!senderInstance) return { success: false, reason: `No transport instance found for id: ${fromId}` };
		if (senderInstance.closing) return { success: false, reason: `Transport instance ${fromId} is closing` };

		if (!senderInstance.remoteId) return { success: false, reason: `Transport instance ${fromId} is not linked to any remoteId` };
		if (senderInstance.remoteId !== toId) return { success: false, reason: `Transport instance ${fromId} is not linked to remoteId: ${toId}` };

		const remoteInstance = this.transportInstances[toId];
		if (!remoteInstance) return { success: false, reason: `No transport instance found for id: ${toId}` };
		if (remoteInstance.closing) return { success: false, reason: `Transport instance ${toId} is closing` };
		
		if (remoteInstance.id !== toId) return { success: false, reason: `Wrong id for remoteInstance ${fromId} !== ${toId}` };
		if (remoteInstance.remoteId !== fromId) return { success: false, reason: `Transport instance ${fromId} is not linked to remoteId: ${toId}` };

		this.enqueueTransportData(remoteInstance.id, remoteInstance.remoteId, data);
		return { success: true, reason: 'na' };
	}
	destroyTransport(id) {
		this.#destroySignals(id);

		if (VERBOSE > 1) console.log(`[SANDBOX] Destroying transports: ${id} & ${remoteId}`);
		const remoteId = this.transportInstances[id]?.remoteId;
		this.transportInstances[id]?.close(); 		// close local instance
		delete this.transportInstances[id]; 		// ensure deletion
		if (!remoteId) return;

		this.transportInstances[remoteId]?.close(); // close remote instance if linked
		delete this.transportInstances[remoteId]; 	// ensure deletion
	}

	// --- MESSAGE QUEUE TO SIMULATE ASYNC BEHAVIOR ---
	messageQueue = [];
	queueIndex = 0;
    queueInterval = 5; // 5ms = 200Hz
    batchSize = 400; // total: 400 x 200 = 80_000msg/sec
	queueProcessor = setInterval(() => this.#processMessageQueue(), this.queueInterval);

	#processMessageQueue() {
		const queueLength = this.messageQueue.length;
        if (queueLength === 0) return;
        
        const endIndex = Math.min(this.queueIndex + this.batchSize, queueLength);
        for (let index = this.queueIndex; index < endIndex; index++) {
			const [type, i, data, remoteId] =this.messageQueue[index];
			if (type === 'transport_data') {
				const remoteInstance = this.transportInstances[i];
				const senderInstance = this.transportInstances[remoteId];
				if (!senderInstance || !remoteInstance || senderInstance.closing || remoteInstance.closing) {
					senderInstance?.close();
					remoteInstance?.close();
					continue;
				}
		
                for (const cb of remoteInstance.callbacks.data) cb(data);
            } else if (type === 'ws_message') {
				const remoteWs = this.wsConnections[i];
				if (!remoteWs || remoteWs.readyState !== 1) continue;
                for (const cb of remoteWs.callbacks.message) cb(data);
                if (remoteWs.onmessage) remoteWs.onmessage({ data });
            }
        }
        this.queueIndex = endIndex;
        
        if (this.queueIndex < 5000) return; // Periodic cleanup, avoid memory leaks
        this.messageQueue = this.messageQueue.slice(this.queueIndex);
        this.queueIndex = 0;
    }
	enqueueWsMessage(remoteWsId, message) { this.messageQueue.push(['ws_message', remoteWsId, message]); }
	enqueueTransportData(id, remoteId, data) { this.messageQueue.push(['transport_data', id, data, remoteId]); }
}

export const SANDBOX = new Sandbox();