export class KnownPeer {
    /** CAUTION: Call this one only in PeerStore.unlinkPeers() @param {Record<string, number>} neighbors key: peerId, value: timestamp */
    constructor(neighbors?: Record<string, number>);
    neighbors: Record<string, number>;
    connectionsCount: number;
    /** Set or update neighbor @param {string} peerId @param {number} [timestamp] */
    setNeighbor(peerId: string, timestamp?: number): void;
    /** Unset neighbor @param {string} peerId */
    unsetNeighbor(peerId: string): void;
}
export class PeerConnection {
    /** Connection to a peer, can be WebSocket or WebRTC, can be connecting or connected
     * @param {string} peerId
     * @param {import('simple-peer').Instance | import('ws').WebSocket} transportInstance
     * @param {'in' | 'out'} direction @param {boolean} [isWebSocket] default: false */
    constructor(peerId: string, transportInstance: any | any, direction: "in" | "out", isWebSocket?: boolean);
    peerId: string;
    transportInstance: any;
    isWebSocket: boolean;
    direction: "in" | "out";
    pendingUntil: any;
    connStartTime: any;
    setConnected(): void;
    getConnectionDuration(): number;
    close(): void;
}
/** @typedef {{ in: PeerConnection, out: PeerConnection }} PeerConnecting */
export class PeerStore {
    /** @param {string} selfId @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {import('./ice-offer-manager.mjs').OfferManager} offerManager @param {import('./arbiter.mjs').Arbiter} arbiter @param {number} [verbose] default: 0 */
    constructor(selfId: string, cryptoCodex: import("./crypto-codex.mjs").CryptoCodex, offerManager: import("./ice-offer-manager.mjs").OfferManager, arbiter: import("./arbiter.mjs").Arbiter, verbose?: number);
    id: string;
    cryptoCodex: import("./crypto-codex.mjs").CryptoCodex;
    offerManager: import("./ice-offer-manager.mjs").OfferManager;
    arbiter: import("./arbiter.mjs").Arbiter;
    verbose: number;
    isDestroy: boolean;
    /** @type {string[]} The neighbors IDs */ neighborsList: string[];
    /** @type {Record<string, PeerConnecting>} */ connecting: Record<string, PeerConnecting>;
    /** @type {Record<string, PeerConnection>} */ connected: Record<string, PeerConnection>;
    /** @type {Record<string, KnownPeer>} */ known: Record<string, KnownPeer>;
    /** @type {number} */ knownCount: number;
    /** @type {Record<string, number>} */ kick: Record<string, number>;
    /** @type {Record<string, Function[]>} */ callbacks: Record<string, Function[]>;
    get publicNeighborsList(): string[];
    get standardNeighborsList(): string[];
    cleanupExpired(andUpdateKnownBasedOnNeighbors?: boolean): void;
    /** @param {string} callbackType @param {Function} callback */
    on(callbackType: string, callback: Function): void;
    /** Cleanup expired neighbors and return the updated connections count @param {string} peerId */
    getUpdatedPeerConnectionsCount(peerId: string, includesPublic?: boolean): number;
    /** Initialize/Get a connecting peer WebRTC connection (SimplePeer Instance)
     * @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} signal
     * @param {string} [offerHash] offer only */
    addConnectingPeer(remoteId: string, signal: {
        type: "offer" | "answer";
        sdp: Record<string, string>;
    }, offerHash?: string): true | void;
    /** @param {string} remoteId @param {{type: 'offer' | 'answer', sdp: Record<string, string>}} signal @param {string} [offerHash] answer only @param {number} timestamp Answer reception timestamp */
    assignSignal(remoteId: string, signal: {
        type: "offer" | "answer";
        sdp: Record<string, string>;
    }, offerHash?: string, timestamp: number): void;
    /** Avoid peer connection @param {string} peerId @param {number} duration default: 60_000ms @param {string} [reason] */
    kickPeer(peerId: string, duration?: number, reason?: string): void;
    isKicked(peerId: any): boolean;
    /** Improve discovery by considering used route as peer links @param {string[]} route */
    digestValidRoute(route?: string[]): void;
    /** @param {string} peerId @param {string[]} neighbors */
    digestPeerNeighbors(peerId: string, neighbors?: string[]): void;
    destroy(): void;
    #private;
}
export type PeerConnecting = {
    in: PeerConnection;
    out: PeerConnection;
};
