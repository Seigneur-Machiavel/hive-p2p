export class NodeServices {
    /** @param {string[]} bootstraps */
    static deriveSTUNServers(bootstraps: string[]): {
        urls: string;
    }[];
    /** @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {import('./peer-store.mjs').PeerStore} peerStore */
    constructor(cryptoCodex: import("./crypto-codex.mjs").CryptoCodex, peerStore: import("./peer-store.mjs").PeerStore, maxKick?: number, verbose?: number);
    id: string;
    verbose: number;
    maxKick: number;
    peerStore: import("./peer-store.mjs").PeerStore;
    cryptoCodex: import("./crypto-codex.mjs").CryptoCodex;
    /** @type {string | undefined} WebSocket URL (public node only) */ publicUrl: string | undefined;
    start(domain?: string, port?: number): void;
    freePublicNodeByKickingPeers(): void;
    wsServer: any;
    stunServer: import("dgram").Socket;
    #private;
}
