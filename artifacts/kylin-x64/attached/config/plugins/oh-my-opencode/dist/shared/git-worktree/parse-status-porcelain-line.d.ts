import type { GitFileStatus } from "./types";
export interface ParsedGitStatusPorcelainLine {
    filePath: string;
    status: GitFileStatus;
}
export declare function parseGitStatusPorcelainLine(line: string): ParsedGitStatusPorcelainLine | null;
