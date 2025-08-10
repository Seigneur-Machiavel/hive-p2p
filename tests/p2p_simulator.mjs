import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createNodeP2P, NodeP2P } from '../p2p_node.mjs';

const settings = {
	autoStart: true,
	publicPeersCount: 2,
	peersCount: 5,
	chosenPeerCount: 1
};

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
	await new Promise(resolve => setTimeout(resolve, 1000)); // wait for destruction to complete
	console.log(`| ° ${totalDestroyed} EXISTING PEERS DESTROYED ° |`);
}
async function initPeers() {
	await destroyAllExistingPeers();

	console.log('| °°° INITIALIZING PEERS... °°° |');
	// INIT PUBLIC PEERS ------------------------------------------------
	for (let i = 0; i < settings.publicPeersCount; i++) {
		const peer = createNodeP2P(`public_${i}`);
		peer.setAsPublic(`localhost`, 8080 + i, 10_000);
		peers.public.push(peer);
	}
	console.log(`${peers.public.length} public peers created.`);
	const publicPeersCards = peers.public.map(peer => peer.getPublicIdCard());
	
	// INIT STANDARD PEERS ----------------------------------------------
	let nextPublicPeerIndex = 0;
	for (let i = 0; i < settings.peersCount; i++) {
		peers.standard.push(createNodeP2P(`peer_${i}`, [publicPeersCards[nextPublicPeerIndex]]));
		nextPublicPeerIndex = (nextPublicPeerIndex + 1) % peers.public.length;
	}
	console.log(`${peers.standard.length} peers created.`);
	
	// INIT CHOSEN PEERS (to be connected with 2 public peers) ----------
	await new Promise(resolve => setTimeout(resolve, 2000)); // ensure the chosen nodes are last to connect
	for (let i = 0; i < settings.chosenPeerCount; i++)
		peers.chosen.push(createNodeP2P(`chosen_peer_${i}`, publicPeersCards));
}
if (settings.autoStart) initPeers();

// simple server to serve texts/p2p_simulator.html
const app = express();
const __dirname = path.resolve();
const parentPath = path.join(__dirname, '../P2P');
app.use(express.static(parentPath));
const server = app.listen(3000, () => console.log('Server listening on http://localhost:3000'));
app.get('/', (req, res) => res.sendFile('tests/p2p_simulator.html', { root: '.' }));

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
	ws.on('message', async (message) => onMessage(ws, message));
	ws.send(JSON.stringify({ type: 'settings', data: settings }));
	if (peers.public.length > 0 || peers.standard.length > 0 || peers.chosen.length > 0) {
		ws.send(JSON.stringify({ type: 'peersIds', data: peersIdsObj() }));
	}
});
function peersIdsObj() {
	return {
		public: peers.public.map(peer => peer.id),
		standard: peers.standard.map(peer => peer.id),
		chosen: peers.chosen.map(peer => peer.id)
	};
}
function getPeerInfo(peerId) {
	const peer = [...peers.public, ...peers.standard, ...peers.chosen].find(p => p.id === peerId);
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
const busyWith = {};
function onMessage(ws, message) {
	if (busyWith[ws.url]) return; // prevent multiple messages at once
	busyWith[ws.url] = true;

	const data = JSON.parse(message);
	switch (data.type) {
		case 'start':
			for (const setting in data.settings) settings[setting] = data.settings[setting];
			initPeers();
			//initPeers().then(() => ws.send(JSON.stringify({ type: 'peersIds', data: peersIdsObj() })));
			break;
		case 'getPeersIds':
			ws.send(JSON.stringify({ type: 'peersIds', data: peersIdsObj() }));
			break;
		case 'getPeerInfo':
			const peerInfo = getPeerInfo(data.peerId);
			ws.send(JSON.stringify({ type: 'peerInfo', data: peerInfo }));
			break;
		// Handle other message types as needed
	}
	busyWith[ws.url] = false;
}