export type CommentType = "line" | "block" | "docstring";
export interface CommentInfo {
    text: string;
    lineNumber: number;
    filePath: string;
    commentType: CommentType;
    isDocstring: boolean;
    metadata?: Record<string, string>;
}
export interface PendingCall {
    filePath: string;
    content?: string;
    oldString?: string;
    newString?: string;
    edits?: Array<{
        old_string: string;
        new_string: string;
    }>;
    tool: "write" | "edit" | "multiedit";
    sessionID: string;
    timestamp: number;
}
export interface FileComments {
    filePath: string;
    comments: CommentInfo[];
}
export interface FilterResult {
    shouldSkip: boolean;
    reason?: string;
}
export type CommentFilter = (comment: CommentInfo) => FilterResult;
