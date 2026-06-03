import { type RenderableOptions, Renderable } from "../Renderable.js";
import { type RenderContext } from "../types.js";
import { type ColorInput, RGBA } from "../lib/RGBA.js";
import { OptimizedBuffer } from "../buffer.js";
export interface SliderOptions extends RenderableOptions<SliderRenderable> {
    orientation: "vertical" | "horizontal";
    value?: number;
    min?: number;
    max?: number;
    viewPortSize?: number;
    backgroundColor?: ColorInput;
    foregroundColor?: ColorInput;
    onChange?: (value: number) => void;
}
export declare class SliderRenderable extends Renderable {
    readonly orientation: "vertical" | "horizontal";
    private _value;
    private _min;
    private _max;
    private _viewPortSize;
    private _backgroundColor;
    private _foregroundColor;
    private _onChange?;
    constructor(ctx: RenderContext, options: SliderOptions);
    get value(): number;
    set value(newValue: number);
    get min(): number;
    set min(newMin: number);
    get max(): number;
    set max(newMax: number);
    set viewPortSize(size: number);
    get viewPortSize(): number;
    get backgroundColor(): RGBA;
    set backgroundColor(value: ColorInput);
    get foregroundColor(): RGBA;
    set foregroundColor(value: ColorInput);
    private calculateDragOffsetVirtual;
    private setupMouseHandling;
    private updateValueFromMouseDirect;
    private updateValueFromMouseWithOffset;
    private getThumbRect;
    protected renderSelf(buffer: OptimizedBuffer): void;
    private renderHorizontal;
    private renderVertical;
    private getVirtualThumbSize;
    private getVirtualThumbStart;
}
