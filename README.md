[EN] (Scroll down to read [FR] version)

# P2P Network with Dynamic Global Mapping
## A New Paradigm for Decentralization

### Executive Summary

This document presents a novel peer-to-peer network approach that solves the entropy limitations of classical DHTs like Kademlia. By sharing connection events through gossip, each peer builds a global network map enabling optimal neighbor selection and maximum network uniformity.

---

## 1. The Problem with Current DHTs

### 1.1 Kademlia Limitations

Kademlia, used in BitTorrent, Ethereum, and IPFS, has a fundamental weakness: **it doesn't guarantee maximum entropy**. It's essentially "hoping things work out" with some heuristics.

**Identified problems:**
- **Geographic clustering**: physically close peers end up in the same buckets
- **Correlated failures**: power outages, software updates, shared vulnerabilities
- **Bootstrap bias**: new nodes often discover the same clusters
- **Blind neighborhood**: no visibility into global topology

### 1.2 Real-World Consequences

```
Ideal Kademlia network:    Real Kademlia network:
                          
    A---B---C                A---B---C
    |   |   |                |   |   |
    D---E---F                D---E---F
    |   |   |                 \  |  /
    G---H---I                  \ | /
                                \|/
                                 X
                            (isolated cluster)
```

Correlated failures can isolate entire network regions.

---

## 2. Our Solution: Global Mapping Through Gossip

### 2.1 Core Principle

**Simple idea:** If every peer knows who's connected to whom, it can choose neighbors to maximize network uniformity.

**Mechanism:**
1. Peers share their connection/disconnection events via gossip
2. Each peer builds its own network map
3. New neighbor selection based on minimal overlap
4. Network converges toward optimized topology

### 2.2 General Architecture

```
Peer A                    Peer B                    Peer C
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│ PeerStore   │◄────────►│ PeerStore   │◄────────►│ PeerStore   │
│ (map)       │   Gossip │ (map)       │   Gossip │ (map)       │
├─────────────┤          ├─────────────┤          ├─────────────┤
│ Neighbor    │          │ Neighbor    │          │ Neighbor    │
│ Selection   │          │ Selection   │          │ Selection   │
└─────────────┘          └─────────────┘          └─────────────┘
       │                        │                        │
       └────────────────────────┼────────────────────────┘
                    Direct Messages
                     (with routing)
```

---

## 3. Technical Components

### 3.1 PeerStore - The Global Map

**Minimalist structure:**
```js
knownPeers: {
  "peer123": {
    peerId: "peer123",           // 32 bytes
    neighbours: ["peer456", ...] // 12 IDs max × 32 bytes
  }
}
```

**Memory cost:** 416 bytes per known peer
**Capacity:** 100k peers = 41.6 MB (Raspberry Pi compatible)

### 3.2 Event Gossip

**Event messages:**
```js
{
  event: 'connect',
  peerId: 'ABC123',
  direction: 'in',      // 'in' = I accept, 'out' = I propose  
  timestamp: 1682345678
}
```

**Anti-spam filter:**
- Buffer of recent message hashes (few seconds)
- "I forward the message to neighbors only if absent from my buffer"
- No complex anti-flood, just non-repetition

**Propagation:**
- Based on six degrees of separation theory
- Configurable TTL to limit map size
- ~10 messages/second in steady state

### 3.3 Optimized Neighbor Selection

**Selection algorithm:**
1. Analyze potential connection candidates
2. Calculate overlap with current neighbors
3. Favor peers with minimal overlap
4. Maintain max 12 neighbors by default

```
Peer A wants to connect:
Current neighbors: [B, C, D]

Candidate X: neighbors [E, F, G] → overlap = 0 → EXCELLENT
Candidate Y: neighbors [B, C, H] → overlap = 2 → AVERAGE  
Candidate Z: neighbors [B, C, D] → overlap = 3 → POOR
```

### 3.4 Direct Messages with Routing

**Connection establishment:**
- SDP messages (WebRTC) relayed peer-to-peer
- Complete route specified by sender
- `enableReRouting` option: consumable flag for route optimization
- Failure tolerance: more lightweight messages rather than delivery guarantee

