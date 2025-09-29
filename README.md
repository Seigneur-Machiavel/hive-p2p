# HiveP2P 🐝

> A self-optimizing P2P network that achieves maximum entropy through global topology awareness

## What is HiveP2P?

HiveP2P is a revolutionary peer-to-peer protocol that solves the fundamental entropy limitations of traditional DHTs like Kademlia. Instead of hoping for good network distribution, each peer actively participates in global topology optimization.

**Key Innovation:** Every message carries neighbor information, allowing peers to build a real-time network map and select connections that maximize uniformity.

### Why Another P2P Protocol?

Traditional DHTs suffer from:
- **Geographic clustering** - Peers in the same region get grouped together
- **Correlated failures** - Power outages can isolate entire network sections  
- **Bootstrap bias** - New nodes discover the same initial clusters
- **Blind topology** - No visibility into global network structure

HiveP2P solves these through **continuous topology awareness and optimization**.

## Quick Start

### Installation

```bash
# Full package (Node.js)
npm install hive-p2p@latest

# Server-optimized (lighter)
npm install @hive-p2p/server

# Browser bundle
npm install @hive-p2p/browser
```

### Basic Usage

```javascript
import { Node } from 'hive-p2p';

// Create a node
const node = new Node();

// Start with bootstrap nodes
await node.start([
  { id: '0abc...', publicUrl: 'ws://seed1.example.com:8080' },
  { id: '0def...', publicUrl: 'ws://seed2.example.com:8080' }
]);

// Send messages
node.on('message', (senderId, data) => {
  console.log(`Message from ${senderId}:`, data);
});

// Broadcast to network
node.gossip.broadcastToAll({ type: 'announcement', value: 'Hello Hive!' });

// Direct message
node.messager.sendUnicast(targetId, { type: 'private', content: 'Direct message' });
```

## How It Works

### 1. Continuous Neighbor Discovery

Every protocol message includes the sender's neighbor list. This passive information sharing allows the network to maintain an up-to-date topology map without dedicated discovery messages.

```
Node A sends message → [neighbors: B,C,D]
Node E receives it  → Updates its map
Node E calculates   → "I should connect to A for better distribution"
```

### 2. Smart Connection Selection

Nodes optimize connections based on two factors:
- **Overlap minimization** - Connect to peers with different neighbors
- **Wealth balancing** - Poor nodes seek rich nodes, rich nodes accept poor nodes

This creates a self-balancing network that naturally converges toward maximum entropy.

### 3. Gossip Protocol with Bloom Filters

Messages propagate through the network via gossip with intelligent deduplication:
- Each node maintains a lightweight bloom filter
- Messages include hop count for TTL management
- Transmission rate adapts to neighbor count

### 4. Direct Messaging with Routing

Point-to-point communication using source routing:
- BFS algorithm finds optimal paths
- Failed routes trigger automatic rerouting  
- Routes are cryptographically signed to prevent tampering

## Network Convergence

Real simulation results with 2000 nodes:

```
┌──────────────────────────────────────────────────────────┐
│ 10 minutes (600s)                                        │
├──────────────────────────────────────────────────────────┤
│ Active nodes:    2002/2002 (1902 established)           │
│ Avg neighbors:   4.7                                     │
│ Network coverage: 100% (T: 10571)                        │
│ Avg latency:     169ms                                   │
│ Gossip rate:     0.4 msg/s                              │
│ Bandwidth:       856 bytes/s                            │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ 1 hour (602s - continued sim)                           │
├──────────────────────────────────────────────────────────┤
│ Active nodes:    2003/2003 (1903 established)           │
│ Avg neighbors:   4.8                                     │
│ Network coverage: 100% (T: 8225)                        │
│ Avg latency:     223ms                                   │
│ Gossip rate:     0.2 msg/s                              │
│ Bandwidth:       396 bytes/s                            │
└──────────────────────────────────────────────────────────┘
```

The network continuously improves its topology, approaching theoretical maximum entropy.

## Anti-Sybil Protection

### Proof of Work Identity

Nodes must solve an Argon2id puzzle to generate valid identities:
- Configurable difficulty (0-10+)
- Memory-hard algorithm prevents ASIC optimization
- Cost scales exponentially with security requirements
- IDs are hex-encoded for simplicity (no complex base64 needed)

