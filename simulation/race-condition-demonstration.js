/**
 * Race Condition Demonstration
 * 
 * This file demonstrates how concurrent modifications during callback execution
 * can corrupt data in asynchronous environments, leading to seemingly impossible
 * states like "peer not found in route" or "message from wrong sender".
 * 
 * The problem occurs when:
 * 1. Function A captures a reference to shared data
 * 2. An interval/timeout modifies that shared data 
 * 3. Function A continues executing with stale references
 * 
 * This is exactly what happens in our P2P simulation when:
 * - handleDirectMessage() captures 'from' from transportInstance.remoteId
 * - ICE intervals modify transportInstance.remoteId via linkInstances()
 * - Message processing continues with corrupted sender information
 */

class DataCorruptionDemo {
    // Shared data that gets modified by intervals
    connections = {
        'transport1': { remoteId: 'peer1', route: ['peer1', 'transport1', 'peer2'] },
        'transport2': { remoteId: 'peer2', route: ['peer2', 'transport2', 'peer3'] },
        'transport3': { remoteId: 'peer3', route: ['peer3', 'transport3', 'peer1'] }
    };
    
    corruptions = 0;
    totalProcessed = 0;

    constructor() {
        console.log('Starting race condition demo...\n');
        this.startCorruptingInterval();
        this.startMessageProcessing();
        
        // Stop after 5 seconds and show results
        setTimeout(() => this.showResults(), 5000);
    }

    // Simulates ICE intervals that modify connection data
    startCorruptingInterval() {
        setInterval(() => {
            const transportIds = Object.keys(this.connections);
            const randomTransport = transportIds[Math.floor(Math.random() * transportIds.length)];
            
            if (this.connections[randomTransport]) {
                // Simulate linkInstances() modifying remoteId during processing
                const newRemoteId = `corrupted_${Date.now()}`;
                this.connections[randomTransport].remoteId = newRemoteId;
            }
        }, 20); // Frequent modifications to increase corruption chances
    }

    // Simulates message processing like handleDirectMessage()
    startMessageProcessing() {
        setInterval(() => {
            this.processMessage();
        }, 10);
    }

    processMessage() {
        const transportIds = Object.keys(this.connections);
        const transportId = transportIds[Math.floor(Math.random() * transportIds.length)];
        const connection = this.connections[transportId];
        
        if (!connection) return;

        // STEP 1: Capture sender (like extracting 'from' parameter)
        const capturedSender = connection.remoteId;
        const route = [...connection.route]; // Copy route
        
        // STEP 2: Simulate callback delay (setImmediate, setTimeout, etc.)
        setImmediate(() => {
            this.validateMessage(transportId, capturedSender, route);
        });
    }

    validateMessage(transportId, capturedSender, route) {
        this.totalProcessed++;
        
        const connection = this.connections[transportId];
        if (!connection) return;
        
        // STEP 3: Check consistency (this is where corruption becomes visible)
        const currentSender = connection.remoteId;
        const selfPosition = route.indexOf(transportId);
        
        // Detect corruption type 1: Transport missing from route
        if (selfPosition === -1) {
            this.corruptions++;
            console.log(`CORRUPTION 1: Transport ${transportId} missing from route ${JSON.stringify(route)}`);
            return;
        }
        
        // Detect corruption type 2: Sender mismatch
        if (capturedSender !== currentSender) {
            this.corruptions++;
            console.log(`CORRUPTION 2: Expected sender ${capturedSender}, but current is ${currentSender} (transport: ${transportId})`);
            return;
        }
        
        // Detect corruption type 3: Route inconsistency
        const expectedSender = route[selfPosition - 1];
        if (expectedSender && expectedSender !== currentSender) {
            this.corruptions++;
            console.log(`CORRUPTION 3: Route expects sender ${expectedSender}, but got ${currentSender}`);
            return;
        }
    }

    showResults() {
        console.log('\n' + '='.repeat(50));
        console.log('RACE CONDITION DEMO RESULTS');
        console.log('='.repeat(50));
        console.log(`Messages processed: ${this.totalProcessed}`);
        console.log(`Corruptions detected: ${this.corruptions}`);
        console.log(`Corruption rate: ${(this.corruptions / this.totalProcessed * 100).toFixed(2)}%`);
        
        if (this.corruptions > 0) {
            console.log('\nRACE CONDITIONS CONFIRMED!');
            console.log('Concurrent modifications during callback execution create data corruption.');
            console.log('This explains "impossible" errors in P2P message routing.');
        } else {
            console.log('\nNo corruptions detected. Try increasing modification frequency.');
        }
        
        console.log('\nIn P2P simulation, this happens when:');
        console.log('- ICE intervals modify transportInstance.remoteId');
        console.log('- handleDirectMessage() processes with stale sender info');
        console.log('- Result: "peer not in route" or "wrong sender" errors');
        
        process.exit(0);
    }
}

// Run the demonstration
new DataCorruptionDemo();