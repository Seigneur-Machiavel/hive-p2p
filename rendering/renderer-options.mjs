export class NetworkRendererElements {
	modeSwitchBtn;
	nodeCountElement;
	connectingCountElement;
	neighborCountElement;
	publicNeighborCountElement;
	connectionsCountElement;
	linesCountElement;

	constructor(
		modeSwitchBtn = document.getElementById('modeSwitchBtn'),
		nodeCountElement = document.getElementById('nodeCount'),
		connectingCountElement = document.getElementById('connectingCount'),
		neighborCountElement = document.getElementById('neighborCount'),
		publicNeighborCountElement = document.getElementById('publicNeighborCount'),
		connectionsCountElement = document.getElementById('connectionsCount'),
		linesCountElement = document.getElementById('linesCount'),
	) {
		this.modeSwitchBtn = modeSwitchBtn;
		this.nodeCountElement = nodeCountElement;
		this.connectingCountElement = connectingCountElement;
		this.neighborCountElement = neighborCountElement;
		this.publicNeighborCountElement = publicNeighborCountElement;
		this.connectionsCountElement = connectionsCountElement;
		this.linesCountElement = linesCountElement;
	}
}

export class NetworkRendererOptions {
	mode;
	antialias;
	precision;
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
		antialias = true, // Enable or disable antialiasing
		precision = "highp", // "lowp"
		nodeRadius = 12,
		nodeBorderRadius = 3,
		attraction = .000001, // .0001
		repulsion = 5_000, // 50000
		damping = .005, // .5
		centerForce = .05, // .0005
		maxVelocity = 3, // .2
		repulsionOpts = {
			maxDistance: 400,
		},
		attractionOpts = {
			minDistance: 100, // 50
		}
	) {
		this.mode = mode;
		this.antialias = antialias;
		this.precision = precision;
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