import z from "zod";
export declare namespace Patch {
    export const PatchSchema: z.ZodObject<{
        patchText: z.ZodString;
    }, z.core.$strip>;
    export type PatchParams = z.infer<typeof PatchSchema>;
    export interface ApplyPatchArgs {
        patch: string;
        hunks: Hunk[];
        workdir?: string;
    }
    export type Hunk = {
        type: "add";
        path: string;
        contents: string;
    } | {
        type: "delete";
        path: string;
    } | {
        type: "update";
        path: string;
        move_path?: string;
        chunks: UpdateFileChunk[];
    };
    export interface UpdateFileChunk {
        old_lines: string[];
        new_lines: string[];
        change_context?: string;
        is_end_of_file?: boolean;
    }
    export interface ApplyPatchAction {
        changes: Map<string, ApplyPatchFileChange>;
        patch: string;
        cwd: string;
    }
    export type ApplyPatchFileChange = {
        type: "add";
        content: string;
    } | {
        type: "delete";
        content: string;
    } | {
        type: "update";
        unified_diff: string;
        move_path?: string;
        new_content: string;
    };
    export interface AffectedPaths {
        added: string[];
        modified: string[];
        deleted: string[];
    }
    export enum ApplyPatchError {
        ParseError = "ParseError",
        IoError = "IoError",
        ComputeReplacements = "ComputeReplacements",
        ImplicitInvocation = "ImplicitInvocation"
    }
    export enum MaybeApplyPatch {
        Body = "Body",
        ShellParseError = "ShellParseError",
        PatchParseError = "PatchParseError",
        NotApplyPatch = "NotApplyPatch"
    }
    export enum MaybeApplyPatchVerified {
        Body = "Body",
        ShellParseError = "ShellParseError",
        CorrectnessError = "CorrectnessError",
        NotApplyPatch = "NotApplyPatch"
    }
    export function parsePatch(patchText: string): {
        hunks: Hunk[];
    };
    export function maybeParseApplyPatch(argv: string[]): {
        type: MaybeApplyPatch.Body;
        args: ApplyPatchArgs;
    } | {
        type: MaybeApplyPatch.PatchParseError;
        error: Error;
    } | {
        type: MaybeApplyPatch.NotApplyPatch;
    };
    interface ApplyPatchFileUpdate {
        unified_diff: string;
        content: string;
    }
    export function deriveNewContentsFromChunks(filePath: string, chunks: UpdateFileChunk[]): ApplyPatchFileUpdate;
    export function applyHunksToFiles(hunks: Hunk[]): Promise<AffectedPaths>;
    export function applyPatch(patchText: string): Promise<AffectedPaths>;
    export function maybeParseApplyPatchVerified(argv: string[], cwd: string): Promise<{
        type: MaybeApplyPatchVerified.Body;
        action: ApplyPatchAction;
    } | {
        type: MaybeApplyPatchVerified.CorrectnessError;
        error: Error;
    } | {
        type: MaybeApplyPatchVerified.NotApplyPatch;
    }>;
    export {};
}
