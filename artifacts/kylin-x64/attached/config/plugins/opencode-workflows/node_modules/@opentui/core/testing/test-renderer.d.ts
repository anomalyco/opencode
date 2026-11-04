import { CliRenderer, type CliRendererConfig } from "../renderer.js";
import type { NativeRenderStats } from "../zig.js";
import { createMockKeys } from "./mock-keys.js";
import { createMockMouse } from "./mock-mouse.js";
import type { CapturedFrame } from "../types.js";
export interface TestRendererOptions extends CliRendererConfig {
    width?: number;
    height?: number;
    kittyKeyboard?: boolean;
    otherModifiersMode?: boolean;
}
export type TestRenderer = CliRenderer;
export type MockInput = ReturnType<typeof createMockKeys>;
export type MockMouse = ReturnType<typeof createMockMouse>;
export interface TestFlushOptions {
    maxPasses?: number;
}
export interface TestVisualIdleOptions {
    quietFrames?: number;
    maxFrames?: number;
}
export interface TestWaitForOptions {
    maxPasses?: number;
}
export interface TestExternalOutputCommit {
    text: string;
    rows: string[];
    width: number;
    height: number;
    rowColumns: number;
    startOnNewLine: boolean;
    trailingNewline: boolean;
}
export interface TestExternalOutput {
    take(): TestExternalOutputCommit[];
    takeText(): string;
    clear(): void;
}
export interface TestRendererSetup {
    renderer: TestRenderer;
    mockInput: MockInput;
    mockMouse: MockMouse;
    renderOnce: () => Promise<void>;
    flush: (options?: TestFlushOptions) => Promise<void>;
    waitFor: (predicate: () => boolean | Promise<boolean>, options?: TestWaitForOptions) => Promise<void>;
    waitForFrame: (predicate: (frame: string) => boolean | Promise<boolean>, options?: TestWaitForOptions) => Promise<string>;
    waitForVisualIdle: (options?: TestVisualIdleOptions) => Promise<void>;
    externalOutput: TestExternalOutput;
    getNativeStats: () => NativeRenderStats;
    captureCharFrame: () => string;
    captureSpans: () => CapturedFrame;
    resize: (width: number, height: number) => void;
}
export declare function createTestRenderer(options: TestRendererOptions): Promise<TestRendererSetup>;
