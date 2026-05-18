import type { OptimizedBuffer } from "../buffer.js";
import { type ColorInput } from "../lib/RGBA.js";
import { Renderable, type RenderableOptions } from "../Renderable.js";
import type { RenderContext } from "../types.js";
export interface TimeToFirstDrawOptions extends RenderableOptions<TimeToFirstDrawRenderable> {
    fg?: ColorInput;
    label?: string;
    precision?: number;
}
export declare class TimeToFirstDrawRenderable extends Renderable {
    private _runtimeMs;
    private textColor;
    private label;
    private precision;
    constructor(ctx: RenderContext, options?: TimeToFirstDrawOptions);
    get runtimeMs(): number | null;
    set fg(value: ColorInput);
    set color(value: ColorInput);
    set textLabel(value: string);
    set decimals(value: number);
    reset(): void;
    protected renderSelf(buffer: OptimizedBuffer): void;
    private normalizePrecision;
}
