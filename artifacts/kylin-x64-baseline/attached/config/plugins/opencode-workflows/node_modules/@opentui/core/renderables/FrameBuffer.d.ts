import { type RenderableOptions, Renderable } from "../Renderable.js";
import { OptimizedBuffer } from "../buffer.js";
import type { RenderContext } from "../types.js";
export interface FrameBufferOptions extends RenderableOptions<FrameBufferRenderable> {
    width: number;
    height: number;
    respectAlpha?: boolean;
}
export declare class FrameBufferRenderable extends Renderable {
    frameBuffer: OptimizedBuffer;
    protected respectAlpha: boolean;
    constructor(ctx: RenderContext, options: FrameBufferOptions);
    protected onResize(width: number, height: number): void;
    protected renderSelf(buffer: OptimizedBuffer): void;
    protected destroySelf(): void;
}
