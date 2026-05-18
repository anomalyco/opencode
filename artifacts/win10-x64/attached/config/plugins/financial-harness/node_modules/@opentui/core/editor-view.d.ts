import { RGBA } from "./lib/RGBA.js";
import { type RenderLib, type VisualCursor, type LineInfo } from "./zig.js";
import { type Pointer } from "bun:ffi";
import type { EditBuffer } from "./edit-buffer.js";
export interface Viewport {
    offsetY: number;
    offsetX: number;
    height: number;
    width: number;
}
export type { VisualCursor };
export declare class EditorView {
    private lib;
    private viewPtr;
    private editBuffer;
    private _destroyed;
    private _extmarksController?;
    private _textBufferViewPtr?;
    constructor(lib: RenderLib, ptr: Pointer, editBuffer: EditBuffer);
    static create(editBuffer: EditBuffer, viewportWidth: number, viewportHeight: number): EditorView;
    private guard;
    get ptr(): Pointer;
    setViewportSize(width: number, height: number): void;
    setViewport(x: number, y: number, width: number, height: number, moveCursor?: boolean): void;
    getViewport(): Viewport;
    setScrollMargin(margin: number): void;
    setWrapMode(mode: "none" | "char" | "word"): void;
    getVirtualLineCount(): number;
    getTotalVirtualLineCount(): number;
    setSelection(start: number, end: number, bgColor?: RGBA, fgColor?: RGBA): void;
    updateSelection(end: number, bgColor?: RGBA, fgColor?: RGBA): void;
    resetSelection(): void;
    getSelection(): {
        start: number;
        end: number;
    } | null;
    hasSelection(): boolean;
    setLocalSelection(anchorX: number, anchorY: number, focusX: number, focusY: number, bgColor?: RGBA, fgColor?: RGBA, updateCursor?: boolean, followCursor?: boolean): boolean;
    updateLocalSelection(anchorX: number, anchorY: number, focusX: number, focusY: number, bgColor?: RGBA, fgColor?: RGBA, updateCursor?: boolean, followCursor?: boolean): boolean;
    resetLocalSelection(): void;
    getSelectedText(): string;
    getCursor(): {
        row: number;
        col: number;
    };
    getText(): string;
    getVisualCursor(): VisualCursor;
    moveUpVisual(): void;
    moveDownVisual(): void;
    deleteSelectedText(): void;
    setCursorByOffset(offset: number): void;
    getNextWordBoundary(): VisualCursor;
    getPrevWordBoundary(): VisualCursor;
    getEOL(): VisualCursor;
    getVisualSOL(): VisualCursor;
    getVisualEOL(): VisualCursor;
    getLineInfo(): LineInfo;
    getLogicalLineInfo(): LineInfo;
    get extmarks(): any;
    setPlaceholderStyledText(chunks: {
        text: string;
        fg?: RGBA;
        bg?: RGBA;
        attributes?: number;
    }[]): void;
    setTabIndicator(indicator: string | number): void;
    setTabIndicatorColor(color: RGBA): void;
    measureForDimensions(width: number, height: number): {
        lineCount: number;
        widthColsMax: number;
    } | null;
    destroy(): void;
}
