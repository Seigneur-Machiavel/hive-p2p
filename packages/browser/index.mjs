import { Node, createNode } from "../../core/node.mjs";
import { CryptoCodex } from "../../core/crypto-codex.mjs";
import CONFIG from "../../core/config.mjs";

const HiveP2P = { Node, createNode, CryptoCodex, CONFIG };
export { Node, createNode, CryptoCodex, CONFIG };
export default HiveP2P;

if (typeof window !== 'undefined') window.HiveP2P = HiveP2P;