import { RGBA } from "./RGBA.js";
import { type Clock } from "./clock.js";
type Hex = string | null;
export type WriteFunction = (data: string | Buffer) => boolean;
export interface TerminalColors {
    palette: Hex[];
    defaultForeground: Hex;
    defaultBackground: Hex;
    cursorColor: Hex;
    mouseForeground: Hex;
    mouseBackground: Hex;
    tekForeground: Hex;
    tekBackground: Hex;
    highlightBackground: Hex;
    highlightForeground: Hex;
}
export interface GetPaletteOptions {
    timeout?: number;
    size?: number;
}
export interface TerminalPaletteDetector {
    detect(options?: GetPaletteOptions): Promise<TerminalColors>;
    detectOSCSupport(timeoutMs?: number): Promise<boolean>;
    cleanup(): void;
}
export interface NormalizedTerminalPalette {
    palette: RGBA[];
    defaultForeground: RGBA;
    defaultBackground: RGBA;
}
export type OscSubscriptionSource = {
    subscribeOsc(handler: (sequence: string) => void): () => void;
};
export interface TerminalPaletteOptions {
    stdin: NodeJS.ReadStream;
    stdout: NodeJS.WriteStream;
    writeFn?: WriteFunction;
    isLegacyTmux?: boolean;
    isTmux?: boolean;
    oscSource?: OscSubscriptionSource;
    clock?: Clock;
}
export declare class TerminalPalette implements TerminalPaletteDetector {
    private stdin;
    private stdout;
    private writeFn;
    private activeQuerySessions;
    private inLegacyTmux;
    private inTmux;
    private oscSource?;
    private readonly clock;
    constructor(options: TerminalPaletteOptions);
    private writeOsc;
    cleanup(): void;
    private subscribeInput;
    private createQuerySession;
    detectOSCSupport(timeoutMs?: number): Promise<boolean>;
    private queryPalette;
    private querySpecialColors;
    detect(options?: GetPaletteOptions): Promise<TerminalColors>;
}
export declare function createTerminalPalette(options: TerminalPaletteOptions): TerminalPaletteDetector;
export declare function normalizeTerminalPalette(colors?: TerminalColors | null): NormalizedTerminalPalette;
export declare function buildTerminalPaletteSignature(colors?: TerminalColors | null): string;
export {};
