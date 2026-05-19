import { type MarkedToken } from "marked";
export interface ParseState {
    content: string;
    tokens: MarkedToken[];
    stableTokenCount?: number;
}
/**
 * Incrementally parse markdown, reusing unchanged tokens from previous parse.
 * Compares token.raw at each offset - matching tokens keep same object reference.
 */
export declare function parseMarkdownIncremental(newContent: string, prevState: ParseState | null, trailingUnstable?: number): ParseState;
