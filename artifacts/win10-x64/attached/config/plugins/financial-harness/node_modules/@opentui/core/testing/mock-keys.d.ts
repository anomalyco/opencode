import type { CliRenderer } from "../renderer.js";
export declare function pasteBytes(text: string): Uint8Array;
export declare const KeyCodes: {
    readonly RETURN: "\r";
    readonly LINEFEED: "\n";
    readonly TAB: "\t";
    readonly BACKSPACE: "\b";
    readonly DELETE: "\u001B[3~";
    readonly HOME: "\u001B[H";
    readonly END: "\u001B[F";
    readonly ESCAPE: "\u001B";
    readonly ARROW_UP: "\u001B[A";
    readonly ARROW_DOWN: "\u001B[B";
    readonly ARROW_RIGHT: "\u001B[C";
    readonly ARROW_LEFT: "\u001B[D";
    readonly F1: "\u001BOP";
    readonly F2: "\u001BOQ";
    readonly F3: "\u001BOR";
    readonly F4: "\u001BOS";
    readonly F5: "\u001B[15~";
    readonly F6: "\u001B[17~";
    readonly F7: "\u001B[18~";
    readonly F8: "\u001B[19~";
    readonly F9: "\u001B[20~";
    readonly F10: "\u001B[21~";
    readonly F11: "\u001B[23~";
    readonly F12: "\u001B[24~";
};
export type KeyInput = string | keyof typeof KeyCodes;
export interface MockKeysOptions {
    kittyKeyboard?: boolean;
    otherModifiersMode?: boolean;
}
export declare function createMockKeys(renderer: CliRenderer, options?: MockKeysOptions): {
    pressKeys: (keys: KeyInput[], delayMs?: number) => Promise<void>;
    pressKey: (key: KeyInput, modifiers?: {
        shift?: boolean;
        ctrl?: boolean;
        meta?: boolean;
        super?: boolean;
        hyper?: boolean;
    }) => void;
    typeText: (text: string, delayMs?: number) => Promise<void>;
    pressEnter: (modifiers?: {
        shift?: boolean;
        ctrl?: boolean;
        meta?: boolean;
        super?: boolean;
        hyper?: boolean;
    }) => void;
    pressEscape: (modifiers?: {
        shift?: boolean;
        ctrl?: boolean;
        meta?: boolean;
        super?: boolean;
        hyper?: boolean;
    }) => void;
    pressTab: (modifiers?: {
        shift?: boolean;
        ctrl?: boolean;
        meta?: boolean;
        super?: boolean;
        hyper?: boolean;
    }) => void;
    pressBackspace: (modifiers?: {
        shift?: boolean;
        ctrl?: boolean;
        meta?: boolean;
        super?: boolean;
        hyper?: boolean;
    }) => void;
    pressArrow: (direction: "up" | "down" | "left" | "right", modifiers?: {
        shift?: boolean;
        ctrl?: boolean;
        meta?: boolean;
        super?: boolean;
        hyper?: boolean;
    }) => void;
    pressCtrlC: () => void;
    pasteBracketedText: (text: string) => Promise<void>;
};
