import { EventEmitter } from "events";
import { type KeyEventType, type ParsedKey } from "./parse.keypress.js";
import type { PasteMetadata } from "./paste.js";
export declare class KeyEvent implements ParsedKey {
    name: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    option: boolean;
    sequence: string;
    number: boolean;
    raw: string;
    eventType: KeyEventType;
    source: "raw" | "kitty";
    code?: string;
    super?: boolean;
    hyper?: boolean;
    capsLock?: boolean;
    numLock?: boolean;
    baseCode?: number;
    repeated?: boolean;
    private _defaultPrevented;
    private _propagationStopped;
    constructor(key: ParsedKey);
    get defaultPrevented(): boolean;
    get propagationStopped(): boolean;
    preventDefault(): void;
    stopPropagation(): void;
}
export declare class PasteEvent {
    type: "paste";
    bytes: Uint8Array;
    metadata?: PasteMetadata;
    private _defaultPrevented;
    private _propagationStopped;
    constructor(bytes: Uint8Array, metadata?: PasteMetadata);
    get defaultPrevented(): boolean;
    get propagationStopped(): boolean;
    preventDefault(): void;
    stopPropagation(): void;
}
export type KeyHandlerEventMap = {
    keypress: [KeyEvent];
    keyrelease: [KeyEvent];
    paste: [PasteEvent];
};
export declare class KeyHandler extends EventEmitter<KeyHandlerEventMap> {
    processParsedKey(parsedKey: ParsedKey): boolean;
    processPaste(bytes: Uint8Array, metadata?: PasteMetadata): void;
}
/**
 * This class is used internally by the renderer to ensure global handlers
 * can preventDefault before renderable handlers process events.
 */
export declare class InternalKeyHandler extends KeyHandler {
    private renderableHandlers;
    emit<K extends keyof KeyHandlerEventMap>(event: K, ...args: KeyHandlerEventMap[K]): boolean;
    private emitWithPriority;
    onInternal<K extends keyof KeyHandlerEventMap>(event: K, handler: (...args: KeyHandlerEventMap[K]) => void): void;
    offInternal<K extends keyof KeyHandlerEventMap>(event: K, handler: (...args: KeyHandlerEventMap[K]) => void): void;
}
