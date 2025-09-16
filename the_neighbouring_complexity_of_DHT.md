# Théorie mathématique des réseaux P2P et small-world networks

La théorie des réseaux complexes offre des formules précises pour optimiser les topologies P2P selon le nombre de peers et connexions par nœud. Les modèles de Watts-Strogatz et Erdős-Rényi, combinés aux algorithmes DHT modernes, permettent de calculer mathématiquement le diamètre optimal et la robustesse des réseaux distribués.

## Formules fondamentales de Watts-Strogatz

Le modèle de **Watts-Strogatz** etablit la relation exacte entre le nombre de peers **N**, les connexions par peer **k**, et le diamètre du réseau **L(p)** selon la probabilité de rewiring **p**.

**Diamètre selon la topologie :**
- Réseau régulier (p = 0) : `L(0) ≈ N/2k`
- Réseau aléatoire (p = 1) : `L(1) ≈ ln(N)/ln(k)`
- Zone optimale small-world : `p ∈ [0.01, 0.1]`

**Coefficient de clustering :**
- Réseau régulier : `C(0) = 3(k-1)/2(2k-1) → 3/4` quand k >> 1
- Réseau aléatoire : `C(1) ≈ k/N << 1`

La **propriété small-world critique** survient quand C(p) ≈ C(0) mais L(p) << L(0), créant des réseaux avec clustering local élevé et diamètre global court.

## Seuils de connectivité et robustesse

### Critère de Molloy-Reed pour la connectivité

**Condition fondamentale** pour l'existence d'une composante géante :
```
κ = ⟨k²⟩/⟨k⟩ > 2
```

**Seuil critique de percolation :**
```
fc = 1 - 1/(κ - 1) = 1 - ⟨k⟩/(⟨k²⟩ - ⟨k⟩)
```

### Modèle d'Erdős-Rényi pour les graphes aléatoires

**Seuil de connectivité :** Pour une probabilité p = λ log(n)/n
- Si λ < 1 : P(connectivité) → 0
- Si λ > 1 : P(connectivité) → 1

**Formule précise de connectivité :** Pour p = (log n + c)/n
```
P(connecté) → e^(-e^(-c)) quand n → ∞
```

**Diamètre des graphes aléatoires :**
```
h ≈ log(N)/log(⟨k⟩) = log(N)/log(p(N-1))
```

## Optimisation des réseaux P2P et DHT

### Complexités des DHT optimisés

**Chord :** O(log N) sauts, O(log N) connexions, log₂(N)/2 sauts moyens

**Kademlia :** O(log_b N) sauts, k = 20 optimal pour la résistance aux pannes, distance XOR d(x,y) = x ⊕ y

**Pastry :** O(log_2b N) sauts avec b = 4 comme compromis optimal

### Formule d'optimisation du nombre de connexions

**Trade-off fondamental :**
```
k_optimal = arg min[α × k + β × log_k(N)]
```
Où :
- α = coût de maintenance par connexion
- β = coût de latence par saut

**Seuil de connectivité minimal :**
```
k_min = log(N) + ω(log(N))
```

**Loi de compromis degré/diamètre :**
```
Degré × Diamètre ≥ Ω(log N)
```

## Relations empiriques des réseaux réels

### Validation par les données Facebook

**Diamètre effectif** : 4.74 (sur 721M utilisateurs), confirmant les "six degrés de séparation"
- 92% des paires connectées en ≤5 sauts
- 99.91% dans un seul composant géant
- Coefficient de clustering élevé localement

### Topologies P2P observées

**Gnutella :** Distribution P(k) ∝ k^(-2.4), évolution temporelle significative, architecture mesh + forest

**BitTorrent :** Power-law avec coupure exponentielle, 74.6% des torrents < 1000 peers

**Internet AS :** P(k) ∝ k^(-2.2), diamètre 3.4, clustering C ≈ 0.3

## Formules pratiques pour l'implémentation

### Calcul du diamètre optimal

**Pour small-world networks :**
```javascript
function calculerDiametre(N, k, p) {
  if (p === 0) return N / (2 * k);
  if (p === 1) return Math.log(N) / Math.log(k);
  // Interpolation pour 0 < p < 1
  let L0 = N / (2 * k);
  let L1 = Math.log(N) / Math.log(k);
  return L0 * Math.exp(-p * Math.log(L0/L1));
}
```

### Probabilité de connectivité

**Selon le modèle d'Erdős-Rényi :**
```javascript
function probabiliteConnectivite(N, k) {
  let lambda = k;
  if (lambda < 1) return 0;
  let c = lambda * Math.log(N) - Math.log(N);
  return Math.exp(-Math.exp(-c));
}
```

### Robustesse aux pannes

**Seuil critique de robustesse :**
```javascript
function seuilRobustesse(degreeDistribution) {
  let kMean = degreeDistribution.mean();
  let kSquaredMean = degreeDistribution.secondMoment();
  let kappa = kSquaredMean / kMean;
  return 1 - 1 / (kappa - 1);
}
```

## Paramètres optimaux par taille de réseau

### Réseaux petits (N < 1000)
- **Connexions par peer :** k = 8-12
- **Paramètre de parallélisme :** α = 3
- **Probabilité de rewiring :** p = 0.05
- **Rafraîchissement :** 10 minutes

### Réseaux moyens (1000 ≤ N ≤ 100000)  
- **Connexions par peer :** k = 12-20
- **Seuil critique :** k_min = log(N) + 3
- **Probabilité de rewiring :** p = 0.01
- **Structure hybride recommandée**

### Réseaux massifs (N > 100000)
- **Connexions par peer :** k = 20-25  
- **Architecture DHT :** Kademlia avec k = 20
- **Rafraîchissement adaptatif** basé sur le churn
- **Optimisation continue** des connexions

## Algorithmes d'optimisation adaptative

### Ajustement dynamique du degré

**Mise à jour des connexions :**
```javascript
function ajusterConnexions(k_actuel, latence_moyenne, cout_maintenance) {
  let gradient = calculerGradient(latence_moyenne, cout_maintenance);
  let eta = 0.01; // Taux d'apprentissage
  return k_actuel + eta * gradient;
}
```

### Sélection intelligente de pairs

**Score UCB pour Multi-Armed Bandit :**
```javascript
function calculerScoreUCB(peer, temps_total, interactions) {
  let mu = peer.performanceMoyenne;
  let n = interactions;
  let t = temps_total;
  return mu + Math.sqrt(2 * Math.log(t) / n);
}
```

## Conclusion : design optimal des réseaux P2P

Les formules de Watts-Strogatz et d'Erdős-Rényi offrent un cadre théorique solide pour l'optimisation des topologies P2P. La zone optimale se situe dans les **small-world networks** avec p ∈ [0.01, 0.1], permettant de minimiser le diamètre tout en préservant un clustering élevé. Les DHT modernes comme **Kademlia** implémentent efficacement ces principes avec k = 20 connexions optimales. L'approche adaptative combinant surveillance continue et ajustements algorithmiques permet d'atteindre l'efficacité théorique dans les conditions réelles de déploiement.