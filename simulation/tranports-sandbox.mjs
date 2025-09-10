import { NODE, SIMULATION } from '../core/global_parameters.mjs';

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

const VERBOSE = NODE.DEFAULT_VERBOSE; // 0=none, 1=links, 2=destroy, 3=all
export class ICECandidateEmitter { // --- ICE SIMULATION ---
	sandbox;
	SIGNAL_OFFER_TIMEOUT = 30_000;
	SIGNAL_ANSWER_TIMEOUT = 10_000;
	/** @type {Record<string, Record<string, SignalData>>} */ PENDING_OFFERS = {}; // key: transportId, value: { key: signalId, value: signalData }
	/** @type {Record<string, SignalData>} */ PENDING_ANSWERS = {}; // key: transportId, value: signalData
	/** @type {Array<{ transportId: string, type: 'offer' | 'answer', time: number }>} */ sdpToBuild = [];
	/** @type {Array<{ signalData: SignalData, receiverId: string }>} */ signalsToDigest = [];

	/** @param {Sandbox} sandbox */
	constructor(sandbox) { this.sandbox = sandbox; }
	
	ICE_Interval = setInterval(() => {
		const n = Date.now();
		this.#cleanupExpiredSignals(n); // CLEANUP FIRST

		// PROCESS SDP TO BUILD
		const sdpToBuild = this.sdpToBuild;
		this.sdpToBuild = [];
		for (const { transportId, type, time } of sdpToBuild) {
			if (time > n) { // not yet
				this.sdpToBuild.push({ transportId, type, time }); 
				continue;
			}
			
			const emitterInstance = this.sandbox.transportInstances[transportId];
			if (!emitterInstance || emitterInstance.closing) continue; // emitter gone

			const { success, signalData, reason } = this.#buildSDP(transportId, type);
			if (!success || !signalData) emitterInstance.dispatchError(new Error(reason || `Failed to build SDP for peer: ${this.id}`));
			else emitterInstance.callbacks.signal?.forEach(cb => cb(signalData));
		}

		// PROCESS SIGNALS TO DIGEST
		const signalsToDigest = this.signalsToDigest;
		this.signalsToDigest = []; // reset, can be filled during the operation
		for (const { signalData, receiverId } of signalsToDigest) {
			const receiverInstance = this.sandbox.transportInstances[receiverId];
			if (!receiverInstance || receiverInstance.closing) continue; // receiver gone

			const { success, reason } = this.#digestSignal(signalData, receiverId);
			if (!success) receiverInstance.dispatchError(reason || `Failed to digest signal for peer: ${this.id}`);
		}
	}, 500);

	#cleanupExpiredSignals(n = Date.now()) { // AVOIDS MEMORY LEAK
		for (const [transportId, offers] of Object.entries(this.PENDING_OFFERS))
			for (const [signalId, signalData] of Object.entries(offers))
				if (n > signalData.expiration) delete this.PENDING_OFFERS[transportId][signalId];

