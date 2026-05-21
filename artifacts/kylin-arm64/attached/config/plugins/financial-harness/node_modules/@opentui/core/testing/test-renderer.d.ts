import { CliRenderer, type CliRendererConfig } from "../renderer.js";
import { createMockKeys } from "./mock-keys.js";
import { createMockMouse } from "./mock-mouse.js";
import type { CapturedFrame } from "../types.js";
export interface TestRendererOptions extends CliRendererConfig {
    width?: number;
    height?: number;
    kittyKeyboard?: boolean;
    otherModifiersMode?: boolean;
}
export interface TestRenderer extends CliRenderer {
}
export type MockInput = ReturnType<typeof createMockKeys>;
export type MockMouse = ReturnType<typeof createMockMouse>;
export declare function createTestRenderer(options: TestRendererOptions): Promise<{
    renderer: TestRenderer;
    mockInput: MockInput;
    mockMouse: MockMouse;
    renderOnce: () => Promise<void>;
    captureCharFrame: () => string;
    captureSpans: () => CapturedFrame;
    resize: (width: number, height: number) => void;
}>;
