export interface SessionMapping {
    sessionId: string;
    tmuxSession: string;
    tmuxPaneId: string;
    projectPath: string;
    platform: string;
    messageId: string;
    channelId?: string;
    threadId?: string;
    createdAt: string;
}
export declare function registerMessage(mapping: SessionMapping): boolean;
export declare function loadAllMappings(): SessionMapping[];
export declare function lookupByMessageId(platform: string, messageId: string): SessionMapping | null;
export declare function removeSession(sessionId: string): void;
export declare function removeMessagesByPane(paneId: string): void;
export declare function pruneStale(): void;
