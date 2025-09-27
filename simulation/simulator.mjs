import path from 'path';
import express from 'express';
import { io } from 'socket.io-client'; // used for twitch events only
import { Server } from 'socket.io';
import { WebSocketServer } from 'ws';
import { CLOCK, SIMULATION, NODE, TRANSPORTS, IDENTITY, DISCOVERY, GOSSIP, LOG_CSS } from '../core/parameters.mjs';
import { TestWsServer, TestWsConnection, TestTransport,
	ICE_CANDIDATE_EMITTER, TEST_WS_EVENT_MANAGER, SANDBOX } from '../simulation/test-transports.mjs';
//import { MessageQueue, Statician, TransmissionAnalyzer, SubscriptionsManager } from './simulator-utils.mjs';

// SETUP SIMULATION ENV -----------------------------------------------\
CLOCK.mockMode = SIMULATION.USE_TEST_TRANSPORTS; //						|
if (SIMULATION.USE_TEST_TRANSPORTS) {//									|
	TRANSPORTS.WS_SERVER = TestWsServer; // default: WebSocketServer	|
	TRANSPORTS.WS_CLIENT = TestWsConnection; // default: WebSocket		|
	TRANSPORTS.PEER = TestTransport; // default: SimplePeer				|
}//																		|
//---------------------------------------------------------------------/

// IMPORT NODE AFTER SIMULATION ENV SETUP
const { MessageQueue, Statician, TransmissionAnalyzer, SubscriptionsManager } = await import('./simul-utils.mjs');
const { CryptoCodex } = await import('../core/crypto-codex.mjs');
const { NodeP2P } = await import('../core/node.mjs'); // dynamic import to allow simulation overrides
// TO ACCESS THE VISUALIZER GO TO: http://localhost:3000 ------\
// LOGS COLORS :											   |
// BLUE:      SYSTEM									 	   |
// YELLOW:    SIMULATION INFO								   |   
// FUCHSIA:   CURRENT PEER GOSSIP STATS						   |
// CYAN: 	  CURRENT PEER UNICAST STATS					   |
//-------------------------------------------------------------/

