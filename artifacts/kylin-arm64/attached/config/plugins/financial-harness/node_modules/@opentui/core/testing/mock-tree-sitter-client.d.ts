import { TreeSitterClient } from "../lib/tree-sitter/index.js";
import type { SimpleHighlight } from "../lib/tree-sitter/types.js";
export declare class MockTreeSitterClient extends TreeSitterClient {
    private _highlightPromises;
    private _mockResult;
    private _autoResolveTimeout?;
    constructor(options?: {
        autoResolveTimeout?: number;
    });
    highlightOnce(content: string, filetype: string): Promise<{
        highlights?: SimpleHighlight[];
        warning?: string;
        error?: string;
    }>;
    setMockResult(result: {
        highlights?: SimpleHighlight[];
        warning?: string;
        error?: string;
    }): void;
    resolveHighlightOnce(index?: number): void;
    resolveAllHighlightOnce(): void;
    isHighlighting(): boolean;
}
