import type { CliRenderer } from "../renderer.js";
export declare const MouseButtons: {
    readonly LEFT: 0;
    readonly MIDDLE: 1;
    readonly RIGHT: 2;
    readonly WHEEL_UP: 64;
    readonly WHEEL_DOWN: 65;
    readonly WHEEL_LEFT: 66;
    readonly WHEEL_RIGHT: 67;
};
export type MouseButton = (typeof MouseButtons)[keyof typeof MouseButtons];
export interface MousePosition {
    x: number;
    y: number;
}
export interface MouseModifiers {
    shift?: boolean;
    alt?: boolean;
    ctrl?: boolean;
}
export type MouseEventType = "down" | "up" | "move" | "drag" | "scroll";
export interface MouseEventOptions {
    button?: MouseButton;
    modifiers?: MouseModifiers;
    delayMs?: number;
}
export declare function createMockMouse(renderer: CliRenderer): {
    moveTo: (x: number, y: number, options?: MouseEventOptions) => Promise<void>;
    click: (x: number, y: number, button?: MouseButton, options?: MouseEventOptions) => Promise<void>;
    doubleClick: (x: number, y: number, button?: MouseButton, options?: MouseEventOptions) => Promise<void>;
    pressDown: (x: number, y: number, button?: MouseButton, options?: MouseEventOptions) => Promise<void>;
    release: (x: number, y: number, button?: MouseButton, options?: MouseEventOptions) => Promise<void>;
    drag: (startX: number, startY: number, endX: number, endY: number, button?: MouseButton, options?: MouseEventOptions) => Promise<void>;
    scroll: (x: number, y: number, direction: "up" | "down" | "left" | "right", options?: MouseEventOptions) => Promise<void>;
    getCurrentPosition: () => MousePosition;
    getPressedButtons: () => MouseButton[];
    emitMouseEvent: (type: MouseEventType, x: number, y: number, button?: MouseButton, options?: Omit<MouseEventOptions, "button">) => Promise<void>;
};
