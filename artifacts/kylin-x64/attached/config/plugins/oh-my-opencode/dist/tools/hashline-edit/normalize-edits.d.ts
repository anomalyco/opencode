import type { HashlineEdit } from "./types";
type HashlineToolOp = "replace" | "append" | "prepend";
export interface RawHashlineEdit {
    op?: HashlineToolOp;
    pos?: string;
    end?: string;
    lines?: string | string[] | null;
}
export declare function normalizeHashlineEdits(rawEdits: RawHashlineEdit[]): HashlineEdit[];
export {};
