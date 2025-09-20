const IS_BROWSER = typeof window !== 'undefined';

// ED25519 EXPOSURE NODEJS/BROWSER COMPATIBLE ---------------------------------
const [ed_, {sha512}] = await Promise.all([
    import(IS_BROWSER ? 'https://unpkg.com/@noble/ed25519@3.0.0/index.js' : '@noble/ed25519'),
    import(IS_BROWSER ? 'https://unpkg.com/@noble/hashes@1.4.0/sha2.js' : '@noble/hashes/sha2.js')
]);

/** @type {import('@noble/ed25519')} */
const ed = ed_;
ed.hashes.sha512 = sha512;

export const { sign, verify, keygen, getPublicKey, hash } = ed;
//-----------------------------------------------------------------------------