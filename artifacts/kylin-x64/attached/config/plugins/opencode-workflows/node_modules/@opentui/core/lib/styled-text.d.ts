import type { TextChunk } from "../text-buffer.js";
import { type ColorInput } from "./RGBA.js";
declare const BrandedStyledText: unique symbol;
export type Color = ColorInput;
export interface StyleAttrs {
    fg?: Color;
    bg?: Color;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    dim?: boolean;
    reverse?: boolean;
    blink?: boolean;
}
export declare function isStyledText(obj: any): obj is StyledText;
export declare class StyledText {
    [BrandedStyledText]: boolean;
    chunks: TextChunk[];
    constructor(chunks: TextChunk[]);
}
export declare function stringToStyledText(content: string): StyledText;
export type StylableInput = string | number | boolean | TextChunk;
export declare const black: (input: StylableInput) => TextChunk;
export declare const red: (input: StylableInput) => TextChunk;
export declare const green: (input: StylableInput) => TextChunk;
export declare const yellow: (input: StylableInput) => TextChunk;
export declare const blue: (input: StylableInput) => TextChunk;
export declare const magenta: (input: StylableInput) => TextChunk;
export declare const cyan: (input: StylableInput) => TextChunk;
export declare const white: (input: StylableInput) => TextChunk;
export declare const brightBlack: (input: StylableInput) => TextChunk;
export declare const brightRed: (input: StylableInput) => TextChunk;
export declare const brightGreen: (input: StylableInput) => TextChunk;
export declare const brightYellow: (input: StylableInput) => TextChunk;
export declare const brightBlue: (input: StylableInput) => TextChunk;
export declare const brightMagenta: (input: StylableInput) => TextChunk;
export declare const brightCyan: (input: StylableInput) => TextChunk;
export declare const brightWhite: (input: StylableInput) => TextChunk;
export declare const bgBlack: (input: StylableInput) => TextChunk;
export declare const bgRed: (input: StylableInput) => TextChunk;
export declare const bgGreen: (input: StylableInput) => TextChunk;
export declare const bgYellow: (input: StylableInput) => TextChunk;
export declare const bgBlue: (input: StylableInput) => TextChunk;
export declare const bgMagenta: (input: StylableInput) => TextChunk;
export declare const bgCyan: (input: StylableInput) => TextChunk;
export declare const bgWhite: (input: StylableInput) => TextChunk;
export declare const bold: (input: StylableInput) => TextChunk;
export declare const italic: (input: StylableInput) => TextChunk;
export declare const underline: (input: StylableInput) => TextChunk;
export declare const strikethrough: (input: StylableInput) => TextChunk;
export declare const dim: (input: StylableInput) => TextChunk;
export declare const reverse: (input: StylableInput) => TextChunk;
export declare const blink: (input: StylableInput) => TextChunk;
export declare const fg: (color: Color) => (input: StylableInput) => TextChunk;
export declare const bg: (color: Color) => (input: StylableInput) => TextChunk;
export declare const link: (url: string) => (input: StylableInput) => TextChunk;
/**
 * Template literal handler for styled text (non-cached version).
 * Returns a StyledText object containing chunks of text with optional styles.
 */
export declare function t(strings: TemplateStringsArray, ...values: StylableInput[]): StyledText;
export {};
