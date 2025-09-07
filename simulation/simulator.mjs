import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { NodeP2P } from '../core/node.mjs';
import { MessageQueue, Statician, SubscriptionsManager } from './simulator-utils.mjs';
import { io } from 'socket.io-client'; // used for twitch events only
import { NODE } from '../core/global_parameters.mjs';

// TO ACCESS THE VISUALIZER GO TO: http://localhost:3000
// LOGS COLORS :
// BLUE:      SYSTEM
// YELLOW:    SIMULATION INFO
// FUCHSIA:   CURRENT PEER GOSSIP STATS
// CYAN: 	  CURRENT PEER UNICAST STATS

NODE.USE_TEST_TRANSPORT = true; // force test transport for simulator

let initInterval = null;
/** @type {TwitchChatCommandInterpreter} */ let cmdInterpreter = null;
const sVARS = { // SIMULATION VARIABLES
	publicInit: 0,
	nextPeerToInit: 0,
	avoidFollowersNodes: false,
	publicPeersCards: [],
	startTime: Date.now(),
	// SETTINGS
	autoStart: true,
	publicPeersCount: 2,
	peersCount: 5,
	bootstrapsPerPeer: null, // will not be exact, more like a limit. null = all of them
	delayBetweenInit: 100, // 0 = faster for simulating big networks but > 0 = should be more realistic
	randomMessagePerSecondPerPeer: 0 // .1, // capped at a total of 500msg/sec
};
if (NODE.USE_TEST_TRANSPORT) {
	sVARS.publicPeersCount = 2; // stable: 3,  medium: 100, strong: 200
	sVARS.peersCount = 12;	  	// stable: 25, medium: 800, strong: 1600
}

const peers = {
	/** @type {Record<string, NodeP2P>} */
	all: {},
	/** @type {Array<NodeP2P>} */
	public: [],
	/** @type {Array<NodeP2P>} */
	standard: [],
}

async function destroyAllExistingPeers(pauseDuration = 2000) {
	let totalDestroyed = 0;
	for (const peer of peers.public) { peer.destroy(); totalDestroyed ++; }
	for (const peer of peers.standard) { peer.destroy(); totalDestroyed ++; }
	if (totalDestroyed !== 0) await new Promise(resolve => setTimeout(resolve, pauseDuration)); // wait for destruction to complete
	console.log(`%c| ° ${totalDestroyed} EXISTING PEERS DESTROYED ° |`, 'color: yellow; font-weight: bold;');
}
function pickUpRandomBootstraps(count = sVARS.bootstrapsPerPeer) {
	if (count === null) return sVARS.publicPeersCards; // all of them

	const selected = [];
	for (let i = 0; i < count; i++) {
		const randomBootstrapIndex = Math.floor(Math.random() * sVARS.publicPeersCards.length);
		const rndBootstrap = sVARS.publicPeersCards[randomBootstrapIndex];
		if (selected.includes(rndBootstrap)) continue;
		selected.push(rndBootstrap);
	}
	return selected;
}
function addPeer(type = 'public', i = 0, bootstraps = [], init = false, setPublic = false) {
	const id = `${type === 'standard' ? 'peer' : type}_${i}`;
	const selectedBootstraps = type === 'standard' ? pickUpRandomBootstraps() : bootstraps;
	const peer = NodeP2P.createNode(id, selectedBootstraps, init);
	peers.all[id] = peer;
	peers[type].push(peer);
	if (setPublic) sVARS.publicPeersCards.push(peer.setAsPublic(`localhost`, 8080 + i, 10_000));
	peer.gossip.on('message_handle', (msg, fromId) => statician.gossip++);
}
async function initPeers() {
	if (initInterval) clearInterval(initInterval);
	await destroyAllExistingPeers();
	peers.public = []; peers.standard = []; peers.all = {};
	sVARS.publicPeersCards = []; sVARS.nextPeerToInit = 0; sVARS.publicInit = 0;
	const d = sVARS.delayBetweenInit;
	for (sVARS.publicInit; sVARS.publicInit < sVARS.publicPeersCount; sVARS.publicInit++) addPeer('public', sVARS.publicInit, [], true, true);
	for (let i = 0; i < sVARS.peersCount; i++) addPeer('standard', i, sVARS.publicPeersCards, d === 0);

	console.log(`%c| PEERS CREATED: { Public: ${peers.public.length}, Standard: ${peers.standard.length} } |`, 'color: yellow; font-weight: bold;');
	if (d === 0) return; // already initialized

	sVARS.nextPeerToInit = 0;
	initInterval = setInterval(() => { // ... Or successively
		if (peers.standard[sVARS.nextPeerToInit++]?.start()) return;
		clearInterval(initInterval);
		console.log(`%c| °°° ALL PEERS INITIALIZED °°° |`, 'color: yellow; font-weight: bold;');
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
			connected: peer.peerStore.neighbours, // ids only
			connecting: Object.keys(peer.peerStore.connecting), // ids only
			known: peer.peerStore.known
		}
	}
}
async function randomMessagesLoop() {
	const numberOfSender = Math.max(1, Math.floor(sVARS.randomMessagePerSecondPerPeer * (peers.public.length + peers.standard.length) / 10));
	while(true) {
		const peerIds = Object.keys(peers.all);
		const peersCount = peerIds.length;
		try { for (let i = 0; i < numberOfSender; i++) {
			const senderId = peerIds[Math.floor(Math.random() * peersCount)];
			const sender = peers.all[senderId];
			const senderKnowsPeers = sender ? Object.keys(sender.peerStore.known) : [];
			if (!sender || senderKnowsPeers.length === 0) continue;

			const recipientId = senderKnowsPeers[Math.floor(Math.random() * senderKnowsPeers.length)];
			const message = { type: 'message', data: `Hello from ${sender.id}` };
			sender.sendMessage(recipientId, 'message', message);
		} } catch (error) { console.error('Error selecting random sender:', error); }

		await new Promise(resolve => setTimeout(resolve, 1000));
	}
};

