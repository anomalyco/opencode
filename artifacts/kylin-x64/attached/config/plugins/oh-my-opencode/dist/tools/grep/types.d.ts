export interface GrepMatch {
    file: string;
    line: number;
    column?: number;
    text: string;
}
export interface GrepResult {
    matches: GrepMatch[];
    totalMatches: number;
    filesSearched: number;
    truncated: boolean;
    error?: string;
}
export interface GrepOptions {
    pattern: string;
    paths?: string[];
    globs?: string[];
    excludeGlobs?: string[];
    context?: number;
    maxDepth?: number;
    maxFilesize?: string;
    maxCount?: number;
    maxColumns?: number;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    fixedStrings?: boolean;
    multiline?: boolean;
    hidden?: boolean;
    noIgnore?: boolean;
    fileType?: string[];
    timeout?: number;
    threads?: number;
    outputMode?: "content" | "files_with_matches" | "count";
    headLimit?: number;
}
export interface CountResult {
    file: string;
    count: number;
}
