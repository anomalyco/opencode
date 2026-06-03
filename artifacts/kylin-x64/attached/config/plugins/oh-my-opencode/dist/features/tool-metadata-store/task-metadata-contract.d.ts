export interface TaskLink {
    sessionId?: string;
    taskId?: string;
    backgroundTaskId?: string;
    agent?: string;
    category?: string;
}
export declare function buildTaskMetadataBlock(link: TaskLink): string;
export declare function parseTaskMetadataBlock(text: string): TaskLink;
export declare function extractTaskLink(metadata: unknown, outputText: string): TaskLink;
