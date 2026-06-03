export declare class RGBA {
    buffer: Float32Array;
    constructor(buffer: Float32Array);
    static fromArray(array: Float32Array): RGBA;
    static fromValues(r: number, g: number, b: number, a?: number): RGBA;
    static fromInts(r: number, g: number, b: number, a?: number): RGBA;
    static fromHex(hex: string): RGBA;
    toInts(): [number, number, number, number];
    get r(): number;
    set r(value: number);
    get g(): number;
    set g(value: number);
    get b(): number;
    set b(value: number);
    get a(): number;
    set a(value: number);
    map<R>(fn: (value: number) => R): R[];
    toString(): string;
    equals(other?: RGBA): boolean;
}
export type ColorInput = string | RGBA;
export declare function hexToRgb(hex: string): RGBA;
export declare function rgbToHex(rgb: RGBA): string;
export declare function hsvToRgb(h: number, s: number, v: number): RGBA;
export declare function parseColor(color: ColorInput): RGBA;
