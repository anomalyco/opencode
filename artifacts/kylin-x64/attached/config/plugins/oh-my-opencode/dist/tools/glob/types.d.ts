export interface FileMatch {
    path: string;
    mtime: number;
}
export interface GlobResult {
    files: FileMatch[];
    totalFiles: number;
    truncated: boolean;
    error?: string;
}
export interface GlobOptions {
    pattern: string;
    paths?: string[];
    hidden?: boolean;
    follow?: boolean;
    noIgnore?: boolean;
    maxDepth?: number;
    timeout?: number;
    limit?: number;
    threads?: number;
}
