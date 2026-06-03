export type ArchiveEntry = {
    path: string;
    type: "file" | "directory" | "symlink" | "hardlink";
    linkPath?: string;
};
export declare function validateArchiveEntries(entries: ArchiveEntry[], destDir: string): void;