// INIT SIMULATION
const statician = new Statician(sVARS, peers);
if (sVARS.autoStart) initPeers();
if (sVARS.randomMessagePerSecondPerPeer) randomMessagesLoop();
const app = express(); // simple server to serve texts/p2p_simulator.html
app.use('../rendering/visualizer.mjs', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
    next();
});

app.use(express.static(path.resolve()));
const server = app.listen(3000, () => console.log('Server listening on http://localhost:3000'));
app.get('/', (req, res) => res.sendFile('rendering/visualizer.html', { root: '.' }));

/** @type {WebSocket} */
let clientWs;
const send = (msgObj, startTime) => {
	if (!startTime) clientWs.send(JSON.stringify(msgObj));
	else clientWs.send(JSON.stringify(msgObj), () => {
		const tt = Date.now() - startTime;
		if (tt > minLogTime) console.log(`Message ${msgObj.type} sent (${tt}ms)`);
	});
}
const onMessage = async (data) => {
	if (!data) return;
	switch (data.type) {
		case 'start':
			sVARS.startTime = Date.now();
			sManager = sManager ? sManager.destroy(true) : new SubscriptionsManager(send, peers);
			for (const setting in data.settings) sVARS[setting] = data.settings[setting];
			await initPeers();
			send({ type: 'settings', data: sVARS });
			send({ type: 'peersIds', data: peersIdsObj() });
			send({ type: 'simulationStarted' });
			if (cmdInterpreter) cmdInterpreter = await cmdInterpreter.restart();
			break;
		case 'getPeersIds':
			send({ type: 'peersIds', data: peersIdsObj() });
			break;
		case 'getPeerInfo':
			send({ type: 'peerInfo', data: { peerId: data.peerId, peerInfo: getPeerInfo(data.peerId) } });
			if (sManager.onPeerMessage === data.peerId) break;
			sManager = sManager.destroy(true);
			sManager.addPeerMessageListener(data.peerId);
			break;
		case 'tryToConnectNode':
			const { fromId, targetId } = data;
			if (!fromId || !targetId) return;
			peers.all[fromId]?.tryConnectToPeer(targetId);
			break;
	}
}
const msgQueue = new MessageQueue(onMessage);
let sManager = new SubscriptionsManager(send, peers);
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
	if (clientWs) clientWs.close();
	clientWs = ws;
	ws.on('message', async (message) => msgQueue.push(JSON.parse(message)));
	ws.on('close', () => { sManager.destroy(); msgQueue.reset(); });
	ws.send(JSON.stringify({ type: 'settings', data: sVARS }));
	const zeroPeers = peers.public.length + peers.standard.length === 0;
	if (!zeroPeers) ws.send(JSON.stringify({ type: 'peersIds', data: peersIdsObj() }));
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
		const targetNodeId = args[0] ? args[0].startsWith('f_') ? args[0] : `f_${args[0]}` : null;
		if (user === 'bot' && command === '!addfollower' && !sVARS.avoidFollowersNodes) this.#createUserNode(args[0]);
		if (command === '!connectto' && targetNodeId) this.userNodes[user]?.tryConnectToPeer(targetNodeId);
	}
	#createUserNode(user) {
		if (this.userNodes[user]?.peerStore?.isDestroy) this.userNodes[user] = undefined;
		if (this.userNodes[user]) return;
		const peer = NodeP2P.createNode(`f_${user}`, pickUpRandomBootstraps());
		this.userNodes[user] = peer;
		peers.all[peer.id] = peer;
		peers.standard.unshift(peer);
		peer.gossip.on('message_handle', (msg, fromId) => statician.gossip++);
	}
	async restart() {
		this.ioSocket?.close();
		await new Promise(resolve => setTimeout(resolve, 100));
		return new TwitchChatCommandInterpreter();
	}
}
cmdInterpreter = new TwitchChatCommandInterpreter();