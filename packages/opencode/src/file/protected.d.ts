export declare namespace Protected {
    /** Directory basenames to skip when scanning the home directory. */
    function names(): ReadonlySet<string>;
    /** Absolute paths that should never be watched, stated, or scanned. */
    function paths(): string[];
}
