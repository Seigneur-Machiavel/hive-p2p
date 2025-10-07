export class DirectMessage {
    /** @param {string} type @param {number} timestamp @param {string[]} neighborsList @param {string[]} route @param {string} pubkey @param {string | Uint8Array | Object} data @param {string | undefined} signature @param {number} signatureStart @param {number} expectedEnd */
    constructor(type: string, timestamp: number, neighborsList: string[], route: string[], pubkey: string, data: string | Uint8Array | any, signature: string | undefined, signatureStart: number, expectedEnd: number);
    type: string;
    timestamp: number;
    neighborsList: string[];
    route: string[];
    pubkey: string;
    data: any;
    signature: string;
    signatureStart: number;
    expectedEnd: number;
    getSenderId(): string;
    getTargetId(): string;
    extractRouteInfo(selfId?: string): {
        traveledRoute: any[];
        selfPosition: number;
        senderId: any;
        targetId: any;
        prevId: any;
        nextId: any;
        routeLength: any;
    };
}
export class ReroutedDirectMessage extends DirectMessage {
    /** @param {string} type @param {number} timestamp @param {string[]} route @param {string} pubkey @param {string | Uint8Array | Object} data @param {Uint8Array} rerouterPubkey @param {string | undefined} signature @param {string[]} newRoute @param {string} rerouterSignature */
    constructor(type: string, timestamp: number, route: string[], pubkey: string, data: string | Uint8Array | any, signature: string | undefined, rerouterPubkey: Uint8Array, newRoute: string[], rerouterSignature: string);
    rerouterPubkey: Uint8Array<ArrayBufferLike>;
    newRoute: string[];
    rerouterSignature: string;
    getRerouterId(): string;
}
export class UnicastMessager {
    /** @param {string} selfId @param {import('./crypto-codex.mjs').CryptoCodex} cryptoCodex @param {import('./arbiter.mjs').Arbiter} arbiter @param {import('./peer-store.mjs').PeerStore} peerStore */
    constructor(selfId: string, cryptoCodex: import("./crypto-codex.mjs").CryptoCodex, arbiter: import("./arbiter.mjs").Arbiter, peerStore: import("./peer-store.mjs").PeerStore, verbose?: number);
    /** @type {Record<string, Function[]>} */ callbacks: Record<string, Function[]>;
    id: string;
    cryptoCodex: import("./crypto-codex.mjs").CryptoCodex;
    arbiter: import("./arbiter.mjs").Arbiter;
    peerStore: import("./peer-store.mjs").PeerStore;
    verbose: number;
    pathFinder: RouteBuilder_V2;
    maxHops: number;
    maxRoutes: number;
    maxNodes: number;
    /** @param {string} callbackType @param {Function} callback */
    on(callbackType: string, callback: Function): void;
    /** Send unicast message to a target
     * @param {string} remoteId @param {string | Uint8Array | Object} data @param {string} type
     * @param {number} [spread] Max neighbors used to relay the message, default: 1 */
    sendUnicast(remoteId: string, data: string | Uint8Array | any, type?: string, spread?: number): boolean;
    /** @param {string} from @param {Uint8Array} serialized */
    handleDirectMessage(from: string, serialized: Uint8Array): Promise<void>;
    #private;
}
import { RouteBuilder_V2 } from "./route-builder.mjs";
