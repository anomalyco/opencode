import { type ASCIIFontName, type fonts } from "../lib/ascii.font.js";
import { type ColorInput } from "../lib/RGBA.js";
import { Selection, type LocalSelectionBounds } from "../lib/selection.js";
import type { RenderableOptions } from "../Renderable.js";
import type { RenderContext } from "../types.js";
import { FrameBufferRenderable } from "./FrameBuffer.js";
export interface ASCIIFontOptions extends Omit<RenderableOptions<ASCIIFontRenderable>, "width" | "height"> {
    text?: string;
    font?: ASCIIFontName;
    color?: ColorInput | ColorInput[];
    backgroundColor?: ColorInput;
    selectionBg?: ColorInput;
    selectionFg?: ColorInput;
    selectable?: boolean;
}
export declare class ASCIIFontRenderable extends FrameBufferRenderable {
    selectable: boolean;
    protected static readonly _defaultOptions: {
        text: string;
        font: "tiny";
        color: string;
        backgroundColor: string;
        selectionBg: undefined;
        selectionFg: undefined;
        selectable: true;
    };
    protected _text: string;
    protected _font: keyof typeof fonts;
    protected _color: ColorInput | ColorInput[];
    protected _backgroundColor: ColorInput;
    protected _selectionBg: ColorInput | undefined;
    protected _selectionFg: ColorInput | undefined;
    protected lastLocalSelection: LocalSelectionBounds | null;
    private selectionHelper;
    constructor(ctx: RenderContext, options: ASCIIFontOptions);
    get text(): string;
    set text(value: string);
    get font(): keyof typeof fonts;
    set font(value: keyof typeof fonts);
    get color(): ColorInput | ColorInput[];
    set color(value: ColorInput | ColorInput[]);
    get backgroundColor(): ColorInput;
    set backgroundColor(value: ColorInput);
    private updateDimensions;
    shouldStartSelection(x: number, y: number): boolean;
    onSelectionChanged(selection: Selection | null): boolean;
    getSelectedText(): string;
    hasSelection(): boolean;
    protected onResize(width: number, height: number): void;
    private renderFontToBuffer;
    private renderSelectionHighlight;
}
