import type { Pointer } from "bun:ffi";
import type { RenderLib } from "../zig.js";
export declare enum ClipboardTarget {
    Clipboard = 0,
    Primary = 1,
    Secondary = 2,
    Query = 3
}
export declare function encodeOsc52Payload(text: string, encoder?: TextEncoder): Uint8Array;
export declare class Clipboard {
    private lib;
    private rendererPtr;
    constructor(lib: RenderLib, rendererPtr: Pointer);
    copyToClipboardOSC52(text: string, target?: ClipboardTarget): boolean;
    clearClipboardOSC52(target?: ClipboardTarget): boolean;
    isOsc52Supported(): boolean;
}
