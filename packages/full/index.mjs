import { Node, createNode, createPublicNode } from "../../core/node.mjs";
import { CryptoCodex } from "../../core/crypto-codex.mjs";
import PARAMETERS from "../../core/parameters.mjs";

async function runSimulation() {
	const simulator = await import("../../simulation/simulator.mjs");
	return simulator.default;
}

const HiveP2P = { PARAMETERS, CryptoCodex, Node, createNode, createPublicNode, runSimulation };
export { PARAMETERS, CryptoCodex, Node, createNode, createPublicNode, runSimulation };
export default HiveP2P;