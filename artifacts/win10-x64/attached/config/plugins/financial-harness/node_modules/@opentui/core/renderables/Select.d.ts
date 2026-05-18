import { OptimizedBuffer } from "../buffer.js";
import { fonts } from "../lib/ascii.font.js";
import type { KeyEvent } from "../lib/KeyHandler.js";
import { type ColorInput } from "../lib/RGBA.js";
import { Renderable, type RenderableOptions } from "../Renderable.js";
import type { RenderContext } from "../types.js";
import { type KeyBinding as BaseKeyBinding, type KeyAliasMap } from "../lib/keymapping.js";
export interface SelectOption {
    name: string;
    description: string;
    value?: any;
}
export type SelectAction = "move-up" | "move-down" | "move-up-fast" | "move-down-fast" | "select-current";
export type SelectKeyBinding = BaseKeyBinding<SelectAction>;
export interface SelectRenderableOptions extends RenderableOptions<SelectRenderable> {
    backgroundColor?: ColorInput;
    textColor?: ColorInput;
    focusedBackgroundColor?: ColorInput;
    focusedTextColor?: ColorInput;
    options?: SelectOption[];
    selectedIndex?: number;
    selectedBackgroundColor?: ColorInput;
    selectedTextColor?: ColorInput;
    descriptionColor?: ColorInput;
    selectedDescriptionColor?: ColorInput;
    showScrollIndicator?: boolean;
    wrapSelection?: boolean;
    showDescription?: boolean;
    font?: keyof typeof fonts;
    itemSpacing?: number;
    fastScrollStep?: number;
    keyBindings?: SelectKeyBinding[];
    keyAliasMap?: KeyAliasMap;
}
export declare enum SelectRenderableEvents {
    SELECTION_CHANGED = "selectionChanged",
    ITEM_SELECTED = "itemSelected"
}
export declare class SelectRenderable extends Renderable {
    protected _focusable: boolean;
    private _options;
    private _selectedIndex;
    private scrollOffset;
    private maxVisibleItems;
    private _backgroundColor;
    private _textColor;
    private _focusedBackgroundColor;
    private _focusedTextColor;
    private _selectedBackgroundColor;
    private _selectedTextColor;
    private _descriptionColor;
    private _selectedDescriptionColor;
    private _showScrollIndicator;
    private _wrapSelection;
    private _showDescription;
    private _font?;
    private _itemSpacing;
    private linesPerItem;
    private fontHeight;
    private _fastScrollStep;
    private _keyBindingsMap;
    private _keyAliasMap;
    private _keyBindings;
    protected _defaultOptions: {
        backgroundColor: string;
        textColor: string;
        focusedBackgroundColor: string;
        focusedTextColor: string;
        selectedBackgroundColor: string;
        selectedTextColor: string;
        selectedIndex: number;
        descriptionColor: string;
        selectedDescriptionColor: string;
        showScrollIndicator: false;
        wrapSelection: false;
        showDescription: true;
        itemSpacing: number;
        fastScrollStep: number;
    };
    constructor(ctx: RenderContext, options: SelectRenderableOptions);
    protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void;
    private refreshFrameBuffer;
    private renderScrollIndicatorToFrameBuffer;
    get options(): SelectOption[];
    set options(options: SelectOption[]);
    getSelectedOption(): SelectOption | null;
    getSelectedIndex(): number;
    moveUp(steps?: number): void;
    moveDown(steps?: number): void;
    selectCurrent(): void;
    setSelectedIndex(index: number): void;
    private updateScrollOffset;
    protected onResize(width: number, height: number): void;
    handleKeyPress(key: KeyEvent): boolean;
    get showScrollIndicator(): boolean;
    set showScrollIndicator(show: boolean);
    get showDescription(): boolean;
    set showDescription(show: boolean);
    get wrapSelection(): boolean;
    set wrapSelection(wrap: boolean);
    set backgroundColor(value: ColorInput);
    set textColor(value: ColorInput);
    set focusedBackgroundColor(value: ColorInput);
    set focusedTextColor(value: ColorInput);
    set selectedBackgroundColor(value: ColorInput);
    set selectedTextColor(value: ColorInput);
    set descriptionColor(value: ColorInput);
    set selectedDescriptionColor(value: ColorInput);
    set font(font: keyof typeof fonts);
    set itemSpacing(spacing: number);
    set fastScrollStep(step: number);
    set keyBindings(bindings: SelectKeyBinding[]);
    set keyAliasMap(aliases: KeyAliasMap);
    set selectedIndex(value: number);
}
