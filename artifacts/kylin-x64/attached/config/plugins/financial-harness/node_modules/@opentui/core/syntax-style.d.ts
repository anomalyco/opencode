import { RGBA, type ColorInput } from "./lib/RGBA.js";
import { type RenderLib } from "./zig.js";
import { type Pointer } from "bun:ffi";
export interface StyleDefinition {
    fg?: RGBA;
    bg?: RGBA;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    dim?: boolean;
}
export interface MergedStyle {
    fg?: RGBA;
    bg?: RGBA;
    attributes: number;
}
export interface ThemeTokenStyle {
    scope: string[];
    style: {
        foreground?: ColorInput;
        background?: ColorInput;
        bold?: boolean;
        italic?: boolean;
        underline?: boolean;
        dim?: boolean;
    };
}
export declare function convertThemeToStyles(theme: ThemeTokenStyle[]): Record<string, StyleDefinition>;
export declare class SyntaxStyle {
    private lib;
    private stylePtr;
    private _destroyed;
    private nameCache;
    private styleDefs;
    private mergedCache;
    constructor(lib: RenderLib, ptr: Pointer);
    static create(): SyntaxStyle;
    static fromTheme(theme: ThemeTokenStyle[]): SyntaxStyle;
    static fromStyles(styles: Record<string, StyleDefinition>): SyntaxStyle;
    private guard;
    registerStyle(name: string, style: StyleDefinition): number;
    resolveStyleId(name: string): number | null;
    getStyleId(name: string): number | null;
    get ptr(): Pointer;
    getStyleCount(): number;
    clearNameCache(): void;
    getStyle(name: string): StyleDefinition | undefined;
    mergeStyles(...styleNames: string[]): MergedStyle;
    clearCache(): void;
    getCacheSize(): number;
    getAllStyles(): Map<string, StyleDefinition>;
    getRegisteredNames(): string[];
    destroy(): void;
}
