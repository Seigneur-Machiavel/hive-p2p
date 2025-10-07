/**
 * @typedef {import('./peer-store.mjs').PeerStore} PeerStore
 *
 * @typedef {Object} RouteInfo
 * @property {string[]} path - Array of peer IDs forming the route [from, ..., remoteId]
 * @property {number} hops - Number of hops/relays in the route (path.length - 1)
 *
 * @typedef {Object} RouteResult
 * @property {RouteInfo[]} routes - Array of found routes, sorted by quality (best first)
 * @property {boolean | 'blind'} success - Whether at least one route was found
 * @property {number} nodesExplored - Number of nodes visited during search
 */
/** Optimized route finder using bidirectional BFS and early stopping
 * Much more efficient than V1 for longer paths by searching from both ends */
export class RouteBuilder_V2 {
    /** @param {string} selfId @param {PeerStore} peerStore */
    constructor(selfId: string, peerStore: PeerStore);
    /** @type {Record<string, RouteInfo[]>} */
    cache: Record<string, RouteInfo[]>;
    peerStore: import("./peer-store.mjs").PeerStore;
    id: string;
    /** Find routes using bidirectional BFS with early stopping
     * @param {string} remoteId - Destination peer ID
     * @param {number} maxRoutes - Maximum number of routes to return (default: 5)
     * @param {number} maxHops - Maximum relays allowed (default: 3)
     * @param {number} maxNodes - Maximum nodes to explore (default: 1728)
     * @param {boolean} sortByScore - Whether to sort routes by score (default: true)
     * @param {number} goodEnoughHops - Early stop threshold (default: 3 hops)
     * @returns {RouteResult} Result containing found routes and metadata */
    buildRoutes(remoteId: string, maxRoutes?: number, maxHops?: number, maxNodes?: number, sortByHops?: boolean, goodEnoughHops?: number): RouteResult;
    #private;
}
export type PeerStore = import("./peer-store.mjs").PeerStore;
export type RouteInfo = {
    /**
     * - Array of peer IDs forming the route [from, ..., remoteId]
     */
    path: string[];
    /**
     * - Number of hops/relays in the route (path.length - 1)
     */
    hops: number;
};
export type RouteResult = {
    /**
     * - Array of found routes, sorted by quality (best first)
     */
    routes: RouteInfo[];
    /**
     * - Whether at least one route was found
     */
    success: boolean | "blind";
    /**
     * - Number of nodes visited during search
     */
    nodesExplored: number;
};
