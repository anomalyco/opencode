export type RGBTriplet = readonly [number, number, number];
export type ColorIntent = "rgb" | "indexed" | "default";
export type ColorInput = string | RGBA;
export declare const DEFAULT_FOREGROUND_RGB: RGBTriplet;
export declare const DEFAULT_BACKGROUND_RGB: RGBTriplet;
export interface NormalizedColorValue {
    rgba: RGBA;
}
export declare function normalizeIndexedColorIndex(index: number): number;
export declare function ansi256IndexToRgb(index: number): RGBTriplet;
export declare class RGBA {
    buffer: Uint16Array;
    constructor(buffer: Uint16Array);
    static fromArray(array: Uint16Array): RGBA;
    static fromValues(r: number, g: number, b: number, a?: number): RGBA;
    static clone(rgba: RGBA): RGBA;
    static fromInts(r: number, g: number, b: number, a?: number): RGBA;
    static fromHex(hex: string): RGBA;
    static fromIndex(index: number, snapshot?: ColorInput): RGBA;
    static defaultForeground(snapshot?: ColorInput): RGBA;
    static defaultBackground(snapshot?: ColorInput): RGBA;
    toInts(): [number, number, number, number];
    get r(): number;
    set r(value: number);
    get g(): number;
    set g(value: number);
    get b(): number;
    set b(value: number);
    get a(): number;
    set a(value: number);
    get meta(): number;
    get intent(): ColorIntent;
    get slot(): number;
    map<R>(fn: (value: number) => R): [R, R, R, R];
    toString(): string;
    equals(other?: RGBA): boolean;
}
export declare function normalizeColorValue(value: ColorInput | null | undefined): NormalizedColorValue | null;
export declare function hexToRgb(hex: string): RGBA;
export declare function rgbToHex(rgb: RGBA): string;
export declare function hsvToRgb(h: number, s: number, v: number): RGBA;
export declare function parseColor(color: ColorInput): RGBA;
