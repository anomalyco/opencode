export declare function isMarkdownFile(entry: {
    name: string;
    isFile: () => boolean;
}): boolean;
export declare function isSymbolicLink(filePath: string): boolean;
export declare function resolveSymlink(filePath: string): string;
export declare function resolveSymlinkAsync(filePath: string): Promise<string>;
