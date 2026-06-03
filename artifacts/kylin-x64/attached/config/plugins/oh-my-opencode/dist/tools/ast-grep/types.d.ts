import type { CLI_LANGUAGES, NAPI_LANGUAGES } from "./constants";
export type CliLanguage = (typeof CLI_LANGUAGES)[number];
export type NapiLanguage = (typeof NAPI_LANGUAGES)[number];
export interface Position {
    line: number;
    column: number;
}
export interface Range {
    start: Position;
    end: Position;
}
export interface CliMatch {
    text: string;
    range: {
        byteOffset: {
            start: number;
            end: number;
        };
        start: Position;
        end: Position;
    };
    file: string;
    lines: string;
    charCount: {
        leading: number;
        trailing: number;
    };
    language: string;
}
export interface SearchMatch {
    file: string;
    text: string;
    range: Range;
    lines: string;
}
export interface MetaVariable {
    name: string;
    text: string;
    kind: string;
}
export interface AnalyzeResult {
    text: string;
    range: Range;
    kind: string;
    metaVariables: MetaVariable[];
}
export interface TransformResult {
    original: string;
    transformed: string;
    editCount: number;
}
export interface SgResult {
    matches: CliMatch[];
    totalMatches: number;
    truncated: boolean;
    truncatedReason?: "max_matches" | "max_output_bytes" | "timeout";
    error?: string;
}
