import type { GitFileStatus } from "./types";
export declare function parseGitStatusPorcelain(output: string): Map<string, GitFileStatus>;
