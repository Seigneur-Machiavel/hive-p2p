# contrast_p2p

Before start:
npm i

Une simple implémentation de P2P basée sur WebtRTC et Websocket, dédiée à remplacer LibP2P dans le projet de Blockchain Constrat.
Vise un ultra simplification en adoption une approche globale de la discovery à l'inverse du "DHT".

Using th e global discovery approach we can visualize the discovered network in real time, the project includes a front for this.
Also, a simulator can be used to generate an entire P2P (faster using the included "fake WS" and "Fake SimplePeer(Wtrc)"), then we are able to watch the network in real time for the POV of any nodes.


To improve rendering performance we apply some rules:


--- LOD on connections lines
--> neighbors (12max)
--> hoveredNeighbors (12max)
--> neighborsNeighbors (144max)
--> TODO? hoveredNeighborsNeighbors (144max)