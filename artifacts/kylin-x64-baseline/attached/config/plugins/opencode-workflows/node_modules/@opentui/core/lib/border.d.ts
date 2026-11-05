import type { ColorInput } from "./RGBA.js";
export interface BorderCharacters {
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
    horizontal: string;
    vertical: string;
    topT: string;
    bottomT: string;
    leftT: string;
    rightT: string;
    cross: string;
}
export type BorderStyle = "single" | "double" | "rounded" | "heavy";
export type BorderSides = "top" | "right" | "bottom" | "left";
export declare function isValidBorderStyle(value: unknown): value is BorderStyle;
export declare function parseBorderStyle(value: unknown, fallback?: BorderStyle): BorderStyle;
export declare const BorderChars: Record<BorderStyle, BorderCharacters>;
export interface BorderConfig {
    borderStyle: BorderStyle;
    border: boolean | BorderSides[];
    borderColor?: ColorInput;
    customBorderChars?: BorderCharacters;
}
export interface BoxDrawOptions {
    x: number;
    y: number;
    width: number;
    height: number;
    borderStyle: BorderStyle;
    border: boolean | BorderSides[];
    borderColor: ColorInput;
    customBorderChars?: BorderCharacters;
    backgroundColor: ColorInput;
    shouldFill?: boolean;
    title?: string;
    titleAlignment?: "left" | "center" | "right";
    bottomTitle?: string;
    bottomTitleAlignment?: "left" | "center" | "right";
}
export interface BorderSidesConfig {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
}
export declare function getBorderFromSides(sides: BorderSidesConfig): boolean | BorderSides[];
export declare function getBorderSides(border: boolean | BorderSides[]): BorderSidesConfig;
export declare function borderCharsToArray(chars: BorderCharacters): Uint32Array;
export declare const BorderCharArrays: Record<BorderStyle, Uint32Array>;
