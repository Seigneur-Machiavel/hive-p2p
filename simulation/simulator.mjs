import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { NodeP2P } from '../core/node.mjs';
import { shuffleArray } from '../utils/p2p_common_functions.mjs';
import { MessageQueue, SubscriptionsManager } from './simulator-utils.mjs';
import { io } from 'socket.io-client'; // used for twitch events only

let initInterval = null;
/** @type {TwitchChatCommandInterpreter} */ let cmdInterpreter = null;
const sVARS = { // SIMULATION VARIABLES
	avoidFollowersNodes: false,
	publicPeersCards: [],
	startTime: Date.now(),
	useTestTransport: true,
	autoStart: true,
	publicPeersCount: 2,
	peersCount: 5,
	chosenPeerCount: 1,
	delayBetweenInit: 10, // 0 = faster for simulating big networks but > 0 = should be more realistic
	randomMessagePerSecond: 5, // 20 = 1 message every 50ms, 0 = disabled ( max: 500 )
};
if (sVARS.useTestTransport) {
	sVARS.publicPeersCount = 100; // 100; // stable: 3, medium: 100, strong: 200
	sVARS.peersCount = 800; // stable: 25, medium: 800, strong: 1600
	sVARS.chosenPeerCount = 100; // stable: 5, medium: 100, strong: 200
}

const peers = {
	/** @type {Record<string, NodeP2P>} */
	all: {},
	/** @type {Array<NodeP2P>} */
	public: [],
	/** @type {Array<NodeP2P>} */
	standard: [],
	/** @type {Array<NodeP2P>} */
	chosen: []
}

async function destroyAllExistingPeers() {
	let totalDestroyed = 0;
	for (const peer of peers.public) { peer.destroy(); peers.public = []; totalDestroyed ++; }
	for (const peer of peers.standard) { peer.destroy(); peers.standard = []; totalDestroyed ++; }
	for (const peer of peers.chosen) { peer.destroy(); peers.chosen = []; totalDestroyed ++; }

	return totalDestroyed;
}
function pickUpRandomBootstraps(count = 1) {
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
	// pickup one bootstrap only for standard node
	const selectedBootstraps = type === 'standard' ? pickUpRandomBootstraps(1) : bootstraps;
	const peer = NodeP2P.createNode(id, selectedBootstraps, sVARS.useTestTransport, init);
	peers.all[id] = peer;
	peers[type].push(peer);
	if (setPublic) sVARS.publicPeersCards.push(peer.setAsPublic(`localhost`, 8080 + i, 10_000));
}
async function initPeers() {
	if (initInterval) clearInterval(initInterval);
	const totalDestroyed = await destroyAllExistingPeers();
	console.log(`| ° ${totalDestroyed} EXISTING PEERS DESTROYED ° |`);
	if (totalDestroyed !== 0) await new Promise(resolve => setTimeout(resolve, 500)); // wait for destruction to complete

	sVARS.publicPeersCards = [];
	console.log('| °°° INITIALIZING PEERS... °°° |');

	const d = sVARS.delayBetweenInit;
	for (let i = 0; i < sVARS.publicPeersCount; i++) addPeer('public', i, [], true, true);
	for (let i = 0; i < sVARS.peersCount; i++) addPeer('standard', i, sVARS.publicPeersCards, d === 0);
	for (let i = 0; i < sVARS.chosenPeerCount; i++) addPeer('chosen', i, sVARS.publicPeersCards, d === 0);

	console.log(`Peers created: { P: ${peers.public.length}, S: ${peers.standard.length}, C: ${peers.chosen.length} }`);
	if (d === 0) return; // already initialized

	/** @type {Array<NodeP2P>} */
	const toInit = shuffleArray([...peers.chosen, ...peers.standard])
	if (d === 0) for (const peer of toInit) peer.init(); // init all peers at once.
	else initInterval = setInterval(() => { // ... Or successively
		if (toInit.pop()?.init()) return;
		clearInterval(initInterval);
		console.log('°°° ALL PEERS INITIALIZED °°°');
	}, d);
}
if (sVARS.autoStart) initPeers();

