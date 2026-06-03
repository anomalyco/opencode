import type { HashlineEdit } from "./types";
export declare function dedupeEdits(edits: HashlineEdit[]): {
    edits: HashlineEdit[];
    deduplicatedEdits: number;
};