**Routing example:**
```
A wants to contact D:
Planned route: A → B → C → D
If C discovers shortcut A → C → E → D:
C can re-route ONCE with signature
```

---

## 4. Robustness Mechanisms

### 4.1 Correlated Failure Management

**Early detection:**
- Global map reveals partitions before they isolate the network
- Dynamic neighborhood adjustment based on detected threats

**Self-healing:**
- Adaptive neighborhood: a peer can temporarily exceed 12 neighbors
- Kick "problematic" neighbors if better candidates are discovered

### 4.2 Attack Resistance

**Against malicious peers:**
- Ban/ignore system for excessive or inconsistent info
- Hard-to-generate PubKey (PoW) to limit Sybil attacks
- Cross-validation of events ('in' + 'out' directions)

**Against pollution:**
- Timeout for bidirectional connection confirmation
- Preference for confirmed vs phantom connections

---

## 5. Advantages Over Existing Solutions

### 5.1 Vs Kademlia

| Aspect | Kademlia | Our Solution |
|--------|----------|--------------|
| **Network visibility** | Blind | Global map |
| **Neighbor selection** | XOR distance | Minimal overlap |
| **Correlated failures** | Vulnerable | Early detection |
| **Adaptability** | Static | Dynamic |
| **Memory cost** | ~200 peers | ~100k peers |

### 5.2 Observed Metrics

**Tests with 2500 peers:**
- **Convergence:** >50% discovery within minutes
- **Traffic:** ~10 messages/second steady state  
- **Memory:** <50 MB for complete map
- **CPU:** Raspberry Pi compatible (dual-core 1.5GHz)

---

## 6. Applications

### 6.1 Decentralized Blockchain

**Primary use case:** blockchain network with:
- Fair distribution (like Bitcoin, no fundraising)
- All nodes are "full" and equal
- PoW + PoS to stabilize blocktime (1-4 minutes)
- Optimized propagation of validated blocks

**Specific advantages:**
- **Eclipse resistance:** impossible to isolate a node
- **Smart propagation:** optimal route selection
- **Maximum decentralization:** greater than Bitcoin through uniformity

### 6.2 Other Applications

- **Decentralized CDN** with optimized routing
- **Censorship-resistant messaging**  
- **Distributed storage** with intelligent replication

---

## 7. Roadmap and Limitations

### 7.1 Current Limitations

**Dependencies:**
- External time service (NTP) for synchronization
- Bootstrap nodes for initial seeding

**Scalability:**
- Tested up to 2500 simultaneous peers
- Theoretical extrapolation to 100k+ peers

### 7.2 Planned Improvements

**Short term:**
- Bidirectional connection confirmation
- Timestamps for automatic garbage collection  
- Partition robustness testing

**Long term:**
- Distributed clock to eliminate NTP dependency
- Virtual zones for scaling
- Integrated network quality metrics

---

## 8. Conclusion

This P2P system represents a paradigm shift: moving from a blind network to a **topology-aware network**. Global mapping through gossip enables continuous optimization and unmatched resilience.

**Philosophy:** Each component is individually simple, but their synergy creates a complex and robust system. The "minimalist yet complementary" approach avoids over-engineering while solving fundamental DHT problems.

**Vision:** A decentralized internet where every node contributes to global network optimization, without central coordination or single points of failure.

---

*"Complexity emerges from organized simplicity, not from complication."*

[FR] ------------------------------------------------ [FR]

# Réseau P2P avec Cartographie Globale Dynamique
## Un nouveau paradigme pour la décentralisation

### Résumé Exécutif

Ce document présente une nouvelle approche des réseaux pair-à-pair qui résout les limitations d'entropie des DHT classiques comme Kademlia. En partageant les événements de connexion via gossip, chaque peer construit une carte globale du réseau permettant une sélection optimale des voisins et une maximisation de l'uniformité du réseau.

---

## 1. Le Problème des DHT Actuels

### 1.1 Limitations de Kademlia

Kademlia, utilisé dans BitTorrent, Ethereum et IPFS, présente une faiblesse fondamentale : **il n'offre pas d'entropie maximale garantie**. C'est du "on espère que ça se passe bien" avec quelques heuristiques.

