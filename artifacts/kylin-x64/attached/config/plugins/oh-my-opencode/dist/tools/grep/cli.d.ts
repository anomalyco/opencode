import { type ResolvedCli } from "./constants";
import type { GrepOptions, GrepResult, CountResult } from "./types";
export declare function runRg(options: GrepOptions, resolvedCli?: ResolvedCli): Promise<GrepResult>;
export declare function runRgCount(options: Omit<GrepOptions, "context">, resolvedCli?: ResolvedCli): Promise<CountResult[]>;
