import { Node, createNode, createPublicNode } from "../../core/node.mjs";
import { CryptoCodex } from "../../core/crypto-codex.mjs";
import CONFIG from "../../core/config.mjs";

async function runSimulation() {
	const simulator = await import("../../simulation/simulator.mjs");
	return simulator.default;
}

const HiveP2P = { CONFIG, CryptoCodex, Node, createNode, createPublicNode, runSimulation };
export { CONFIG, CryptoCodex, Node, createNode, createPublicNode, runSimulation };
export default HiveP2P;