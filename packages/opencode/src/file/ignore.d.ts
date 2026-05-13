export declare namespace FileIgnore {
    const PATTERNS: string[];
    function match(filepath: string, opts?: {
        extra?: string[];
        whitelist?: string[];
    }): boolean;
}
