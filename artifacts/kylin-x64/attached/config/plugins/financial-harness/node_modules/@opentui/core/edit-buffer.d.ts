import { type LogicalCursor, type RenderLib } from "./zig.js";
import { type Pointer } from "bun:ffi";
import { type WidthMethod, type Highlight } from "./types.js";
import { RGBA } from "./lib/RGBA.js";
import { EventEmitter } from "events";
import type { SyntaxStyle } from "./syntax-style.js";
export type { LogicalCursor };
/**
 * EditBuffer provides a text editing buffer with cursor management,
 * incremental editing, and grapheme-aware operations.
 */
export declare class EditBuffer extends EventEmitter {
    private static registry;
    private static nativeEventsSubscribed;
    private lib;
    private bufferPtr;
    private textBufferPtr;
    readonly id: number;
    private _destroyed;
    private _textBytes;
    private _singleTextBytes;
    private _singleTextMemId;
    private _syntaxStyle?;
    constructor(lib: RenderLib, ptr: Pointer);
    static create(widthMethod: WidthMethod): EditBuffer;
    private static subscribeToNativeEvents;
    private guard;
    get ptr(): Pointer;
    /**
     * Set text and completely reset the buffer state (clears history, resets add_buffer).
     * Use this for initial text setting or when you want a clean slate.
     */
    setText(text: string): void;
    /**
     * Set text using owned memory and completely reset the buffer state (clears history, resets add_buffer).
     * The native code takes ownership of the memory.
     */
    setTextOwned(text: string): void;
    /**
     * Replace text while preserving undo history (creates an undo point).
     * Use this when you want the setText operation to be undoable.
     */
    replaceText(text: string): void;
    /**
     * Replace text using owned memory while preserving undo history (creates an undo point).
     * The native code takes ownership of the memory.
     */
    replaceTextOwned(text: string): void;
    getLineCount(): number;
    getText(): string;
    insertChar(char: string): void;
    insertText(text: string): void;
    deleteChar(): void;
    deleteCharBackward(): void;
    deleteRange(startLine: number, startCol: number, endLine: number, endCol: number): void;
    newLine(): void;
    deleteLine(): void;
    moveCursorLeft(): void;
    moveCursorRight(): void;
    moveCursorUp(): void;
    moveCursorDown(): void;
    gotoLine(line: number): void;
    setCursor(line: number, col: number): void;
    setCursorToLineCol(line: number, col: number): void;
    setCursorByOffset(offset: number): void;
    getCursorPosition(): LogicalCursor;
    getNextWordBoundary(): LogicalCursor;
    getPrevWordBoundary(): LogicalCursor;
    getEOL(): LogicalCursor;
    offsetToPosition(offset: number): {
        row: number;
        col: number;
    } | null;
    positionToOffset(row: number, col: number): number;
    getLineStartOffset(row: number): number;
    getTextRange(startOffset: number, endOffset: number): string;
    getTextRangeByCoords(startRow: number, startCol: number, endRow: number, endCol: number): string;
    debugLogRope(): void;
    undo(): string | null;
    redo(): string | null;
    canUndo(): boolean;
    canRedo(): boolean;
    clearHistory(): void;
    setDefaultFg(fg: RGBA | null): void;
    setDefaultBg(bg: RGBA | null): void;
    setDefaultAttributes(attributes: number | null): void;
    resetDefaults(): void;
    setSyntaxStyle(style: SyntaxStyle | null): void;
    getSyntaxStyle(): SyntaxStyle | null;
    addHighlight(lineIdx: number, highlight: Highlight): void;
    addHighlightByCharRange(highlight: Highlight): void;
    removeHighlightsByRef(hlRef: number): void;
    clearLineHighlights(lineIdx: number): void;
    clearAllHighlights(): void;
    getLineHighlights(lineIdx: number): Array<Highlight>;
    clear(): void;
    destroy(): void;
}
