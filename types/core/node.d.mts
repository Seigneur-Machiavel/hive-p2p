/** Create and start a new PublicNode instance.
 * @param {Object} options
 * @param {string[]} options.bootstraps List of bootstrap nodes used as P2P network entry
 * @param {boolean} [options.autoStart] If true, the node will automatically start after creation (default: true)
 * @param {CryptoCodex} [options.cryptoCodex] Identity of the node; if not provided, a new one will be generated
 * @param {string} [options.domain] If provided, the node will operate as a public node and start necessary services (e.g., WebSocket server)
 * @param {number} [options.port] If provided, the node will listen on this port (default: SERVICE.PORT)
 * @param {number} [options.verbose] Verbosity level for logging (default: NODE.DEFAULT_VERBOSE) */
export function createPublicNode(options: {
    bootstraps: string[];
    autoStart?: boolean;
    cryptoCodex?: CryptoCodex;
    domain?: string;
    port?: number;
    verbose?: number;
}): Promise<Node>;
/** Create and start a new Node instance.
 * @param {Object} options
 * @param {string[]} options.bootstraps List of bootstrap nodes used as P2P network entry
 * @param {CryptoCodex} [options.cryptoCodex] Identity of the node; if not provided, a new one will be generated
 * @param {boolean} [options.autoStart] If true, the node will automatically start after creation (default: true)
 * @param {number} [options.verbose] Verbosity level for logging (default: NODE.DEFAULT_VERBOSE) */
export function createNode(options?: {
    bootstraps: string[];
    cryptoCodex?: CryptoCodex;
    autoStart?: boolean;
    verbose?: number;
}): Promise<Node>;
export class Node {
    /** Initialize a new P2P node instance, use .start() to init topologist
     * @param {CryptoCodex} cryptoCodex - Identity of the node.
     * @param {string[]} bootstraps List of bootstrap nodes used as P2P network entry */
    constructor(cryptoCodex: CryptoCodex, bootstraps?: string[], verbose?: number);
    started: boolean;
    id: string;
    cryptoCodex: CryptoCodex;
    verbose: number;
    /** @type {OfferManager} */ offerManager: OfferManager;
    /** @type {Arbiter} */ arbiter: Arbiter;
    /** @type {PeerStore} */ peerStore: PeerStore;
    /** @type {UnicastMessager} */ messager: UnicastMessager;
    /** @type {Gossip} */ gossip: Gossip;
    /** @type {Topologist} */ topologist: Topologist;
    /** @type {NodeServices | undefined} */ services: NodeServices | undefined;
    /** @returns {string | undefined} */
    get publicUrl(): string | undefined;
    get time(): any;
    onMessageData(callback: any): void;
    onGossipData(callback: any): void;
    start(): Promise<boolean>;
    arbiterInterval: NodeJS.Timeout;
    peerStoreInterval: NodeJS.Timeout;
    enhancerInterval: NodeJS.Timeout;
    /** Broadcast a message to all connected peers or to a specified peer
     * @param {string | Uint8Array | Object} data @param {string} topic  @param {string} [targetId] default: broadcast to all
     * @param {number} [timestamp] default: CLOCK.time @param {number} [HOPS] default: GOSSIP.HOPS[topic] || GOSSIP.HOPS.default */
    broadcast(data: string | Uint8Array | any, topic: string, HOPS?: number): void;
    /** @param {string} remoteId @param {string | Uint8Array | Object} data @param {string} type */
    sendMessage(remoteId: string, data: string | Uint8Array | any, type: string, spread?: number): void;
    tryConnectToPeer(targetId?: string, retry?: number): Promise<void>;
    destroy(): void;
    #private;
}
import { CryptoCodex } from './crypto-codex.mjs';
import { OfferManager } from './ice-offer-manager.mjs';
import { Arbiter } from './arbiter.mjs';
import { PeerStore } from './peer-store.mjs';
import { UnicastMessager } from './unicast.mjs';
import { Gossip } from './gossip.mjs';
import { Topologist } from './topologist.mjs';
import { NodeServices } from './node-services.mjs';
