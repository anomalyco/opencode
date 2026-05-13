import type { HashlineEdit } from "./types";
export declare function getEditLineNumber(edit: HashlineEdit): number;
export declare function collectLineRefs(edits: HashlineEdit[]): string[];
export declare function detectOverlappingRanges(edits: HashlineEdit[]): string | null;
