export class Converter {
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to string */
    static bytesToHex(uint8Array: Uint8Array, minLength?: number): string;
    /** @param {string} hex - Hex string to convert to bits @param {'string' | 'arrayOfString' | 'arrayOfNumbers'} format - Output format, default: string */
    static hexToBits(hex?: string, format?: "string" | "arrayOfString" | "arrayOfNumbers"): string | (string | number)[];
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to bits @param {'string' | 'arrayOfString' | 'arrayOfNumbers'} format - Output format, default: string */
    static bytesToBits(uint8Array: Uint8Array, format?: "string" | "arrayOfString" | "arrayOfNumbers"): string | (string | number)[];
    static ipToInt(ip?: string): number;
    IS_BROWSER: boolean;
    FROMBASE64_AVAILABLE: boolean;
    textEncoder: TextEncoder;
    textDecoder: TextDecoder;
    buffer2: ArrayBuffer;
    view2: DataView<ArrayBuffer>;
    buffer4: ArrayBuffer;
    view4: DataView<ArrayBuffer>;
    buffer8: ArrayBuffer;
    view8: DataView<ArrayBuffer>;
    hexMap: {
        '0': number;
        '1': number;
        '2': number;
        '3': number;
        '4': number;
        '5': number;
        '6': number;
        '7': number;
        '8': number;
        '9': number;
        A: number;
        B: number;
        C: number;
        D: number;
        E: number;
        F: number;
        a: number;
        b: number;
        c: number;
        d: number;
        e: number;
        f: number;
    };
    /** Number should be between 0 and 65535 @param {number} num - Integer to convert to 2 bytes Uint8Array */
    numberTo2Bytes(num: number): Uint8Array<ArrayBuffer>;
    /** Number should be between 0 and 4294967295 @param {number} num - Integer to convert to 4 bytes Uint8Array */
    numberTo4Bytes(num: number): Uint8Array<ArrayBuffer>;
    /** Number should be between 0 and 18446744073709551615 @param {number} num - Integer to convert to 8 bytes Uint8Array */
    numberTo8Bytes(num: number): Uint8Array<ArrayBuffer>;
    stringToBytes(str?: string): Uint8Array<ArrayBuffer>;
    /** @param {string} hex - Hex string to convert to Uint8Array */
    hexToBytes(hex: string): Uint8Array<ArrayBuffer>;
    /** Base64 string to convert to Uint8Array @param {string} base64 @returns {Uint8Array} */
    base64toBytes(base64: string): Uint8Array;
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
    bytes2ToNumber(uint8Array: Uint8Array): number;
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
    bytes4ToNumber(uint8Array: Uint8Array): number;
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to number */
    bytes8ToNumber(uint8Array: Uint8Array): number;
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to string */
    bytesToString(uint8Array: Uint8Array): string;
    /** @param {Uint8Array} uint8Array - Uint8Array to convert to string */
    bytesToHex(uint8Array: Uint8Array, minLength?: number): string;
}
