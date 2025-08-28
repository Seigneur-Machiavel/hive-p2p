export class NetworkRendererElements {
	modeSwitchBtn;
	nodeCountElement;
	neighborCountElement;
	connectionCountElement;

	constructor(
		modeSwitchBtn = document.getElementById('modeSwitchBtn'),
		nodeCountElement = document.getElementById('nodeCount'),
		neighborCountElement = document.getElementById('neighborCount'),
		connectionCountElement = document.getElementById('connectionCount'),
	) {
		this.modeSwitchBtn = modeSwitchBtn;
		this.nodeCountElement = nodeCountElement;
		this.neighborCountElement = neighborCountElement;
		this.connectionCountElement = connectionCountElement;
	}
}

export class NetworkRendererOptions {
	mode;
	nodeRadius;
	nodeBorderRadius;
	attraction;
	repulsion;
	damping;
	centerForce;
	maxVelocity;
	repulsionOpts;
	attractionOpts;

	/**
	 * @param {'2d' | '3d'} mode 
	 * @param {number} nodeRadius @param {number} nodeBorderRadius @param {number} attraction @param {number} repulsion
	 * @param {number} damping @param {number} centerForce @param {number} maxVelocity
	 * 
	 * @param {Object} repulsionOpts
	 * @param {number} repulsionOpts.maxDistance
	 *
	 * @param {Object} attractionOpts
	 * @param {number} attractionOpts.minDistance
	 * */
	constructor(
		mode = '3d',
		nodeRadius = 12,
		nodeBorderRadius = 3,
		attraction = .001, // .0001
		repulsion = 5_000_000, // 50000
		damping = 1, // .5
		centerForce = .00005, // .0005
		maxVelocity = .5, // .2
		repulsionOpts = {
			maxDistance: 400,
		},
		attractionOpts = {
			minDistance: 100, // 50
		}
	) {
		this.mode = mode;
		this.nodeRadius = nodeRadius;
		this.nodeBorderRadius = nodeBorderRadius;
		this.attraction = attraction;
		this.repulsion = repulsion;
		this.damping = damping;
		this.centerForce = centerForce;
		this.maxVelocity = maxVelocity;
		this.repulsionOpts = repulsionOpts;
		this.attractionOpts = attractionOpts;
	}
}