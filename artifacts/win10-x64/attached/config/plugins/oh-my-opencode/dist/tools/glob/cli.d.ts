import { type GrepBackend } from "./constants";
import type { GlobOptions, GlobResult } from "./types";
export interface ResolvedCli {
    path: string;
    backend: GrepBackend;
}
declare function buildRgArgs(options: GlobOptions): string[];
declare function buildFindArgs(options: GlobOptions): string[];
declare function buildPowerShellCommand(options: GlobOptions): string[];
export { buildRgArgs, buildFindArgs, buildPowerShellCommand };
export declare function runRgFiles(options: GlobOptions, resolvedCli?: ResolvedCli): Promise<GlobResult>;
