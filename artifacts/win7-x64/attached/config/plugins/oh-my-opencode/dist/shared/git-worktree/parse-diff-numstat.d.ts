import type { GitFileStat, GitFileStatus } from "./types";
export declare function parseGitDiffNumstat(output: string, statusMap: Map<string, GitFileStatus>): GitFileStat[];
