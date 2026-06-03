import type { WorkspaceEdit } from "./types";
export interface ApplyResult {
    success: boolean;
    filesModified: string[];
    totalEdits: number;
    errors: string[];
}
export declare function applyWorkspaceEdit(edit: WorkspaceEdit | null): ApplyResult;
