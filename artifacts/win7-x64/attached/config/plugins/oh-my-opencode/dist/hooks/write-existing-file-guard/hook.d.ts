import type { Hooks, PluginInput } from "@opencode-ai/plugin";
export type GuardArgs = {
    filePath?: string;
    path?: string;
    file_path?: string;
    overwrite?: boolean | string;
};
export declare const MAX_TRACKED_PATHS_PER_SESSION = 1024;
export declare function asRecord(value: unknown): Record<string, unknown> | undefined;
export declare function getPathFromArgs(args: GuardArgs | undefined): string | undefined;
export declare function resolveInputPath(ctx: PluginInput, inputPath: string): string;
export declare function isPathInsideDirectory(pathToCheck: string, directory: string): boolean;
export declare function toCanonicalPath(absolutePath: string): string;
export declare function isOverwriteEnabled(value: boolean | string | undefined): boolean;
export declare function createWriteExistingFileGuardHook(ctx: PluginInput): Hooks;
