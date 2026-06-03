export declare function toHashlineContent(content: string): string;
export declare function generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string;
export declare function countLineDiffs(oldContent: string, newContent: string): {
    additions: number;
    deletions: number;
};
