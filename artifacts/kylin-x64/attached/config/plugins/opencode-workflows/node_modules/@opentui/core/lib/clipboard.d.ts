import type { RendererHandle, RenderLib } from "../zig.js";
export declare enum ClipboardTarget {
    Clipboard = 0,
    Primary = 1,
    Select = 2,
    Secondary = 3
}
export declare class Clipboard {
    private lib;
    private rendererPtr;
    constructor(lib: RenderLib, rendererPtr: RendererHandle);
    copyToClipboardOSC52(text: string, target?: ClipboardTarget): boolean;
    clearClipboardOSC52(target?: ClipboardTarget): boolean;
    isOsc52Supported(): boolean;
}
