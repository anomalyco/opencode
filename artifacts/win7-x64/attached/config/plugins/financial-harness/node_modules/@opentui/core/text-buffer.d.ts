import type { StyledText } from "./lib/styled-text.js";
import { RGBA } from "./lib/RGBA.js";
import { type RenderLib } from "./zig.js";
import { type Pointer } from "bun:ffi";
import { type WidthMethod, type Highlight } from "./types.js";
import type { SyntaxStyle } from "./syntax-style.js";
export interface TextChunk {
    __isChunk: true;
    text: string;
    fg?: RGBA;
    bg?: RGBA;
    attributes?: number;
    link?: {
        url: string;
    };
}
export declare class TextBuffer {
    private lib;
    private bufferPtr;
    private _length;
    private _byteSize;
    private _lineInfo?;
    private _destroyed;
    private _syntaxStyle?;
    private _textBytes?;
    private _memId?;
    private _appendedChunks;
    constructor(lib: RenderLib, ptr: Pointer);
    static create(widthMethod: WidthMethod): TextBuffer;
    private guard;
    setText(text: string): void;
    append(text: string): void;
    loadFile(path: string): void;
    setStyledText(text: StyledText): void;
    setDefaultFg(fg: RGBA | null): void;
    setDefaultBg(bg: RGBA | null): void;
    setDefaultAttributes(attributes: number | null): void;
    resetDefaults(): void;
    getLineCount(): number;
    get length(): number;
    get byteSize(): number;
    get ptr(): Pointer;
    getPlainText(): string;
    getTextRange(startOffset: number, endOffset: number): string;
    /**
     * Add a highlight using character offsets into the full text.
     * start/end in highlight represent absolute character positions.
     */
    addHighlightByCharRange(highlight: Highlight): void;
    /**
     * Add a highlight to a specific line by column positions.
     * start/end in highlight represent column offsets.
     */
    addHighlight(lineIdx: number, highlight: Highlight): void;
    removeHighlightsByRef(hlRef: number): void;
    clearLineHighlights(lineIdx: number): void;
    clearAllHighlights(): void;
    getLineHighlights(lineIdx: number): Array<Highlight>;
    getHighlightCount(): number;
    setSyntaxStyle(style: SyntaxStyle | null): void;
    getSyntaxStyle(): SyntaxStyle | null;
    setTabWidth(width: number): void;
    getTabWidth(): number;
    clear(): void;
    reset(): void;
    destroy(): void;
}