/** @type {TwitchChatCommandInterpreter} */
let commandInterpreter = null; // initialized at the end of the file.
let initInterval = null;
let isRestarting = false;
const sVARS = { // SIMULATION VARIABLES
	publicInit: 0,
	nextPeerToInit: null,
	publicPeersCards: [],
	startTime: Date.now()
};
const peers = {
	/** @type {Record<string, import('../core/node.mjs').NodeP2P>} */
	all: {},
	/** @type {Array<import('../core/node.mjs').NodeP2P>} */
	public: [],
	/** @type {Array<import('../core/node.mjs').NodeP2P>} */
	standard: [],
}
async function intervalsLoop(loopDelay = 8) { // OPTIMIZATION, SORRY FOR COMPLEXITY
	let msgQueueCounter = 0; 		// SANDBOX / TRANSPORTS
	let wsEventManagerCounter = 0; 		// SANDBOX / TRANSPORTS
	let iceCandidateEmitterCounter = 0; 	// SANDBOX / TRANSPORTS
	const beforeMsgQueueTick = Math.round(200 / loopDelay); // 200 ms / 8ms = 25
	const beforeWsEventManagerTick = Math.round(480 / loopDelay); // 480 ms / 8ms = 60
	const beforeIceCandidateEmitterTick = Math.round(520 / loopDelay); // 520 ms / 8ms = 65
	
	const discoveryTickLastTime = {}; // key: peerId, value: lastTime
	let arbiterCounter = {}; 			// PEER ARBITER COUNTERS
	const beforeArbiterTick = Math.round(1000 / loopDelay); // 1000 ms / 8ms = 125

	async function tick(n) {
		if (isRestarting) return;
		if (!SIMULATION.AVOID_INTERVALS) return; // not enabled
		
		let peersAllCount = 0;
		for (const id in peers.all) { // PEER ARBITER TICK (+ counting peers)
			const peer = peers.all[id]; peersAllCount++;
			if (!peer.started) continue; // not started yet
			if (arbiterCounter[id]-- > 0) continue // PEER ARBITER TICK
			arbiterCounter[id] = beforeArbiterTick;
			peer.arbiter.tick();
		}

		let discoveryTicksThisLoop = 0;
		const maxDiscoveryTickBatch = peersAllCount / (DISCOVERY.LOOP_DELAY / loopDelay / 4); // max number of discovery tick per loop, avoid long loop delays
		for (const id in peers.all) { // PEER DISCOVERY TICK
			const peer = peers.all[id];
			if (n - (discoveryTickLastTime[id] || 0) < DISCOVERY.LOOP_DELAY) continue; // not time yet
			discoveryTickLastTime[id] = n;
			peer.topologist.tick();
			peer.peerStore.cleanupExpired();
			peer.peerStore.offerManager.tick();
			if (discoveryTicksThisLoop++ > maxDiscoveryTickBatch) break; // avoid long loop delays
		} if (isRestarting) return;

		if (msgQueueCounter-- <= 0) { // VISUALIZER MESSAGE QUEUE PROCESS TICK
			msgQueueCounter = beforeMsgQueueTick;
			await msgQueue.tick(); 			 	 
		} if (isRestarting) return;
		if (wsEventManagerCounter-- <= 0) { // TEST WS EVENT MANAGER TICK
			wsEventManagerCounter = beforeWsEventManagerTick;
			TEST_WS_EVENT_MANAGER.initTick();
			TEST_WS_EVENT_MANAGER.closeTick();
			TEST_WS_EVENT_MANAGER.cleanerTick();
			TEST_WS_EVENT_MANAGER.errorTick();
		} if (isRestarting) return;
		if (iceCandidateEmitterCounter-- <= 0) { // ICE CANDIDATE EMITTER TICK
			iceCandidateEmitterCounter = beforeIceCandidateEmitterTick;
			ICE_CANDIDATE_EMITTER.tick();
		} if (isRestarting) return;

		await SANDBOX.processMessageQueue(); // MESSAGE QUEUE PROCESS TICK
		//SANDBOX.processMessageQueueSync(); // MESSAGE QUEUE PROCESS TICK
	}
	while(true) { // isRestarting
		const n = Date.now();
		await tick(n);
		const elapsed = Date.now() - n;
		await new Promise(resolve => setTimeout(resolve, Math.max(loopDelay - elapsed, 5)));
	}
}
async function destroyAllExistingPeers(pauseDuration = 2000) {
	isRestarting = true;
	let totalDestroyed = 0;
	for (const peer of peers.public) { peer.destroy(); totalDestroyed ++; }
	for (const peer of peers.standard) { peer.destroy(); totalDestroyed ++; }
	if (totalDestroyed !== 0) await new Promise(resolve => setTimeout(resolve, pauseDuration)); // wait for destruction to complete
	console.log(`%c| ° ${totalDestroyed} EXISTING PEERS DESTROYED ° |`, LOG_CSS.SIMULATOR);
	isRestarting = false;
}
function pickUpRandomBootstraps(count = SIMULATION.BOOTSTRAPS_PER_PEER) {
	if (count === null) return sVARS.publicPeersCards; // all of them

	const selected = [];
	const t = sVARS.publicPeersCards.length;
	const c = Math.min(count, t);
	const shuffledIndexes = [...Array(t).keys()].sort(() => Math.random() - 0.5);
	for (let i = 0; i < c; i++) selected.push(sVARS.publicPeersCards[shuffledIndexes[i]]);
	return selected;
}
/** @param {import('../core/node.mjs').NodeP2P} peer */
function patchPeerHandlers(peer) {
	peer.messager.on('message_handle', () => statician.unicast++);
	peer.gossip.on('message_handle', (serialized) => {
		statician.gossip++;
		const { topic, HOPS, data } = peer.cryptoCodex.readGossipMessage(serialized) || {};
		if (topic !== 'diffusion_test') return; // not a diffusion test message
		transmissionAnalyzer.analyze(peer.id, data, HOPS)
	});
	// DEPRECATED
	//peer.gossip.on('diffusion_test', (fromId, msg, HOPS, message) => transmissionAnalyzer.analyze(peer.id, msg, HOPS, message, fromId));
}
async function addPeer(type, i = 0, bootstraps = [], init = false, setPublic = false) {
	const selectedBootstraps = type === 'STANDARD_NODE' ? pickUpRandomBootstraps() : bootstraps;
	const domain = setPublic ? 'localhost' : undefined;
	const port = setPublic ? 8080 + (i * 2) : undefined;
	const cryptoCodex = IDENTITY.ARE_IDS_HEX ? new CryptoCodex() : new CryptoCodex(`${type === 'STANDARD_NODE' ? 'N_' : IDENTITY.PUBLIC_PREFIX}${i}`);
	const peer = await NodeP2P.createNode(selectedBootstraps, cryptoCodex, init, domain, port);
	peers.all[peer.id] = peer;
	peers[type === 'STANDARD_NODE' ? 'standard' : 'public'].push(peer);
	if (setPublic) sVARS.publicPeersCards.push({ id: peer.id, publicUrl: peer.publicUrl });
	patchPeerHandlers(peer);
}
async function initPeers() {
	if (initInterval) clearInterval(initInterval);
	//sVARS.nextPeerToInit = null;
	await destroyAllExistingPeers();
	peers.public = []; peers.standard = []; peers.all = {};
	sVARS.publicPeersCards = []; sVARS.nextPeerToInit = 0; sVARS.publicInit = 0;
	const d = SIMULATION.DELAY_BETWEEN_INIT;
	for (sVARS.publicInit; sVARS.publicInit < SIMULATION.PUBLIC_PEERS_COUNT; sVARS.publicInit++) await addPeer('PUBLIC_NODE', sVARS.publicInit, [], true, true);
	for (let i = 0; i < SIMULATION.PEERS_COUNT; i++) await addPeer('STANDARD_NODE', i, sVARS.publicPeersCards, d === 0);

	console.log(`%c| PEERS CREATED: { Public: ${peers.public.length}, Standard: ${peers.standard.length} } |`, LOG_CSS.SIMULATOR);
	if (d === 0) return sVARS.nextPeerToInit = SIMULATION.PEERS_COUNT; // already initialized
	
	sVARS.nextPeerToInit = 0;
	initInterval = setInterval(async () => { // ... Or successively
		const started = await peers.standard[sVARS.nextPeerToInit++]?.start();
		if (started) return;
		clearInterval(initInterval);
		console.log(`%c| °°° ALL PEERS INITIALIZED °°° |`, LOG_CSS.SIMULATOR);
	}, d);
}
function peersIdsObj() {
	return {
		public: peers.public.map(peer => peer.id),
		standard: peers.standard.map(peer => peer.id)
	};
}
function getPeerInfo(peerId) {
	const peer = peers.all[peerId];
	if (!peer) return null;
	return {
		id: peer.id,
		store: {
			connected: peer.peerStore.neighborsList, // ids only
			connecting: Object.keys(peer.peerStore.connecting), // ids only
			known: peer.peerStore.known
		}
	}
}
async function randomMessagesLoop(type = 'U', mgPerPeerPerSecond = SIMULATION.RANDOM_UNICAST_PER_SEC) {
	const numberOfSender = Math.max(1, Math.floor(mgPerPeerPerSecond * (peers.public.length + peers.standard.length) / 10));
	while(true) {
		const peerIds = Object.keys(peers.all);
		const peersCount = peerIds.length;
		try { for (let i = 0; i < numberOfSender; i++) {
			const senderId = peerIds[Math.floor(Math.random() * peersCount)];
			const sender = peers.all[senderId];
			if (!sender || !sender.started) continue;
			if (type === 'G') { sender.broadcast(`Hello to all from ${sender.id}`); continue; }

			const recipientId = peerIds[Math.floor(Math.random() * peersCount)];
			sender.sendMessage(recipientId, `Hello from ${sender.id}`);
		} } catch (error) { console.error('Error selecting random sender:', error); }

		await new Promise(resolve => setTimeout(resolve, 1000));
	}
};

