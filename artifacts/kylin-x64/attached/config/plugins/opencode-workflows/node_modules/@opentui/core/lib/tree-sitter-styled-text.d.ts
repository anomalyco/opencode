import type { TextChunk } from "../text-buffer.js";
import { StyledText } from "./styled-text.js";
import { SyntaxStyle } from "../syntax-style.js";
import { TreeSitterClient } from "./tree-sitter/client.js";
import type { SimpleHighlight } from "./tree-sitter/types.js";
interface TextChunkOptions {
    enabled?: boolean;
    baseHighlight?: string;
}
export declare function treeSitterToTextChunks(content: string, highlights: SimpleHighlight[], syntaxStyle: SyntaxStyle, options?: TextChunkOptions): TextChunk[];
export interface TreeSitterToStyledTextOptions {
    conceal?: Pick<TextChunkOptions, "enabled">;
    baseHighlight?: string;
}
export declare function treeSitterToStyledText(content: string, filetype: string, syntaxStyle: SyntaxStyle, client: TreeSitterClient, options?: TreeSitterToStyledTextOptions): Promise<StyledText>;
export {};
