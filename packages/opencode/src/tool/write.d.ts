import z from "zod";
import { Tool } from "./tool";
export declare const WriteTool: Tool.Info<z.ZodObject<{
    content: z.ZodString;
    filePath: z.ZodString;
}, z.core.$strip>, {
    diagnostics: Record<string, import("vscode-languageserver-types").Diagnostic[]>;
    filepath: string;
    exists: boolean;
}>;