// INIT SIMULATION
const statician = new Statician(sVARS, peers);
const transmissionAnalyzer = new TransmissionAnalyzer(sVARS, peers, NODE.DEFAULT_VERBOSE);
if (SIMULATION.AUTO_START) initPeers();
if (SIMULATION.RANDOM_UNICAST_PER_SEC) randomMessagesLoop('U', SIMULATION.RANDOM_UNICAST_PER_SEC);
if (SIMULATION.RANDOM_GOSSIP_PER_SEC) randomMessagesLoop('G', SIMULATION.RANDOM_GOSSIP_PER_SEC);

const app = express(); // simple server to serve texts/p2p_simulator.html
app.use('../rendering/visualizer.mjs', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
    next();
});

app.use(express.static(path.resolve()));
app.listen(3000, () => console.log('%cServer listening on http://localhost:3000', LOG_CSS.SIMULATOR));
app.get('/', (req, res) => res.sendFile('rendering/visualizer.html', { root: '.' }));

/** @type {WebSocket} */
let clientWs;
const send = (msgObj) => { if (clientWs) clientWs.emit('message', msgObj); }
const onMessage = async (data) => {
	if (!data) return;
	switch (data.type) {
		case 'start':
			sVARS.startTime = Date.now();
			SIMULATION.PUBLIC_PEERS_COUNT = data.settings.publicPeersCount || SIMULATION.PUBLIC_PEERS_COUNT;
			SIMULATION.PEERS_COUNT = data.settings.peersCount || SIMULATION.PEERS_COUNT;
			await initPeers();
			send({ type: 'settings', data: { publicPeersCount: SIMULATION.PUBLIC_PEERS_COUNT, peersCount: SIMULATION.PEERS_COUNT } });
			send({ type: 'peersIds', data: peersIdsObj() });
			send({ type: 'simulationStarted' });
			if (commandInterpreter) commandInterpreter = await commandInterpreter.restart();
			break;
		case 'getPeersIds':
			send({ type: 'peersIds', data: peersIdsObj() });
			break;
		case 'getPeerInfo':
			const peerInfo = getPeerInfo(data.peerId);
			send({ type: 'peerInfo', data: { peerId: data.peerId, peerInfo } });
			if (sManager.onPeerMessage === data.peerId) break;
			sManager.setPeerMessageListener(data.peerId);
			break;
		case 'tryToConnectNode':
			const { fromId, targetId } = data;
			if (!fromId || !targetId) return;
			peers.all[fromId]?.tryConnectToPeer(targetId);
			break;
	}
}
const msgQueue = new MessageQueue(onMessage);
const sManager = new SubscriptionsManager(send, peers, new CryptoCodex(), NODE.DEFAULT_VERBOSE);
intervalsLoop(); // start intervals loop
const socketServer = new Server(17255, { cors: { origin: "*" } }); // Si besoin pour le CORS
socketServer.on('connection', (socket) => {
    console.log('%cSocket.io client connected', LOG_CSS.SIMULATOR);
    if (clientWs) clientWs.disconnect();
    clientWs = socket;
    socket.on('message', async (message) => msgQueue.push(JSON.parse(message)));
    socket.on('disconnect', () => msgQueue.messageQueuesByTypes = {});
    socket.emit('message', { type: 'settings', data: { publicPeersCount: SIMULATION.PUBLIC_PEERS_COUNT, peersCount: SIMULATION.PEERS_COUNT } });
    const zeroPeers = peers.public.length + peers.standard.length === 0;
    if (!zeroPeers) socket.emit('message', { type: 'peersIds', data: peersIdsObj() });
});