### Intelligent Rate Limiting

The Arbiter class manages peer reputation:
- Automatic ban for flooding behavior
- Trust scoring system
- Optional ban propagation with cryptographic proof

## Architecture

### Core Components (~1890 lines of code)

```
hive-p2p/core/
├── node.mjs         (160) - Main entry point & orchestration
├── config.mjs       (211) - Global configuration
├── crypto-codex.mjs (240) - Identity, serialization, signatures
├── peer-store.mjs   (227) - Connection & topology management
├── gossip.mjs       (141) - Broadcast messaging
├── unicast.mjs      (138) - Direct messaging & routing
├── topologist.mjs   (227) - Connection optimization
├── arbiter.mjs      (112) - Security & rate limiting
├── node-services.mjs(118) - WebSocket/STUN servers
├── ice-offer-manager.mjs(161) - WebRTC offer handling
└── route-builder.mjs(155) - BFS pathfinding

Total: 1890 lines of pure P2P logic
```

## Configuration

Key parameters in `config.mjs`:

```javascript
DISCOVERY: {
  TARGET_NEIGHBORS_COUNT: 5,  // Optimal: 4-8
  PEER_LINK_DELAY: 10_000,    // Connection sharing interval
  LOOP_DELAY: 2_500            // Topology optimization frequency
}

GOSSIP: {
  HOPS: { default: 20 },       // Message propagation depth
  TRANSMISSION_RATE: { ... }   // Adaptive forwarding
}

IDENTITY: {
  DIFFICULTY: 7,               // PoW difficulty (0=disabled)
  ARE_IDS_HEX: true           // Hex for simplicity
}
```

## Use Cases

### Decentralized Applications
- Censorship-resistant messaging
- Distributed storage networks
- P2P content delivery
- Decentralized social networks

### Blockchain Networks
- Transaction propagation layer
- Mempool synchronization
- Block distribution
- Light client support

### Real-time Systems
- Multiplayer gaming infrastructure
- Collaborative editing
- Live streaming mesh networks
- IoT device coordination

## Performance

Tested with up to 5000 simultaneous nodes:
- **Memory:** ~10MB for complete network map (100k peers)
- **CPU:** Raspberry Pi compatible  
- **Bandwidth:** ~1KB/s baseline overhead
- **Convergence:** 50% discovery within minutes

## Development

### Run Simulation

```bash
git clone https://github.com/Seigneur-Machiavel/hive-p2p
cd hive-p2p
npm install
npm run simulation
```

### Browser Development

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module">
    import * as HiveP2P from './browser-min/hive-p2p.min.js';
    const node = new HiveP2P.Node();
    // Your code here
  </script>
</head>
</html>
```

## Roadmap

### Completed ✅
- Core protocol implementation
- WebRTC + WebSocket transports
- Anti-sybil PoW (Argon2)
- Bloom filter optimization
- npm packages release
- Clock synchronization
- Bidirectional connection confirmation
- Arbiter security system

### In Progress 🔧
- Production testing
- Real-world deployment
- Documentation improvements

### Under Consideration 🤔
- Performance optimizations
- Additional transport protocols
- Extended security features

## Contributing

The protocol is young and full of possibilities. We're focusing on:
- Documentation and tutorials
- Real-world testing
- Building example applications
- Performance benchmarking

Check our [contribution guide](CONTRIBUTING.md) to get started.

## Philosophy

> "Complexity emerges from organized simplicity, not from complication."

HiveP2P embodies this principle - simple components (gossip, routing, topology awareness) combine to create a complex, self-organizing system that surpasses traditional approaches.

## License

GNU General Public License v3.0 - See [LICENSE](LICENSE) for details.

## Links

- **Repository:** [github.com/Seigneur-Machiavel/hive-p2p](https://github.com/Seigneur-Machiavel/hive-p2p)
- **NPM:** [npmjs.com/package/hive-p2p](https://www.npmjs.com/package/hive-p2p)
- **Stats:** [ghloc.vercel.app/Seigneur-Machiavel/hive-p2p](https://ghloc.vercel.app/Seigneur-Machiavel/hive-p2p?branch=main)

---

*HiveP2P - Because the internet deserves better than client-server*