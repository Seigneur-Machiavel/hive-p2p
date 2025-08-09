
import { createNodeP2P, NodeP2P } from '../p2p_node.mjs';

const settings = {
	publicPeersCount: 5,
	peersCount: 10,
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

await new Promise(resolve => setTimeout(resolve, 2000)); // ensure the chosen nodes are last to connect
// INIT CHOSEN PEERS (to be connected with 2 public peers) ----------
for (let i = 0; i < settings.chosenPeerCount; i++)
	peers.chosen.push(createNodeP2P(`chosen_peer_${i}`, publicPeersCards));