		for (const [transportId, answer] of Object.entries(this.PENDING_ANSWERS))
			if (n > answer.expiration) delete this.PENDING_ANSWERS[transportId];
	}
	/** @param {string} receiverId @param {string} senderId */
	#buildSDP(id, type) { // UN PEU TRICKY, MAIS EN VRAI CA DEVRAIT PASSER.
		if (type !== 'offer' && type !== 'answer') return { success: false, signalData: null, reason: `Invalid signal type: ${type}.` };
		if (type === 'answer' && this.PENDING_ANSWERS[id]) return { success: false, signalData: null, reason: `There is already a pending answer for transport ID: ${id}` };

		const timeout = type === 'offer' ? this.SIGNAL_OFFER_TIMEOUT : this.SIGNAL_ANSWER_TIMEOUT || 10_000;
		const SDP_ID = Math.random().toString(36).substring(2);
		const signalData = {
			transportId: id,
			expiration: Date.now() + timeout,
			type,
			sdp: {
				id: SDP_ID,
				v: '0',
				o: `- ${Math.random().toString(36).substring(2)} ${Math.floor(Math.random() * 1000000)} 2 IN IP4 127.0.0.1\r\n`,
				s: '-',
				t: '0 0',
				a: ['group:BUNDLE 0','msid-semantic: WMS','ice-ufrag:Cvvt','ice-pwd:6jB1TY+roP0E44NQEavy9shl','ice-options:trickle','fingerprint:sha-256 FF:16:35:3A:3D:C2:5C:CD:A5:5D:21:B3:4E:31:3F:0B:5B:0B:3C:15:5B:59:A8:2C:A0:34:4E:8C:81:48:75:7D','setup:actpass','mid:0','sctp-port:5000','max-message-size:262144']
			}
		}

		if (type === 'offer' && !this.PENDING_OFFERS[id]) this.PENDING_OFFERS[id] = {};
		if (type === 'offer' && this.PENDING_OFFERS[id][SDP_ID]) return { success: false, signalData: null, reason: `There is already a pending offer with the same SDP ID for transport ID: ${id} (extreme case)` };
		
		if (type === 'offer') this.PENDING_OFFERS[id][SDP_ID] = signalData;
		else if (type === 'answer') this.PENDING_ANSWERS[id] = signalData;
		return { success: true, signalData, reason: 'na' };
	}
	/** @param {SignalData} signalData @param {string} receiverId */
	#digestSignal(signalData, receiverId) {
		const { transportId, type, sdp } = signalData;
		if (transportId === undefined) return { success: false, reason: `Missing transportId in signal data.` };
		if (type !== 'offer' && type !== 'answer') return { success: false, reason: `Invalid signal type: ${type}.` };
		
		if (type === 'offer' && (!this.PENDING_OFFERS[transportId] || !this.PENDING_OFFERS[transportId][sdp.id]))
			return { success: false, reason: `No pending offer found for transport ID: ${transportId} with SDP ID: ${sdp.id}` };
		if (type === 'answer' && (!this.PENDING_ANSWERS[transportId] || this.PENDING_ANSWERS[transportId].sdp.id !== sdp.id))
			return { success: false, reason: `No pending answer found for transport ID: ${transportId} with SDP ID: ${sdp.id}` };

		if (type === 'offer' && Math.random() < SIMULATION.ICE_OFFER_FAILURE_RATE) return { success: false, reason: `Simulated failure for 'offer' signal from ${transportId} to ${receiverId}` };
		if (type === 'answer' && Math.random() < SIMULATION.ICE_ANSWER_FAILURE_RATE) return { success: false, reason: `Simulated failure for 'answer' signal from ${transportId} to ${receiverId}` };

		if (type === 'offer') {
			this.buildSDP(receiverId, 'answer');
			return { success: true, reason: 'na' }; // answer will be sent later
		}
		
		// CONSUME ANSWER SIGNALS
		delete this.PENDING_OFFERS[receiverId]; // CONSUME OFFER SIGNALS
		delete this.PENDING_ANSWERS[transportId]; 	 // CONSUME ANSWER SIGNAL

		const linkFailureMessage = this.sandbox.linkInstances(receiverId, transportId);
		return { success: linkFailureMessage ? false : true, reason: linkFailureMessage || 'na' };
	}

	// API
	/** @param {string} transportId @param {'offer' | 'answer'} type */
	buildSDP(transportId, type) {
		const delayRange = {min: SIMULATION.ICE_DELAY.min, max: SIMULATION.ICE_DELAY.max };
		const delay = Math.floor(Math.random() * (delayRange.max - delayRange.min + 1)) + delayRange.min;
		this.sdpToBuild.push({ transportId, type, time: Date.now() + delay });
	}
	/** @param {SignalData} signalData @param {string} receiverId */
	digestSignal(signalData, receiverId) {
		this.signalsToDigest.push({ signalData, receiverId });
	}
}
export class Sandbox {
	wsGlobalIndex = 1; // index to attribute wsInstances IDs
	tGlobalIndex = 1; // index to attribute transportInstances IDs
	/** @type {Record<string, TestTransport>} */ transportInstances = {};
	/** @type {Record<string, TestWsConnection>} */ wsConnections = {};
	/** @type {Record<string, TestWsServer>} */ publicWsServers = {};

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
	linkInstances(idA, idB) { // SimplePeer instances only
		const [ tA, tB ] = [ this.transportInstances[idA], this.transportInstances[idB] ];
		if (!tA || !tB) return `Missing transport instances: ${idA}=>${!!tA}, ${idB}=>${!!tB}`;
		if (tB.initiator && tA.initiator) return `Both transport instances cannot be initiators: ${idA}, ${idB}`;
		if (tA.closing || tB.closing) return `One of the transport instances is closing: ${idA}=>${tA.closing}, ${idB}=>${tB.closing}`;
		if (tA.remoteId) return `Transport instance tA: ${idA} is already linked to remoteId: ${tA.remoteId}`;
		if (tB.remoteId) return `Transport instance tB: ${idB} is already linked to remoteId: ${tB.remoteId}`;

		// LINK THEM
		tA.remoteId = idB;
		tB.remoteId = idA;

		if (VERBOSE > 0) console.log(`[SANDBOX] Linked transports: ${idA} <-> ${idB}`);

		// EMIT CONNECT EVENT ON BOTH SIDES
		tA.callbacks.connect.forEach(cb => cb()); // emit connect event for transportInstance A
		tB.callbacks.connect.forEach(cb => cb()); // emit connect event for transportInstance B
	}
	sendData(fromId, toId, data) {
		if (fromId === undefined) return { success: false, reason: `Cannot send message from id: ${fromId}` };
		if (toId === undefined) return { success: false, reason: `Cannot send message to id: ${toId}` };
		
		const senderInstance = this.transportInstances[fromId];
		if (!senderInstance) return { success: false, reason: `No transport instance found for id: ${fromId}` };
		
		const senderIsClosing = senderInstance.closing || senderInstance.readyState === 3;
		if (senderIsClosing) return { success: false, reason: `Transport instance ${fromId} is closing` };

		if (!senderInstance.remoteId) return { success: false, reason: `Transport instance ${fromId} is not linked to any remoteId` };
		if (senderInstance.remoteId !== toId) return { success: false, reason: `Transport instance ${fromId} is not linked to remoteId: ${toId}` };

		const remoteInstance = this.transportInstances[toId];
		if (!remoteInstance) return { success: false, reason: `No transport instance found for id: ${toId}` };
		
		const remoteIsClosing = remoteInstance.closing || remoteInstance.readyState === 3;
		if (remoteIsClosing) return { success: false, reason: `Transport instance ${toId} is closing` };
		
		if (remoteInstance.id !== toId) return { success: false, reason: `Wrong id for remoteInstance ${fromId} !== ${toId}` };
		if (remoteInstance.remoteId !== fromId) return { success: false, reason: `Transport instance ${fromId} is not linked to remoteId: ${toId}` };

		this.enqueueTransportData(remoteInstance.id, remoteInstance.remoteId, data);
		return { success: true, reason: 'na' };
	}
	destroyTransportAndAssociatedTransport(id) { // SimplePeer instances only
		const localInstance = this.transportInstances[id];
		if (!localInstance) return; // already gone
		
		const remoteId = localInstance.remoteId;
		const remoteInstance = remoteId ? this.transportInstances[remoteId] : null;
		if (VERBOSE > 1) console.log(`[SANDBOX] Destroying transports: ${id} ${remoteInstance ? '& ' + remoteId : ''}`);
		if (localInstance && remoteInstance) { // close remote instance if linked
			delete this.transportInstances[remoteId];
			// call destroyTransport again, does nothing because we deleted him from this.transportInstances
			remoteInstance.destroy(`Remote transport instance ${id} closed the connection.`);
		}

		delete this.transportInstances[id];
		localInstance.close();
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
			const [type, id, data, remoteId] = this.messageQueue[index];
			if (type === 'transport_data') this.#processInstanceMessage(id, remoteId, data);
            else if (type === 'ws_message') this.#processWsMessage(id, data);
        }
        this.queueIndex = endIndex;
        
        if (this.queueIndex < 5000) return; // Periodic cleanup, avoid memory leaks
        this.messageQueue = this.messageQueue.slice(this.queueIndex);
        this.queueIndex = 0;
    }

	#processInstanceMessage(id, remoteId, data) {
		const remoteInstance = this.transportInstances[id];
		const senderInstance = this.transportInstances[remoteId];
		if (!senderInstance || !remoteInstance || senderInstance.closing || remoteInstance.closing) {
			senderInstance?.close();
			remoteInstance?.close();
			return;
		}

		for (const cb of remoteInstance.callbacks.data) cb(data);
	}
	#processWsMessage(id, message) {
		const remoteWs = this.wsConnections[id];
		if (!remoteWs || remoteWs.readyState !== 1) return;
		for (const cb of remoteWs.callbacks.message) cb(message);
		if (remoteWs.onmessage) remoteWs.onmessage({ data: message });
	}

	// MESSAGE QUEUE API
	enqueueTransportData(id, remoteId, data) { this.messageQueue.push(['transport_data', id, data, remoteId]); }
	enqueueWsMessage(remoteWsId, message) { this.messageQueue.push(['ws_message', remoteWsId, message]); }
}