import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { NodeP2P } from '../p2p_node.mjs';
import { shuffleArray } from '../p2p_utils.mjs';

const sVARS = { // SIMULATION VARIABLES
	startTime: Date.now(),
	transport: 'Test', // 'SimplePeer' or 'Test'
	autoStart: true,
	publicPeersCount: 2,
	peersCount: 5,
	chosenPeerCount: 1,
	delayBetweenInit: 2, // 0 = faster for simulating big networks but > 0 = should be more realistic
	randomMessagePerSecond: 10, // 20 = 1 message every 50ms, 0 = disabled ( max: 500 )
};
if (sVARS.transport === 'Test') {
	sVARS.publicPeersCount = 400; // stable: 3, strong: 200
	sVARS.peersCount = 1000; // stable: 25, strong: 1000
	sVARS.chosenPeerCount = 1000; // stable: 5, strong: 200
}

const peers = {
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
async function initPeers() {
	const totalDestroyed = await destroyAllExistingPeers();
	console.log(`| ° ${totalDestroyed} EXISTING PEERS DESTROYED ° |`);
	if (totalDestroyed !== 0) await new Promise(resolve => setTimeout(resolve, 500)); // wait for destruction to complete

	const t = sVARS.transport;
	console.log('| °°° INITIALIZING PEERS... °°° |');
	// INIT PUBLIC PEERS ------------------------------------------------
	const publicPeersCards = [];
	for (let i = 0; i < sVARS.publicPeersCount; i++) {
		const peer = NodeP2P.createNode(`public_${i}`, [], t);
		const card = peer.setAsPublic(`localhost`, 8080 + i, 10_000);
		peers.public.push(peer);
		publicPeersCards.push(card);
	}

	// CREATE STANDARD & CHOSEN PEERS -----------------------------------
	const d = sVARS.delayBetweenInit;
	for (let i = 0; i < sVARS.peersCount; i++) peers.standard.push(NodeP2P.createNode(`peer_${i}`, [publicPeersCards[i % publicPeersCards.length]], t, d === 0));
	for (let i = 0; i < sVARS.chosenPeerCount; i++) peers.chosen.push(NodeP2P.createNode(`chosen_${i}`, publicPeersCards, t, d === 0));
	console.log(`Peers created: { P: ${peers.public.length}, S: ${peers.standard.length}, C: ${peers.chosen.length} }`);
	if (d === 0) return; // already initialized

	const toInit = shuffleArray([...peers.chosen, ...peers.standard])
	let initInterval = setInterval(() => toInit.pop()?.init() || clearInterval(initInterval), d);
}
if (sVARS.autoStart) initPeers();

function peersIdsObj() {
	return {
		public: peers.public.map(peer => peer.id),
		standard: peers.standard.map(peer => peer.id),
		chosen: peers.chosen.map(peer => peer.id)
	};
}
function getPeer(peerId) {
	return [...peers.public, ...peers.standard, ...peers.chosen].find(p => p.id === peerId);
}
function getPeerInfo(peerId) {
	const peer = getPeer(peerId);
	if (!peer) return null;
	return {
		id: peer.id,
		store: {
			connected: Object.keys(peer.peerStore.store.connected), // ids only
			connecting: Object.keys(peer.peerStore.store.connecting), // ids only
			known: peer.peerStore.store.known
		}
	}
}
function sendRandomMessage(log = false) {
	try {
		const peerIds = [...peers.public, ...peers.standard, ...peers.chosen].map(p => p.id);
		const sender = getPeer(peerIds[Math.floor(Math.random() * peerIds.length)]);
		const recipient = getPeer(peerIds[Math.floor(Math.random() * peerIds.length)]);
		if (!sender || !recipient || sender.id === recipient.id) return; // skip if sender or recipient is not found or they are the same
		const message = { type: 'randomMessage', data: `Hello from ${sender.id}` };
		const result = sender.sendMessage(recipient.id, 'message', message);
		if (!log) return;
		if (!result) return;
		if (!result.success) console.error(`Failed to send message to ${recipient.id}: ${result.reason}`);
		else console.log(`Message sent to ${recipient.id} via routes: ${JSON.stringify(result.routes)}`);
	} catch (error) { console.error('Error sending random message:', error); }
}
if (sVARS.randomMessagePerSecond) setInterval(sendRandomMessage, 1000 / Math.min(sVARS.randomMessagePerSecond, 500));

// simple server to serve texts/p2p_simulator.html
const app = express();
const __dirname = path.resolve();
const parentPath = path.join(__dirname, '../P2P');
app.use(express.static(parentPath));
const server = app.listen(3000, () => console.log('Server listening on http://localhost:3000'));
app.get('/', (req, res) => res.sendFile('tests/p2p_visualizer.html', { root: '.' }));

class SubscriptionsManager {
	totalMsg = 0;
	sessionMsg = 0;
	TMPT = {}; // Gossip "total Msg Per Topic"
	MTP = {}; // Gossip "Msg Per Topic"
	onPeerMessage = null; // currently subscribed peer
	interval;

	constructor(delay = 10_000) {
		console.info('SubscriptionsManager initialized');
		this.interval = setInterval(() => {
			console.info(`${Math.floor((Date.now() - sVARS.startTime) / 1000)} sec elapsed ----------------------`);
			console.info(`Total messages: ${sManager.totalMsg} (+${this.sessionMsg})`);
			for (const topic in this.TMPT) console.info(`Topic "${topic}" messages:  ${this.TMPT[topic]} (+${this.MTP[topic] || 0})`);
			for (const topic in this.MTP) this.MTP[topic] = 0; // reset per topic count
			this.sessionMsg = 0; // reset session count
		}, delay);
	}
	addPeerMessageListener(peerId) {
		const peer = getPeer(peerId);
		if (!peer) return false;
		
		this.onPeerMessage = peerId;
		peer.peerStore.on('data', (remoteId, d) => {
			const data = JSON.parse(d);
			clientWs.send(JSON.stringify({ type: 'peerMessage', remoteId, data: JSON.stringify(data) }));
			if (data.topic) {
				this.TMPT[data.topic] ? this.TMPT[data.topic]++ : this.TMPT[data.topic] = 1;
				this.MTP[data.topic] ? this.MTP[data.topic]++ : this.MTP[data.topic] = 1;
			}
			this.totalMsg++; this.sessionMsg++;
		});
		return true;
	}
	removePeerMessageListener() {
		const peer = getPeer(this.onPeerMessage);
		if (peer) peer.peerStore.callbacks.data.splice(0, 1);
		this.onPeerMessage = null;
	}
	destroy(returnNewInstance = false) {
		this.removePeerMessageListener();
		if (this.interval) clearInterval(this.interval);
		if (returnNewInstance) return new SubscriptionsManager();
	}
};

/** @type {WebSocket} */
let clientWs;
let msgQueue = [];
let sManager = new SubscriptionsManager();
new WebSocketServer({ server }).on('connection', (ws) => {
	if (clientWs) clientWs.close();
	clientWs = ws;
	ws.on('message', async (message) => msgQueue.push(JSON.parse(message)));
	ws.on('close', () => { sManager.destroy(); msgQueue = []; });
	ws.send(JSON.stringify({ type: 'settings', data: sVARS }));
	const zeroPeers = peers.public.length + peers.standard.length + peers.chosen.length === 0;
	if (!zeroPeers) ws.send(JSON.stringify({ type: 'peersIds', data: peersIdsObj() }));
});

const onMessage = async (data, minLogTime = 5) => {
	const startTime = Date.now();
	const send = (msgObj) => {
		clientWs.send(JSON.stringify(msgObj), () => {
			const tt = Date.now() - startTime;
			if (tt > minLogTime) console.log(`Message ${msgObj.type} sent (${tt}ms)`);
		});
	}

	switch (data.type) {
		case 'start':
			sVARS.startTime = Date.now();
			sManager = sManager ? sManager.destroy(true) : new SubscriptionsManager();
			for (const setting in data.settings) sVARS[setting] = data.settings[setting];
			await initPeers();
			send({ type: 'settings', data: sVARS });
			send({ type: 'peersIds', data: peersIdsObj() });
			send({ type: 'simulationStarted' });
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
			getPeer(fromId)?.tryConnectToPeer(targetId);
			break;
	}
}

while (true) {
	if (msgQueue.length > 0) await onMessage(msgQueue.pop());
	await new Promise(resolve => setTimeout(resolve, 10)); // prevent blocking the event loop
}