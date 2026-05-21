import { Renderable, type RenderableOptions } from "../Renderable.js";
import { OptimizedBuffer } from "../buffer.js";
import { type ColorInput } from "../lib/RGBA.js";
import type { KeyEvent } from "../lib/KeyHandler.js";
import type { RenderContext } from "../types.js";
import { type KeyBinding as BaseKeyBinding, type KeyAliasMap } from "../lib/keymapping.js";
export interface TabSelectOption {
    name: string;
    description: string;
    value?: any;
}
export type TabSelectAction = "move-left" | "move-right" | "select-current";
export type TabSelectKeyBinding = BaseKeyBinding<TabSelectAction>;
export interface TabSelectRenderableOptions extends Omit<RenderableOptions<TabSelectRenderable>, "height"> {
    height?: number;
    options?: TabSelectOption[];
    tabWidth?: number;
    backgroundColor?: ColorInput;
    textColor?: ColorInput;
    focusedBackgroundColor?: ColorInput;
    focusedTextColor?: ColorInput;
    selectedBackgroundColor?: ColorInput;
    selectedTextColor?: ColorInput;
    selectedDescriptionColor?: ColorInput;
    showScrollArrows?: boolean;
    showDescription?: boolean;
    showUnderline?: boolean;
    wrapSelection?: boolean;
    keyBindings?: TabSelectKeyBinding[];
    keyAliasMap?: KeyAliasMap;
}
export declare enum TabSelectRenderableEvents {
    SELECTION_CHANGED = "selectionChanged",
    ITEM_SELECTED = "itemSelected"
}
export declare class TabSelectRenderable extends Renderable {
    protected _focusable: boolean;
    private _options;
    private selectedIndex;
    private scrollOffset;
    private _tabWidth;
    private maxVisibleTabs;
    private _backgroundColor;
    private _textColor;
    private _focusedBackgroundColor;
    private _focusedTextColor;
    private _selectedBackgroundColor;
    private _selectedTextColor;
    private _selectedDescriptionColor;
    private _showScrollArrows;
    private _showDescription;
    private _showUnderline;
    private _wrapSelection;
    private _keyBindingsMap;
    private _keyAliasMap;
    private _keyBindings;
    constructor(ctx: RenderContext, options: TabSelectRenderableOptions);
    private calculateDynamicHeight;
    protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void;
    private refreshFrameBuffer;
    private truncateText;
    private renderScrollArrowsToFrameBuffer;
    setOptions(options: TabSelectOption[]): void;
    getSelectedOption(): TabSelectOption | null;
    getSelectedIndex(): number;
    moveLeft(): void;
    moveRight(): void;
    selectCurrent(): void;
    setSelectedIndex(index: number): void;
    private updateScrollOffset;
    protected onResize(width: number, height: number): void;
    setTabWidth(tabWidth: number): void;
    getTabWidth(): number;
    handleKeyPress(key: KeyEvent): boolean;
    get options(): TabSelectOption[];
    set options(options: TabSelectOption[]);
    set backgroundColor(color: ColorInput);
    set textColor(color: ColorInput);
    set focusedBackgroundColor(color: ColorInput);
    set focusedTextColor(color: ColorInput);
    set selectedBackgroundColor(color: ColorInput);
    set selectedTextColor(color: ColorInput);
    set selectedDescriptionColor(color: ColorInput);
    get showDescription(): boolean;
    set showDescription(show: boolean);
    get showUnderline(): boolean;
    set showUnderline(show: boolean);
    get showScrollArrows(): boolean;
    set showScrollArrows(show: boolean);
    get wrapSelection(): boolean;
    set wrapSelection(wrap: boolean);
    get tabWidth(): number;
    set tabWidth(tabWidth: number);
    set keyBindings(bindings: TabSelectKeyBinding[]);
    set keyAliasMap(aliases: KeyAliasMap);
}
