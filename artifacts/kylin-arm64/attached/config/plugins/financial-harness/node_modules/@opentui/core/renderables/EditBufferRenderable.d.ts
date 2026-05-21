import { Renderable, type RenderableOptions } from "../Renderable.js";
import { Selection, type LocalSelectionBounds } from "../lib/selection.js";
import { EditBuffer, type LogicalCursor } from "../edit-buffer.js";
import { EditorView, type VisualCursor } from "../editor-view.js";
import { RGBA } from "../lib/RGBA.js";
import type { RenderContext, Highlight, CursorStyleOptions, LineInfoProvider, LineInfo } from "../types.js";
import type { OptimizedBuffer } from "../buffer.js";
import type { SyntaxStyle } from "../syntax-style.js";
declare const BrandedEditBufferRenderable: unique symbol;
export type EditorCapture = "escape" | "navigate" | "submit" | "tab";
export interface EditorTraits {
    capture?: readonly EditorCapture[];
    suspend?: boolean;
    status?: string;
}
export declare enum EditBufferRenderableEvents {
    TRAITS_CHANGED = "traits-changed"
}
export declare function isEditBufferRenderable(obj: unknown): obj is EditBufferRenderable;
export interface CursorChangeEvent {
    line: number;
    visualColumn: number;
}
export interface ContentChangeEvent {
}
export interface EditBufferOptions extends RenderableOptions<EditBufferRenderable> {
    textColor?: string | RGBA;
    backgroundColor?: string | RGBA;
    selectionBg?: string | RGBA;
    selectionFg?: string | RGBA;
    selectable?: boolean;
    attributes?: number;
    wrapMode?: "none" | "char" | "word";
    scrollMargin?: number;
    scrollSpeed?: number;
    showCursor?: boolean;
    cursorColor?: string | RGBA;
    cursorStyle?: CursorStyleOptions;
    syntaxStyle?: SyntaxStyle;
    tabIndicator?: string | number;
    tabIndicatorColor?: string | RGBA;
    onCursorChange?: (event: CursorChangeEvent) => void;
    onContentChange?: (event: ContentChangeEvent) => void;
}
export declare abstract class EditBufferRenderable extends Renderable implements LineInfoProvider {
    [BrandedEditBufferRenderable]: boolean;
    protected _focusable: boolean;
    selectable: boolean;
    private _traits;
    protected _textColor: RGBA;
    protected _backgroundColor: RGBA;
    protected _defaultAttributes: number;
    protected _selectionBg: RGBA | undefined;
    protected _selectionFg: RGBA | undefined;
    protected _wrapMode: "none" | "char" | "word";
    protected _scrollMargin: number;
    protected _showCursor: boolean;
    protected _cursorColor: RGBA;
    protected _cursorStyle: CursorStyleOptions;
    protected lastLocalSelection: LocalSelectionBounds | null;
    protected _tabIndicator?: string | number;
    protected _tabIndicatorColor?: RGBA;
    private _cursorChangeListener;
    private _contentChangeListener;
    private _autoScrollVelocity;
    private _autoScrollAccumulator;
    private _scrollSpeed;
    private _keyboardSelectionActive;
    readonly editBuffer: EditBuffer;
    readonly editorView: EditorView;
    protected _defaultOptions: {
        textColor: RGBA;
        backgroundColor: string;
        selectionBg: undefined;
        selectionFg: undefined;
        selectable: true;
        attributes: number;
        wrapMode: "none" | "char" | "word";
        scrollMargin: number;
        scrollSpeed: number;
        showCursor: true;
        cursorColor: RGBA;
        cursorStyle: {
            style: "block";
            blinking: true;
        };
        tabIndicator: undefined;
        tabIndicatorColor: undefined;
    };
    constructor(ctx: RenderContext, options: EditBufferOptions);
    get lineInfo(): LineInfo;
    private setupEventListeners;
    get lineCount(): number;
    get virtualLineCount(): number;
    get scrollY(): number;
    get plainText(): string;
    get logicalCursor(): LogicalCursor;
    get visualCursor(): VisualCursor;
    get cursorOffset(): number;
    set cursorOffset(offset: number);
    get cursorCharacterOffset(): number | undefined;
    get textColor(): RGBA;
    set textColor(value: RGBA | string | undefined);
    get selectionBg(): RGBA | undefined;
    get traits(): EditorTraits;
    set traits(value: EditorTraits);
    set selectionBg(value: RGBA | string | undefined);
    get selectionFg(): RGBA | undefined;
    set selectionFg(value: RGBA | string | undefined);
    get backgroundColor(): RGBA;
    set backgroundColor(value: RGBA | string | undefined);
    get attributes(): number;
    set attributes(value: number);
    get wrapMode(): "none" | "char" | "word";
    set wrapMode(value: "none" | "char" | "word");
    get showCursor(): boolean;
    set showCursor(value: boolean);
    get cursorColor(): RGBA;
    set cursorColor(value: RGBA | string);
    get cursorStyle(): CursorStyleOptions;
    set cursorStyle(style: CursorStyleOptions);
    get tabIndicator(): string | number | undefined;
    set tabIndicator(value: string | number | undefined);
    get tabIndicatorColor(): RGBA | undefined;
    set tabIndicatorColor(value: RGBA | string | undefined);
    get scrollSpeed(): number;
    set scrollSpeed(value: number);
    protected onMouseEvent(event: any): void;
    protected handleScroll(event: any): void;
    protected onResize(width: number, height: number): void;
    protected refreshLocalSelection(): boolean;
    private updateLocalSelection;
    shouldStartSelection(x: number, y: number): boolean;
    onSelectionChanged(selection: Selection | null): boolean;
    protected onUpdate(deltaTime: number): void;
    getSelectedText(): string;
    hasSelection(): boolean;
    getSelection(): {
        start: number;
        end: number;
    } | null;
    private refreshSelectionStyle;
    private deleteSelectedText;
    setSelection(start: number, end: number): void;
    setSelectionInclusive(start: number, end: number): void;
    clearSelection(): boolean;
    deleteSelection(): boolean;
    setCursor(row: number, col: number): void;
    insertChar(char: string): void;
    insertText(text: string): void;
    deleteChar(): boolean;
    deleteCharBackward(): boolean;
    newLine(): boolean;
    deleteLine(): boolean;
    moveCursorLeft(options?: {
        select?: boolean;
    }): boolean;
    moveCursorRight(options?: {
        select?: boolean;
    }): boolean;
    moveCursorUp(options?: {
        select?: boolean;
    }): boolean;
    moveCursorDown(options?: {
        select?: boolean;
    }): boolean;
    gotoLine(line: number): void;
    gotoLineStart(): void;
    gotoLineTextEnd(): void;
    gotoLineHome(options?: {
        select?: boolean;
    }): boolean;
    gotoLineEnd(options?: {
        select?: boolean;
    }): boolean;
    gotoVisualLineHome(options?: {
        select?: boolean;
    }): boolean;
    gotoVisualLineEnd(options?: {
        select?: boolean;
    }): boolean;
    gotoBufferHome(options?: {
        select?: boolean;
    }): boolean;
    gotoBufferEnd(options?: {
        select?: boolean;
    }): boolean;
    selectAll(): boolean;
    deleteToLineEnd(): boolean;
    deleteToLineStart(): boolean;
    undo(): boolean;
    redo(): boolean;
    moveWordForward(options?: {
        select?: boolean;
    }): boolean;
    moveWordBackward(options?: {
        select?: boolean;
    }): boolean;
    deleteWordForward(): boolean;
    deleteWordBackward(): boolean;
    private setupMeasureFunc;
    render(buffer: OptimizedBuffer, deltaTime: number): void;
    protected renderSelf(buffer: OptimizedBuffer): void;
    protected renderCursor(buffer: OptimizedBuffer): void;
    focus(): void;
    blur(): void;
    protected onRemove(): void;
    destroy(): void;
    set onCursorChange(handler: ((event: CursorChangeEvent) => void) | undefined);
    get onCursorChange(): ((event: CursorChangeEvent) => void) | undefined;
    set onContentChange(handler: ((event: ContentChangeEvent) => void) | undefined);
    get onContentChange(): ((event: ContentChangeEvent) => void) | undefined;
    get syntaxStyle(): SyntaxStyle | null;
    set syntaxStyle(style: SyntaxStyle | null);
    addHighlight(lineIdx: number, highlight: Highlight): void;
    addHighlightByCharRange(highlight: Highlight): void;
    removeHighlightsByRef(hlRef: number): void;
    clearLineHighlights(lineIdx: number): void;
    clearAllHighlights(): void;
    getLineHighlights(lineIdx: number): Array<Highlight>;
    /**
     * Set text and completely reset the buffer state (clears history, resets add_buffer).
     * Use this for initial text setting or when you want a clean slate.
     */
    setText(text: string): void;
    /**
     * Replace text while preserving undo history (creates an undo point).
     * Use this when you want the setText operation to be undoable.
     */
    replaceText(text: string): void;
    clear(): void;
    deleteRange(startLine: number, startCol: number, endLine: number, endCol: number): void;
    getTextRange(startOffset: number, endOffset: number): string;
    getTextRangeByCoords(startRow: number, startCol: number, endRow: number, endCol: number): string;
    protected updateSelectionForMovement(shiftPressed: boolean, isBeforeMovement: boolean): void;
}
export {};
