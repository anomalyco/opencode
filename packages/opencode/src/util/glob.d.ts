export declare namespace Glob {
    interface Options {
        cwd?: string;
        absolute?: boolean;
        include?: "file" | "all";
        dot?: boolean;
        symlink?: boolean;
    }
    function scan(pattern: string, options?: Options): Promise<string[]>;
    function scanSync(pattern: string, options?: Options): string[];
    function match(pattern: string, filepath: string): boolean;
}
