import { type LineInfo, type RenderContext } from "../types.js";
import { StyledText } from "../lib/styled-text.js";
import { SyntaxStyle } from "../syntax-style.js";
import { TreeSitterClient } from "../lib/tree-sitter/index.js";
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable.js";
import type { OptimizedBuffer } from "../buffer.js";
import type { SimpleHighlight } from "../lib/tree-sitter/types.js";
import type { TextChunk } from "../text-buffer.js";
export interface HighlightContext {
    content: string;
    filetype: string;
    syntaxStyle: SyntaxStyle;
}
export type OnHighlightCallback = (highlights: SimpleHighlight[], context: HighlightContext) => SimpleHighlight[] | undefined | Promise<SimpleHighlight[] | undefined>;
export interface ChunkRenderContext extends HighlightContext {
    highlights: SimpleHighlight[];
}
export type OnChunksCallback = (chunks: TextChunk[], context: ChunkRenderContext) => TextChunk[] | undefined | Promise<TextChunk[] | undefined>;
export interface CodeOptions extends TextBufferOptions {
    content?: string;
    filetype?: string;
    syntaxStyle: SyntaxStyle;
    treeSitterClient?: TreeSitterClient;
    conceal?: boolean;
    drawUnstyledText?: boolean;
    streaming?: boolean;
    initialStyledText?: StyledText;
    baseHighlight?: string;
    onHighlight?: OnHighlightCallback;
    onChunks?: OnChunksCallback;
}
export declare class CodeRenderable extends TextBufferRenderable {
    private _content;
    private _filetype?;
    private _syntaxStyle;
    private _isHighlighting;
    private _treeSitterClient;
    private _highlightsDirty;
    private _highlightSnapshotId;
    private _conceal;
    private _drawUnstyledText;
    private _shouldRenderTextBuffer;
    private _streaming;
    private _initialStyledText?;
    private _hadInitialContent;
    private _lastHighlights;
    private _baseHighlight?;
    private _onHighlight?;
    private _onChunks?;
    private _highlightingPromise;
    private _renderedLineSources?;
    private _mappedLineInfo?;
    protected _contentDefaultOptions: {
        content: string;
        conceal: true;
        drawUnstyledText: true;
        streaming: false;
    };
    constructor(ctx: RenderContext, options: CodeOptions);
    get content(): string;
    set content(value: string);
    get lineInfo(): LineInfo;
    get wrapMode(): "none" | "char" | "word";
    set wrapMode(value: "none" | "char" | "word");
    protected onResize(width: number, height: number): void;
    protected updateTextInfo(): void;
    get filetype(): string | undefined;
    set filetype(value: string | undefined);
    get syntaxStyle(): SyntaxStyle;
    set syntaxStyle(value: SyntaxStyle);
    get conceal(): boolean;
    set conceal(value: boolean);
    get drawUnstyledText(): boolean;
    set drawUnstyledText(value: boolean);
    get streaming(): boolean;
    set initialStyledText(value: StyledText | undefined);
    set streaming(value: boolean);
    get treeSitterClient(): TreeSitterClient;
    set treeSitterClient(value: TreeSitterClient);
    get onHighlight(): OnHighlightCallback | undefined;
    get baseHighlight(): string | undefined;
    set baseHighlight(value: string | undefined);
    set onHighlight(value: OnHighlightCallback | undefined);
    get onChunks(): OnChunksCallback | undefined;
    set onChunks(value: OnChunksCallback | undefined);
    get isHighlighting(): boolean;
    get highlightingDone(): Promise<void>;
    protected transformChunks(chunks: TextChunk[], context: ChunkRenderContext): Promise<TextChunk[]>;
    private ensureVisibleTextBeforeHighlight;
    private startHighlight;
    private setRenderedLineSources;
    private static isIdentityLineSources;
    private static getMergedConcealLineRanges;
    private getConcealLinesSourceMap;
    getLineHighlights(lineIdx: number): import("../types.js").Highlight[];
    protected renderSelf(buffer: OptimizedBuffer): void;
}
