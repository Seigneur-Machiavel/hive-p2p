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
	// TRYING OTHER LINK METHODS FOR DEBUGING
	links = {}; // key: idA, value: idB

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
		this.links[idA] = idB;
		this.links[idB] = idA;

		if (VERBOSE > 0) console.log(`[SANDBOX] Linked transports: ${idA} <-> ${idB}`);
		if (!this.transportInstances[idA].remoteId) // DEBUG
			throw new Error(`Transport instance has no remoteId after linking: ${idA} => ${tA.remoteId}`);
		if (!this.transportInstances[idB].remoteId) // DEBUG
			throw new Error(`Transport instance has no remoteId after linking: ${idB} => ${tB.remoteId}`);

		if (tA.callbacks.connect.length !== 1) // DEBUG
			throw new Error(`Transport instance ${idA} has invalid number of 'connect' callbacks: ${tA.callbacks.connect.length}`);
		if (tB.callbacks.connect.length !== 1) // DEBUG
			throw new Error(`Transport instance ${idB} has invalid number of 'connect' callbacks: ${tB.callbacks.connect.length}`);

		// EMIT CONNECT EVENT ON BOTH SIDES
		tA.callbacks.connect.forEach(cb => cb()); // emit connect event for transportInstance A
		tB.callbacks.connect.forEach(cb => cb()); // emit connect event for transportInstance B

		this.#fullControl(); // DEBUG
	}
	#fullControl() {
		const tList = {};
		const rList = {};
		for (const id in this.transportInstances) {
			const t = this.transportInstances[id];
			if (t.closing) continue;
			if (!t.remoteId) continue;
			if (tList[id]) 
				throw new Error(`Duplicate transport instance ID found: ${id}`);
			if (this.links[id] !== t.remoteId)
				throw new Error(`Link inconsistency for transport instance ${id} => ${t.remoteId}`);
			tList[id] = true;

			const r = this.transportInstances[t.remoteId];
			if (!r || r.closing) continue;
			if (r.remoteId !== id) continue;
			if (rList[t.remoteId]) 
				throw new Error(`Duplicate remote transport instance ID found: ${t.remoteId}`);
			if (this.links[t.remoteId] !== id)
				throw new Error(`Link inconsistency for remote transport instance ${t.remoteId} => ${id}`);
			rList[t.remoteId] = true;
		}
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
		testWsConnection.id = (this.wsGlobalIndex++).toString();
		this.wsConnections[testWsConnection.id] = testWsConnection;
		if (VERBOSE > 2) console.log(`[SANDBOX] Inscribed wsConnection: ${testWsConnection.id}`);
	}
	/** @param {string} url @param {TestWsConnection} clientWsConnection */
	connectToWebSocketServer(url, clientWsConnection, instancier) {
		const server = this.publicWsServers[url];
		if (!server) return;
		const serverWsConnection = new instancier(server, clientWsConnection);
		server.callbacks.connection.forEach(cb => cb(serverWsConnection)); // emit connection event
		return serverWsConnection.id;
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
		if (senderInstance.remoteId !== toId)
			return { success: false, reason: `Transport instance ${fromId} is not linked to remoteId: ${toId}` };

		const remoteInstance = this.transportInstances[toId];
		if (!remoteInstance) return { success: false, reason: `No transport instance found for id: ${toId}` };
		if (remoteInstance.closing) return { success: false, reason: `Transport instance ${toId} is closing` };
		
		if (remoteInstance.id !== toId) return { success: false, reason: `Wrong id for remoteInstance ${fromId} !== ${toId}` };
		if (remoteInstance.remoteId !== fromId)
			return { success: false, reason: `Transport instance ${fromId} is not linked to remoteId: ${toId}` };

		this.enqueueTransportData(remoteInstance.id, remoteInstance.remoteId, data);
		return { success: true, reason: 'na' };
	}
	destroyTransport(id) {
		this.#destroySignals(id);

		this.transportInstances[id]?.close(); 	// close local instance
		delete this.transportInstances[id]; 		// ensure deletion

		const remoteId = this.links[id];
		delete this.links[id];
		delete this.links[remoteId];
		this.transportInstances[remoteId]?.close(); 	// close remote instance if linked
		delete this.transportInstances[remoteId]; 	// ensure deletion
		if (VERBOSE > 1) console.log(`[SANDBOX] Destroyed transports: ${id} & ${remoteId}`);
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
			const message = this.messageQueue[index];
			const type = message[0];
			const [t, i, data, remoteId] = message;
			if (t === 'transport_data') {
				const remoteInstance = this.transportInstances[i];
				const senderInstance = this.transportInstances[remoteId];
				if (!remoteInstance || remoteInstance.closing) continue;
				if (remoteInstance.remoteId !== remoteId) 
					throw new Error(`Transport instance ${i} is not linked to remoteId: ${remoteId}`);
				if (remoteInstance.id !== i) 
					throw new Error(`Wrong id for remoteInstance ${i} !== ${remoteInstance.id}`);
				if (!senderInstance || senderInstance.closing) continue;
				if (senderInstance.id !== remoteId) 
					throw new Error(`Wrong id for senderInstance ${i} !== ${remoteId}`);
				if (senderInstance.remoteId !== i)
					throw new Error(`Transport instance ${remoteId} is not linked to remoteId: ${i}`);

				// DEBUG
				//senderInstance.SENT = (senderInstance.SENT || 0) + 1;
				//remoteInstance.SENT = (remoteInstance.SENT || 0) + 1;
				if (!senderInstance.SENT) senderInstance.SENT = {};
				if (!remoteInstance.SENT) remoteInstance.SENT = {};
				const parsed = JSON.parse(data.slice(1));
				if (parsed.route) {
					const routeLen = parsed.route.length.toString();
					senderInstance.SENT[routeLen] = (senderInstance.SENT[routeLen] || 0) + 1;
					remoteInstance.SENT[routeLen] = (remoteInstance.SENT[routeLen] || 0) + 1;
				}
		
                for (const cb of remoteInstance.callbacks.data) cb(data);
            } else if (t === 'ws_message') {
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