**Problèmes identifiés :**
- **Clustering géographique** : peers physiquement proches finissent dans les mêmes buckets
- **Pannes corrélées** : coupures électriques, mises à jour, mêmes vulnérabilités logicielles
- **Biais de bootstrap** : nouveaux nœuds découvrent souvent les mêmes clusters
- **Voisinage aveugle** : aucune visibilité sur la topologie globale

### 1.2 Conséquences Pratiques

```
Réseau Kademlia idéal :    Réseau Kademlia réel :
                          
    A---B---C                A---B---C
    |   |   |                |   |   |
    D---E---F                D---E---F
    |   |   |                 \  |  /
    G---H---I                  \ | /
                                \|/
                                 X
                            (cluster isolé)
```

Les pannes corrélées peuvent isoler des zones entières du réseau.

---

## 2. Notre Solution : Cartographie Globale par Gossip

### 2.1 Principe Fondamental

**Idée simple :** Si chaque peer connaît qui est connecté à qui, il peut choisir ses voisins pour maximiser l'uniformité du réseau.

**Mécanisme :**
1. Les peers partagent leurs événements de connexion/déconnexion via gossip
2. Chaque peer construit sa propre carte du réseau  
3. La sélection de nouveaux voisins se base sur l'overlap minimal
4. Le réseau converge vers une topologie optimisée

### 2.2 Architecture Générale

```
Peer A                    Peer B                    Peer C
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│ PeerStore   │◄────────►│ PeerStore   │◄────────►│ PeerStore   │
│ (carte)     │   Gossip │ (carte)     │   Gossip │ (carte)     │
├─────────────┤          ├─────────────┤          ├─────────────┤
│ Neighbors   │          │ Neighbors   │          │ Neighbors   │
│ Selection   │          │ Selection   │          │ Selection   │
└─────────────┘          └─────────────┘          └─────────────┘
       │                        │                        │
       └────────────────────────┼────────────────────────┘
                    Messages Directs
                   (avec routage)
```

---

## 3. Composants Techniques

### 3.1 PeerStore - La Carte Globale

**Structure minimaliste :**
```js
knownPeers: {
  "peer123": {
    peerId: "peer123",           // 32 octets
    neighbours: ["peer456", ...] // 12 IDs max × 32 octets
  }
}
```

**Coût mémoire :** 416 octets par peer connu
**Capacité :** 100k peers = 41.6 Mo (compatible Raspberry Pi)

### 3.2 Gossip des Événements

**Messages d'événements :**
```js
{
  event: 'connect',
  peerId: 'ABC123',
  direction: 'in',      // 'in' = j'accepte, 'out' = je propose  
  timestamp: 1682345678
}
```

**Filtre anti-spam :**
- Tampon de hashes des messages récents (quelques secondes)
- "Je transmets le message à mes voisins que s'il est absent de mon tampon"
- Pas d'anti-flood complexe, juste la non-répétition

**Propagation :**
- Basée sur la théorie des 6 degrés de séparation
- TTL configurable pour limiter la taille de la carte
- ~10 messages/seconde en régime stable

### 3.3 Sélection de Voisins Optimisée

**Algorithme de sélection :**
1. Analyser les candidats potentiels de connexion
2. Calculer l'overlap avec les voisins actuels
3. Privilégier les peers avec overlap minimal
4. Maintenir un voisinage de 12 peers max par défaut

```
Peer A veut se connecter :
Voisins actuels : [B, C, D]

Candidat X : voisins [E, F, G] → overlap = 0 → EXCELLENT
Candidat Y : voisins [B, C, H] → overlap = 2 → MOYEN  
Candidat Z : voisins [B, C, D] → overlap = 3 → MAUVAIS
```

### 3.4 Messages Directs avec Routage

**Établissement de connexions :**
- Messages SDP (WebRTC) relayés de peer en peer
- Route complète spécifiée par l'expéditeur
- Option `enableReRouting` : flag consommable pour optimisation de route
- Tolérance aux échecs : plus de messages légers plutôt que garantie de livraison