function peersIdsObj() {
	return {
		standard: peers.standard.map(peer => peer.id),
		public: peers.public.map(peer => peer.id),
		chosen: peers.chosen.map(peer => peer.id)
	};
}
function getPeerInfo(peerId) {
	const peer = peers.all[peerId];
	if (!peer) return null;
	return {
		id: peer.id,
		store: {
			connected: Object.keys(peer.peerStore.connected), // ids only
			connecting: Object.keys(peer.peerStore.connecting), // ids only
			known: peer.peerStore.known
		}
	}
}
function sendRandomMessage(log = false) {
	try {
		const peerIds = [...peers.public, ...peers.standard, ...peers.chosen].map(p => p.id);
		const sender = peers.all[peerIds[Math.floor(Math.random() * peerIds.length)]];
		//const recipient = peers.all[peerIds[Math.floor(Math.random() * peerIds.length)]];
		const senderKnowsPeers = sender ? Object.keys(sender.peerStore.known) : [];
		const recipientId = senderKnowsPeers[Math.floor(Math.random() * senderKnowsPeers.length)];
		const recipient = peers.all[recipientId];
		if (!sender || !recipient || sender.id === recipient.id) return; // skip if sender or recipient is not found or they are the same
		const message = { type: 'message', data: `Hello from ${sender.id}` };
		const result = sender.sendMessage(recipient.id, 'message', message);
		if (!log) return;
		if (!result || result.success) console.error(`Failed to send message to ${recipient.id}: ${result.reason}`);
		else console.log(`Message sent to ${recipient.id} via routes: ${JSON.stringify(result.routes)}`);
	} catch (error) { console.error('Error sending random message:', error); }
}
if (sVARS.randomMessagePerSecond) setInterval(sendRandomMessage, 1000 / Math.min(sVARS.randomMessagePerSecond, 500));

// simple server to serve texts/p2p_simulator.html
const app = express();
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

const msgQueue = new MessageQueue();
let sManager = new SubscriptionsManager(send, peers, sVARS);
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
	if (clientWs) clientWs.close();
	clientWs = ws;
	ws.on('message', async (message) => msgQueue.push(JSON.parse(message)));
	ws.on('close', () => { sManager.destroy(); msgQueue.reset(); });
	ws.send(JSON.stringify({ type: 'settings', data: sVARS }));
	const zeroPeers = peers.public.length + peers.standard.length + peers.chosen.length === 0;
	if (!zeroPeers) ws.send(JSON.stringify({ type: 'peersIds', data: peersIdsObj() }));
});

const onMessage = async (data) => {
	if (!data) return;
	switch (data.type) {
		case 'start':
			sVARS.startTime = Date.now();
			sManager = sManager ? sManager.destroy(true) : new SubscriptionsManager(send, peers, sVARS);
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
			break;
		case 'subscribeToPeerMessages':
			if (sManager.onPeerMessage === data.peerId) return; // already subscribed
			sManager = sManager.destroy(true);
			if (sManager.addPeerMessageListener(data.peerId))
				send({ type: 'subscribeToPeerMessage', data: { success: true, peerId: data.peerId } });
			break;
		case 'tryToConnectNode':
			const { fromId, targetId } = data;
			if (!fromId || !targetId) return;
			peers.all[fromId]?.tryConnectToPeer(targetId);
			break;
	}
}

(async () => { // Message processing loop
	while (true) {
		await onMessage(msgQueue.getNextMessage());
		await new Promise(resolve => setTimeout(resolve, 10)); // prevent blocking the event loop
	}
})();

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
		const peer = NodeP2P.createNode(`f_${user}`, pickUpRandomBootstraps(1), sVARS.useTestTransport);
		this.userNodes[user] = peer;
		peers.all[peer.id] = peer;
		peers.standard.unshift(peer);
	}
	async restart() {
		this.ioSocket?.close();
		await new Promise(resolve => setTimeout(resolve, 100));
		return new TwitchChatCommandInterpreter();
	}
}
cmdInterpreter = new TwitchChatCommandInterpreter();