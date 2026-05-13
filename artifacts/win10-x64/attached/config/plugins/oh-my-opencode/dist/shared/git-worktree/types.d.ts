export type GitFileStatus = "modified" | "added" | "deleted";
export interface GitFileStat {
    path: string;
    added: number;
    removed: number;
    status: GitFileStatus;
}
