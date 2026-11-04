import type { OptimizedBuffer } from "../buffer.js";
import { RGBA, type ColorInput } from "../lib/index.js";
import type { KeyEvent } from "../lib/KeyHandler.js";
import { Renderable, type RenderableOptions } from "../Renderable.js";
import type { RenderContext } from "../types.js";
import { SliderRenderable, type SliderOptions } from "./Slider.js";
export interface ScrollBarOptions extends RenderableOptions<ScrollBarRenderable> {
    orientation: "vertical" | "horizontal";
    showArrows?: boolean;
    arrowOptions?: Omit<ArrowOptions, "direction">;
    trackOptions?: Partial<SliderOptions>;
    onChange?: (position: number) => void;
}
export type ScrollUnit = "absolute" | "viewport" | "content" | "step";
export declare class ScrollBarRenderable extends Renderable {
    readonly slider: SliderRenderable;
    readonly startArrow: ArrowRenderable;
    readonly endArrow: ArrowRenderable;
    readonly orientation: "vertical" | "horizontal";
    protected _focusable: boolean;
    private _scrollSize;
    private _scrollPosition;
    private _viewportSize;
    private _showArrows;
    private _manualVisibility;
    private _onChange;
    scrollStep: number | undefined | null;
    get visible(): boolean;
    set visible(value: boolean);
    resetVisibilityControl(): void;
    get scrollSize(): number;
    get scrollPosition(): number;
    get viewportSize(): number;
    set scrollSize(value: number);
    set scrollPosition(value: number);
    set viewportSize(value: number);
    get showArrows(): boolean;
    set showArrows(value: boolean);
    constructor(ctx: RenderContext, { trackOptions, arrowOptions, orientation, showArrows, ...options }: ScrollBarOptions);
    set arrowOptions(options: ScrollBarOptions["arrowOptions"]);
    set trackOptions(options: ScrollBarOptions["trackOptions"]);
    private updateSliderFromScrollState;
    scrollBy(delta: number, unit?: ScrollUnit): void;
    private recalculateVisibility;
    handleKeyPress(key: KeyEvent): boolean;
}
export interface ArrowOptions extends RenderableOptions<ArrowRenderable> {
    direction: "up" | "down" | "left" | "right";
    foregroundColor?: ColorInput;
    backgroundColor?: ColorInput;
    attributes?: number;
    arrowChars?: {
        up?: string;
        down?: string;
        left?: string;
        right?: string;
    };
}
export declare class ArrowRenderable extends Renderable {
    private _direction;
    private _foregroundColor;
    private _backgroundColor;
    private _attributes;
    private _arrowChars;
    constructor(ctx: RenderContext, options: ArrowOptions);
    get direction(): "up" | "down" | "left" | "right";
    set direction(value: "up" | "down" | "left" | "right");
    get foregroundColor(): RGBA;
    set foregroundColor(value: ColorInput);
    get backgroundColor(): RGBA;
    set backgroundColor(value: ColorInput);
    get attributes(): number;
    set attributes(value: number);
    set arrowChars(value: ArrowOptions["arrowChars"]);
    protected renderSelf(buffer: OptimizedBuffer): void;
    private getArrowChar;
}
