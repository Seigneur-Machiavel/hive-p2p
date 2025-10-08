import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

ed25519.hashes.sha512 = sha512;

export { ed25519, sha512 };