import type { TextChunk } from "../text-buffer.js";
import { StyledText } from "./styled-text.js";
import { SyntaxStyle } from "../syntax-style.js";
import { TreeSitterClient } from "./tree-sitter/client.js";
import type { SimpleHighlight } from "./tree-sitter/types.js";
interface ConcealOptions {
    enabled: boolean;
}
export declare function treeSitterToTextChunks(content: string, highlights: SimpleHighlight[], syntaxStyle: SyntaxStyle, options?: ConcealOptions): TextChunk[];
export interface TreeSitterToStyledTextOptions {
    conceal?: ConcealOptions;
}
export declare function treeSitterToStyledText(content: string, filetype: string, syntaxStyle: SyntaxStyle, client: TreeSitterClient, options?: TreeSitterToStyledTextOptions): Promise<StyledText>;
export {};