// TWITCH TCHAT COMMANDS INTERPRETER
class TwitchChatCommandInterpreter {
	/** @type {Record<string, NodeP2P>} */ userNodes = {};

	constructor() {
		this.ioSocket = io('http://localhost:14598');
		this.ioSocket.on('started', () => console.log('Socket.io connection established'));
		this.ioSocket.on('cmd-message', (data) => this.handleCmdMessage(data));
	}

	handleCmdMessage(data) {
		const { user, message } = data;
		if (!message.startsWith('!')) return;
		const splitted  = message.split(':');
		const command = splitted[0].trim().toLowerCase();
		const args = splitted.slice(1).map(arg => arg.trim());
		const targetNodeId = args[0] ? CryptoCodex.isPublicNode(args[0]) ? args[0] : `F_${args[0]}` : null;
		if (user === 'bot' && command === '!addfollower' && !SIMULATION.AVOID_FOLLOWERS_NODES) this.#createUserNode(args[0]);
		if (command === '!connectto' && targetNodeId) this.userNodes[user]?.tryConnectToPeer(targetNodeId);
	}
	async #createUserNode(user) {
		if (this.userNodes[user]?.peerStore?.isDestroy) this.userNodes[user] = undefined;
		if (this.userNodes[user]) return;
		const cleanUser = user
			.normalize('NFD')                    // décomposer les accents
			.replace(/[\u0300-\u036f]/g, '')     // supprimer les accents
			.replace(/[^\w-]/g, '_')             // remplacer chars spéciaux par _

		const cryptoCodex = IDENTITY.ARE_IDS_HEX ? new CryptoCodex() : new CryptoCodex(`F_${cleanUser}`);
		const peer = await NodeP2P.createNode(pickUpRandomBootstraps(), cryptoCodex, true);
		this.userNodes[user] = peer;
		peers.all[peer.id] = peer;
		peers.standard.unshift(peer);
		patchPeerHandlers(peer);
	}
	async restart() {
		this.ioSocket?.close();
		await new Promise(resolve => setTimeout(resolve, 100));
		return new TwitchChatCommandInterpreter();
	}
}
commandInterpreter = new TwitchChatCommandInterpreter();