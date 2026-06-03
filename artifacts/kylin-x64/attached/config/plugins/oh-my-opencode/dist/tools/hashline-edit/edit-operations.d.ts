import type { HashlineEdit } from "./types";
export interface HashlineApplyReport {
    content: string;
    noopEdits: number;
    deduplicatedEdits: number;
}
export declare function applyHashlineEditsWithReport(content: string, edits: HashlineEdit[]): HashlineApplyReport;
export declare function applyHashlineEdits(content: string, edits: HashlineEdit[]): string;
