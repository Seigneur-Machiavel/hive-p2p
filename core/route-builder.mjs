/**
 * @typedef {import('./peer-store.mjs').KnownPeer} KnownPeer
 * @typedef {import('./peer-store.mjs').PeerConnection} PeerConnection
 * 
 * @typedef {Object} RouteInfo
 * @property {string[]} path - Array of peer IDs forming the route [from, ..., remoteId]
 * @property {number} hops - Number of hops/relays in the route (path.length - 1)
 * @property {number} score - Quality score (0-1, higher is better)
 *
 * @typedef {Object} RouteResult
 * @property {RouteInfo[]} routes - Array of found routes, sorted by quality (best first)
 * @property {boolean} success - Whether at least one route was found
 * @property {number} nodesExplored - Number of nodes visited during search
 */

/** Simple prototype of a path finder searching to sort the possible routes form peerA to peerB
 * This logic can be improved a lot, especially in terms of efficiency and flexibility.
 * I chose a BFS approach for its simplicity and completeness. */
export class RouteBuilder_V1 {
	id;
	/** @type {Record<string, KnownPeer>} */ knownPeers;
	/** @type {Record<string, PeerConnection>} */ connectedPeers;
	constructor(selfId = 'toto', knownPeers = {}, connectedPeers = {}) {
		this.id = selfId;
		this.knownPeers = knownPeers;
		this.connectedPeers = connectedPeers;
	}

	/** Find all possible routes between two peers using exhaustive BFS
	 * - CAN BE IMPROVED
	 * @param {string} remoteId - Destination peer ID
	 * @param {number} maxRoutes - Maximum number of routes to return (default: 5)
	 * @param {number} maxHops - Maximum relays allowed (default: 3)
	 * @param {number} maxNodes - Maximum nodes to explore (default: 1728 = 12³)
	 * @param {boolean} sortByScore - Whether to sort routes by score (default: true)
	 * @returns {RouteResult} Result containing found routes and metadata */
	buildRoutes(remoteId, maxRoutes = 5, maxHops = 3, maxNodes = 1728, sortByScore = true) {
		if (this.id === remoteId) throw new Error('Cannot build route to self');
		if (this.connectedPeers[remoteId]) return { routes: [{ path: [this.id, remoteId] }], success: true, nodesExplored: 1 };
		if (!this.knownPeers[remoteId]) return { routes: [], success: false, nodesExplored: 0 };

		let nodesExplored = 0;
		const foundRoutes = [];
		const queue = [{ node: this.id, path: [this.id], depth: 0 }]; // Initialize BFS queue with starting point
		while (queue.length > 0 && nodesExplored < maxNodes) { // Exhaustive search: explore ALL paths up to maxHops
			const { node: current, path, depth } = queue.shift();
			nodesExplored++;
			if (depth >= maxHops) continue; // Don't explore beyond max depth

			const neighbors = current === this.id ? this.connectedPeers : this.knownPeers[current]?.neighbours || {};
			for (const neighbor of Object.keys(neighbors)) {
				if (path.includes(neighbor)) continue; // Skip if this would create a cycle
				
				// If we reached destination record this route or Continue exploring from this neighbor
				const newPath = [...path, neighbor];
				if (neighbor === remoteId) foundRoutes.push(newPath);
				else queue.push({ node: neighbor, path: newPath, depth: depth + 1 });
			}
		}

		if (foundRoutes.length === 0) return { routes: [], success: false, nodesExplored };
		
		const routesWithScores = foundRoutes.map(path => ({
			path,
			hops: path.length - 1,
			score: Math.max(0, 1 - (path.length * .1))
		}));

		if (sortByScore) routesWithScores.sort((a, b) => b.score - a.score); // Sort by score (best first)
		return { routes: routesWithScores.slice(0, maxRoutes), success: true, nodesExplored };
	}
}

/** Optimized route finder using bidirectional BFS and early stopping
 * Much more efficient than V1 for longer paths by searching from both ends */
export class RouteBuilder_V2 {
	selfId;
	/** @type {Record<string, KnownPeer>} */ knownPeers;
	/** @type {Record<string, PeerConnection>} */ connectedPeers;

	constructor(selfId = 'toto', knownPeers = {}, connectedPeers = {}) {
		this.id = selfId;
		this.knownPeers = knownPeers;
		this.connectedPeers = connectedPeers;
	}

	/** Find routes using bidirectional BFS with early stopping
	 * @param {string} remoteId - Destination peer ID
	 * @param {number} maxRoutes - Maximum number of routes to return (default: 5)
	 * @param {number} maxHops - Maximum relays allowed (default: 3)
	 * @param {number} maxNodes - Maximum nodes to explore (default: 1728)
	 * @param {boolean} sortByScore - Whether to sort routes by score (default: true)
	 * @param {number} goodEnoughScore - Stop early if route score >= this (default: 0.8)
	 * @returns {RouteResult} Result containing found routes and metadata */
	buildRoutes(remoteId, maxRoutes = 5, maxHops = 3, maxNodes = 1728, sortByScore = true, goodEnoughScore = 0.8) {
		if (this.id === remoteId) throw new Error('Cannot build route to self');
		if (this.connectedPeers[remoteId]) return { routes: [{ path: [this.id, remoteId]}], success: true, nodesExplored: 1 };
		if (!this.knownPeers[remoteId]) return { routes: [], success: false, nodesExplored: 0 };

		const result = this.#bidirectionalSearch(remoteId, maxHops, maxNodes, goodEnoughScore);
		if (!result.success) return { routes: [], success: false, nodesExplored: result.nodesExplored };

		const scoredRoutes = this.#calculateScores(result.paths);
		if (sortByScore) scoredRoutes.sort((a, b) => b.score - a.score);
		return { routes: scoredRoutes.slice(0, maxRoutes), success: true, nodesExplored: result.nodesExplored };
	}

