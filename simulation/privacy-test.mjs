// SIMPLE FILE TO TEST PRIVACY-RELATED FEATURES

const { createNode, createPublicNode } = await import('../core/node.mjs'); // dynamic import to allow simulation overrides

const b = await createPublicNode({autoStart: true});
const url = b.publicUrl;
console.log(`Public node URL: ${url}`);

const n = await createNode({bootstraps: [url]});
console.log(`Node ID: ${n.id}`);

for (const node of [b, n])
	node.onMessageData((from, data) => console.log(`Node ${node.id} received message from ${from}:`, data));

setTimeout(() => {
	n.sendMessage(b.id, 'hello');
	n.sendPrivateMessage(b.id, 'private hello');
}, 2000);