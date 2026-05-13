export declare function executeOnCompleteHook(options: {
    command: string;
    sessionId: string;
    exitCode: number;
    durationMs: number;
    messageCount: number;
}): Promise<void>;
