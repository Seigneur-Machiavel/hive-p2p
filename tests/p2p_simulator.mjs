import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createNodeP2P, NodeP2P } from '../p2p_node.mjs';

const sVARS = { // SIMULATION VARIABLES
	startTime: Date.now(),
	transport: 'Test', // 'SimplePeer' or 'Test'
	autoStart: true,
	publicPeersCount: 2,
	peersCount: 5,
	chosenPeerCount: 1,
	randomMessagePerSecond: 10, // 20 = 1 message every 50ms, 0 = disabled ( max: 500 )
};
if (sVARS.transport === 'Test') {
	sVARS.publicPeersCount = 3; // stable: 3
	sVARS.peersCount = 50; // stable: 25
	sVARS.chosenPeerCount = 5; // stable: 5
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
	if (totalDestroyed === 0) return;
	await new Promise(resolve => setTimeout(resolve, 500)); // wait for destruction to complete
	console.log(`| ° ${totalDestroyed} EXISTING PEERS DESTROYED ° |`);
}
async function initPeers() {
	await destroyAllExistingPeers();

	console.log('| °°° INITIALIZING PEERS... °°° |');
	// INIT PUBLIC PEERS ------------------------------------------------
	for (let i = 0; i < sVARS.publicPeersCount; i++) {
		const peer = createNodeP2P(`public_${i}`, [], sVARS.transport);
		peer.setAsPublic(`localhost`, 8080 + i, 10_000);
		peers.public.push(peer);
	}
	console.log(`${peers.public.length} public peers created.`);
	const publicPeersCards = peers.public.map(peer => peer.getPublicIdCard());
	
	// INIT STANDARD PEERS ----------------------------------------------
	let nextPublicPeerIndex = 0;
	for (let i = 0; i < sVARS.peersCount; i++) {
		peers.standard.push(createNodeP2P(`peer_${i}`, [publicPeersCards[nextPublicPeerIndex]], sVARS.transport));
		nextPublicPeerIndex = (nextPublicPeerIndex + 1) % peers.public.length;
	}
	console.log(`${peers.standard.length} peers created.`);
	
	// INIT CHOSEN PEERS (to be connected with 2 public peers) ----------
	await new Promise(resolve => setTimeout(resolve, 500)); // ensure the chosen nodes are last to connect
	for (let i = 0; i < sVARS.chosenPeerCount; i++)
		peers.chosen.push(createNodeP2P(`chosen_${i}`, publicPeersCards, sVARS.transport));
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
	onPeerMessage = null;

	addPeerMessageListener(peerId, ws) {
		const peer = getPeer(peerId);
		if (!peer) return false;
		
		this.onPeerMessage = peerId;
		peer.peerStore.onData.unshift((remoteId, d) => {
			const data = JSON.parse(d);
			ws.send(JSON.stringify({ type: 'peerMessage', remoteId, data: JSON.stringify(data) }));
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
		if (peer) peer.peerStore.onData.splice(0, 1);
		this.onPeerMessage = null;
	}
	removeAllListeners() {
		this.removePeerMessageListener();
	}
};

const sManager = new SubscriptionsManager();
setInterval(() => {
	console.log(`${Math.floor((Date.now() - sVARS.startTime) / 1000)} sec elapsed ----------------------`);
	console.log(`Total messages: ${sManager.totalMsg} (+${sManager.sessionMsg})`);
	for (const topic in sManager.TMPT) console.log(`Topic "${topic}" messages:  ${sManager.TMPT[topic]} (+${sManager.MTP[topic] || 0})`);
	for (const topic in sManager.MTP) sManager.MTP[topic] = 0; // reset per topic count
	sManager.sessionMsg = 0; // reset session count
}, 10_000);

let wsBusy = false; // to prevent multiple messages at once
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
	ws.on('message', async (message) => {
		if (wsBusy) return; // prevent multiple messages at once
		wsBusy = true;
		await onMessage(ws, message);
		wsBusy = false;
	});
	ws.on('close', () => { sManager.removeAllListeners(); wsBusy = false; });
	ws.send(JSON.stringify({ type: 'settings', data: sVARS }));
	if (peers.public.length > 0 || peers.standard.length > 0 || peers.chosen.length > 0)
		ws.send(JSON.stringify({ type: 'peersIds', data: peersIdsObj() }));
});

async function onMessage(ws, message, minLogTime = 5) {
	const data = JSON.parse(message);
	const startTime = Date.now();
	// if (logTreatmentTime) console.log(`Message ${data.type} processed in ${Date.now() - startTime}ms`);
	const send = (msgObj) => {
		const tt = Date.now() - startTime;
		if (tt < minLogTime) ws.send(JSON.stringify(msgObj));	
		else ws.send(JSON.stringify(msgObj), () => console.log(`Message ${msgObj.type} sent (${tt}ms)`));
	}

	switch (data.type) {
		case 'start':
			sVARS.startTime = Date.now();
			sManager.removeAllListeners();
			for (const setting in data.settings) sVARS[setting] = data.settings[setting];
			await initPeers();
			send({ type: 'settings', data: sVARS });
			send({ type: 'peersIds', data: peersIdsObj() });
			send({ type: 'simulationStarted' });
			//initPeers().then(() => send({ type: 'peersIds', data: peersIdsObj() }));
			break;
		case 'getPeersIds':
			send({ type: 'peersIds', data: peersIdsObj() });
			break;
		case 'getPeerInfo':
			const peerInfo = getPeerInfo(data.peerId);
			send({ type: 'peerInfo', data: peerInfo });
			break;
		case 'subscribeToPeerMessages':
			if (sManager.onPeerMessage === data.peerId) return; // already subscribed
			sManager.removePeerMessageListener();
			if (sManager.addPeerMessageListener(data.peerId, ws))
				send({ type: 'subscribeToPeerMessage', data: { success: true, peerId: data.peerId } });
			break;
		case 'tryToConnectNode':
			const { fromId, targetId } = data;
			if (!fromId || !targetId) return;
			getPeer(fromId)?.tryConnectToPeer(targetId);
			break;
	}
}