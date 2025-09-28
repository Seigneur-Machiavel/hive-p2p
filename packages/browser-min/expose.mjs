(async () => {
    const HiveP2P = await import('./hive-p2p.min.js');
    window.HiveP2P = HiveP2P;
    
    // Event pour signaler que c'est prêt
    window.dispatchEvent(new CustomEvent('hive-p2p-ready'));
})();