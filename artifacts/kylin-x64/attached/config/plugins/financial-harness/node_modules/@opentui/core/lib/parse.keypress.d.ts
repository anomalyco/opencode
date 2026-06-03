import { Buffer } from "node:buffer";
export declare const nonAlphanumericKeys: string[];
export type KeyEventType = "press" | "repeat" | "release";
export interface ParsedKey {
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
}
export type ParseKeypressOptions = {
    useKittyKeyboard?: boolean;
};
export declare const parseKeypress: (s?: Buffer | string, options?: ParseKeypressOptions) => ParsedKey | null;
