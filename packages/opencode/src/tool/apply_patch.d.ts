import z from "zod";
import { Tool } from "./tool";
export declare const ApplyPatchTool: Tool.Info<z.ZodObject<{
    patchText: z.ZodString;
}, z.core.$strip>, {
    diff: string;
    files: {
        filePath: string;
        relativePath: string;
        type: "add" | "delete" | "move" | "update";
        diff: string;
        before: string;
        after: string;
        additions: number;
        deletions: number;
        movePath: string | undefined;
    }[];
    diagnostics: Record<string, import("vscode-languageserver-types").Diagnostic[]>;
}>;
