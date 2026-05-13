import z from "zod";
import { Tool } from "./tool";
export declare const EditTool: Tool.Info<z.ZodObject<{
    filePath: z.ZodString;
    oldString: z.ZodString;
    newString: z.ZodString;
    replaceAll: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>, {
    diagnostics: Record<string, import("vscode-languageserver-types").Diagnostic[]>;
    diff: string;
    filediff: Snapshot.FileDiff;
}>;
export type Replacer = (content: string, find: string) => Generator<string, void, unknown>;
export declare const SimpleReplacer: Replacer;
export declare const LineTrimmedReplacer: Replacer;
export declare const BlockAnchorReplacer: Replacer;
export declare const WhitespaceNormalizedReplacer: Replacer;
export declare const IndentationFlexibleReplacer: Replacer;
export declare const EscapeNormalizedReplacer: Replacer;
export declare const MultiOccurrenceReplacer: Replacer;
export declare const TrimmedBoundaryReplacer: Replacer;
export declare const ContextAwareReplacer: Replacer;
export declare function trimDiff(diff: string): string;
export declare function replace(content: string, oldString: string, newString: string, replaceAll?: boolean): string;
