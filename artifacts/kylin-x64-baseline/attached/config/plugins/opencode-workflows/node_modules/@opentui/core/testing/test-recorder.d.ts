import type { TestRenderer } from "./test-renderer.js";
export interface RecordBuffersOptions {
    fg?: boolean;
    bg?: boolean;
    attributes?: boolean;
}
export interface RecordedBuffers {
    fg?: Uint16Array;
    bg?: Uint16Array;
    attributes?: Uint8Array;
}
export interface RecordedFrame {
    frame: string;
    timestamp: number;
    frameNumber: number;
    buffers?: RecordedBuffers;
}
export interface TestRecorderOptions {
    recordBuffers?: RecordBuffersOptions;
    now?: () => number;
}
/**
 * TestRecorder records frames from a TestRenderer by listening to rendered frame events.
 * It captures the character frame after each native render pass.
 */
export declare class TestRecorder {
    private renderer;
    private frames;
    private recording;
    private frameNumber;
    private startTime;
    private decoder;
    private recordBuffers;
    private now;
    private readonly onFrame;
    constructor(renderer: TestRenderer, options?: TestRecorderOptions);
    /**
     * Start recording frames.
     */
    rec(): void;
    /**
     * Stop recording frames.
     */
    stop(): void;
    /**
     * Get the recorded frames.
     */
    get recordedFrames(): RecordedFrame[];
    /**
     * Clear all recorded frames.
     */
    clear(): void;
    /**
     * Check if currently recording.
     */
    get isRecording(): boolean;
    /**
     * Capture the current frame from the renderer's buffer.
     */
    private captureFrame;
}
