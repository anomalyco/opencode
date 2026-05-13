import type { AnalyzeResult, SgResult } from "./types";
export declare function formatSearchResult(result: SgResult): string;
export declare function formatReplaceResult(result: SgResult, isDryRun: boolean): string;
export declare function formatAnalyzeResult(results: AnalyzeResult[], extractedMetaVars: boolean): string;
export declare function formatTransformResult(_original: string, transformed: string, editCount: number): string;
