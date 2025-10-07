export function CLOCK_TEST(): Promise<void>;
/**
 * Synchronized Network Clock
 * Simple, efficient NTP-based time synchronization
 */
export class Clock {
    static "__#private@#instance": any;
    static get instance(): any;
    static get time(): any;
    constructor(verbose?: number, mockMode?: boolean);
    verbose: number;
    mockMode: boolean;
    get time(): number;
    sync(verbose: any): Promise<number>;
    get status(): {
        synchronized: boolean;
        syncing: boolean;
        offset: any;
        lastSync: number;
        age: number;
    };
    #private;
}
export const CLOCK: any;