	/** Bidirectional BFS: search from both ends until they meet
	 * @param {string} remoteId - Target peer
	 * @param {number} maxHops - Max hops allowed
	 * @param {number} maxNodes - Max nodes to explore
	 * @param {number} goodEnoughScore - Early stop threshold
	 * @returns {{success: boolean, paths: string[][], nodesExplored: number}} */
	#bidirectionalSearch(remoteId, maxHops, maxNodes, goodEnoughScore) {
		const foundPaths = [];
		let nodesExplored = 0;

		// Forward: from id outward
		const forwardQueue = [{ node: this.id, path: [this.id], pathSet: new Set([this.id]), depth: 0 }];
		const forwardVisited = new Map(); // node -> path from id
		forwardVisited.set(this.id, [this.id]);

		// Backward: from remoteId outward
		const backwardQueue = [{ node: remoteId, path: [remoteId], pathSet: new Set([remoteId]), depth: 0 }];
		const backwardVisited = new Map(); // node -> path from remoteId
		backwardVisited.set(remoteId, [remoteId]);

		const maxDepthPerSide = Math.ceil(maxHops / 2);
		while ((forwardQueue.length > 0 || backwardQueue.length > 0) && nodesExplored < maxNodes) {
			if (forwardQueue.length > 0) { // Expand forward search
				const meetings = this.#expandOneSide(forwardQueue, forwardVisited, backwardVisited, maxDepthPerSide);
				for (const meetingNode of meetings) {
					const completePath = this.#buildCompletePath(forwardVisited.get(meetingNode), backwardVisited.get(meetingNode));
					foundPaths.push(completePath);
					if (this.#calculateScore(completePath) < goodEnoughScore) continue;
					return { success: true, paths: foundPaths, nodesExplored };
				}
				nodesExplored++;
			}

			if (backwardQueue.length > 0) { // Expand backward search
				const meetings = this.#expandOneSide(backwardQueue, backwardVisited, forwardVisited, maxDepthPerSide);
				for (const meetingNode of meetings) {
					const completePath = this.#buildCompletePath(forwardVisited.get(meetingNode), backwardVisited.get(meetingNode));
					foundPaths.push(completePath);
					if (this.#calculateScore(completePath) < goodEnoughScore) continue;
					return { success: true, paths: foundPaths, nodesExplored };
				}
				nodesExplored++;
			}
		}

		return { success: foundPaths.length > 0, paths: foundPaths, nodesExplored };
	}

	/** Expand one side of the search and return meeting nodes
 * @param {Array} queue - Search queue for this side
 * @param {Map} visited - This side's visited nodes (node -> path)
 * @param {Map} otherVisited - Other side's visited nodes
 * @param {number} maxDepth - Max depth for this side
 * @returns {string[]} Array of meeting node IDs found this iteration */
	#expandOneSide(queue, visited, otherVisited, maxDepth) {
		if (queue.length === 0) return [];

		const { node: current, path, pathSet, depth } = queue.shift();
		if (depth >= maxDepth) return [];

		const meetings = [];
		const neighbors = this.#getNeighbors(current);
		for (const neighbor of Object.keys(neighbors)) {
			if (pathSet.has(neighbor)) continue;
			
			const newDepth = depth + 1;
			if (otherVisited.has(neighbor)) meetings.push(neighbor);
			if (visited.has(neighbor)) continue;
			
			const newPath = [...path, neighbor];
			const newPathSet = new Set(pathSet).add(neighbor);
			visited.set(neighbor, newPath);
			queue.push({ node: neighbor, path: newPath, pathSet: newPathSet, depth: newDepth });
		}

		return meetings;
	}

	/** Get neighbors for current node
	 * @param {string} nodeId - Current node
	 * @returns {Record<string, any>} Neighbors object */
	#getNeighbors(nodeId) {
		return nodeId === this.id ? this.connectedPeers : this.knownPeers[nodeId]?.neighbours || {};
	}

	/** Build complete path from meeting point
	 * @param {string[]} forwardPath - Path from selfId to meeting point
	 * @param {string[]} backwardPath - Path from remoteId to meeting point  
	 * @returns {string[]} Complete path from selfId to remoteId */
	#buildCompletePath(forwardPath, backwardPath) {
		const totalLength = forwardPath.length + backwardPath.length - 1;
		const result = new Array(totalLength);
		let index = 0;
		for (const node of forwardPath) result[index++] = node;
		for (let i = backwardPath.length - 2; i >= 0; i--) result[index++] = backwardPath[i];
		return result;
	}

	/** Calculate score for a single path
	 * @param {string[]} path - Route path
	 * @returns {number} Score between 0 and 1 */
	#calculateScore(path) { return Math.max(0, 1 - (path.length * 0.1)); }

	/** Calculate scores for multiple paths
	 * @param {string[][]} paths - Array of paths
	 * @returns {RouteInfo[]} Routes with scores */
	#calculateScores(paths) {
		const routes = [];
		for (const path of paths) routes.push({ path, hops: path.length - 1, score: this.#calculateScore(path) });
		return routes;
	}
}