export type WorktreeEntry = {
    path: string;
    branch: string | undefined;
    bare: boolean;
};
export declare function parseWorktreeListPorcelain(output: string): WorktreeEntry[];
export declare function listWorktrees(directory: string): WorktreeEntry[];
export declare function detectWorktreePath(directory: string): string | null;