**Exemple de routage :**
```
A veut contacter D :
Route prévue : A → B → C → D
Si C découvre un raccourci A → C → E → D :
C peut re-router UNE FOIS avec signature
```

---

## 4. Mécanismes de Robustesse

### 4.1 Gestion des Pannes Corrélées

**Détection précoce :**
- La carte globale révèle les partitions avant qu'elles n'isolent le réseau
- Ajustement dynamique du voisinage selon les menaces détectées

**Auto-guérison :**
- Voisinage adaptatif : un peer peut temporairement dépasser 12 voisins
- Kick des voisins "gênants" si de meilleurs candidats sont découverts

### 4.2 Résistance aux Attaques

**Contre les peers malveillants :**
- Système de ban/ignore pour infos excessives ou incohérentes
- PubKey difficile à générer (POW) pour limiter les Sybil
- Validation croisée des événements (direction 'in' + 'out')

**Contre la pollution :**
- Timeout pour confirmation bidirectionnelle des connexions
- Préférence pour les connexions confirmées vs fantômes

---

## 5. Avantages par Rapport aux Solutions Existantes

### 5.1 Vs Kademlia

| Aspect | Kademlia | Notre Solution |
|--------|----------|----------------|
| **Visibilité réseau** | Aveugle | Carte globale |
| **Sélection voisins** | Distance XOR | Overlap minimal |
| **Pannes corrélées** | Vulnérable | Détection précoce |
| **Adaptabilité** | Statique | Dynamique |
| **Coût mémoire** | ~200 peers | ~100k peers |

### 5.2 Métriques Observées

**Tests avec 2500 peers :**
- **Convergence :** >50% de discovery en quelques minutes
- **Trafic :** ~10 messages/seconde en régime stable  
- **Mémoire :** <50 Mo pour la carte complète
- **CPU :** Compatible Raspberry Pi (dual-core 1.5GHz)

---

## 6. Applications

### 6.1 Blockchain Décentralisée

**Cas d'usage principal :** réseau blockchain avec :
- Distribution équitable (comme Bitcoin, pas de levée de fonds)
- Tous les nœuds sont "complets" et égaux
- POW + POS pour stabiliser le blocktime (1-4 minutes)
- Propagation optimisée des blocs validés

**Avantages spécifiques :**
- **Résistance aux éclipses** : impossible d'isoler un nœud
- **Propagation intelligente** : choix de routes optimales
- **Décentralisation maximale** : plus grande que Bitcoin grâce à l'uniformité

### 6.2 Autres Applications

- **CDN décentralisé** avec routage optimisé
- **Messagerie résistante à la censure**  
- **Stockage distribué** avec réplication intelligente

---

## 7. Roadmap et Limitations

### 7.1 Limitations Actuelles

**Dépendances :**
- Service d'horloge externe (NTP) pour synchronisation
- Bootstrap nodes pour amorçage initial

**Scalabilité :**
- Testé jusqu'à 2500 peers simultanés
- Extrapolation théorique à 100k+ peers

### 7.2 Améliorations Prévues

**Court terme :**
- Confirmation bidirectionnelle des connexions
- Timestamps pour garbage collection automatique  
- Tests de robustesse aux partitions

**Long terme :**
- Horloge distribuée pour éliminer la dépendance NTP
- Zones virtuelles pour passage à l'échelle
- Métriques de qualité réseau intégrées

---

## 8. Conclusion

Ce système P2P représente un changement de paradigme : passer d'un réseau aveugle à un **réseau conscient** de sa propre topologie. La cartographie globale par gossip permet une optimisation continue et une résilience inégalée.

**Philosophie :** Chaque composant est simple individuellement, mais leur synergie crée un système complexe et robuste. L'approche "minimaliste mais complémentaire" évite la sur-ingénierie tout en résolvant les problèmes fondamentaux des DHT actuels.

**Vision :** Un internet décentralisé où chaque nœud contribue à l'optimisation globale du réseau, sans coordination centrale ni point de défaillance unique.

---

*"La complexité émerge de la simplicité organisée, pas de la complication."*
