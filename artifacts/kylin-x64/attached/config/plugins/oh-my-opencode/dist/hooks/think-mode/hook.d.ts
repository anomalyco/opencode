export declare function clearThinkModeState(sessionID: string): void;
export declare function createThinkModeHook(): {
    "chat.message": (input: {
        sessionID: string;
        model?: {
            providerID: string;
            modelID: string;
        };
    }, output: {
        message: Record<string, unknown>;
        parts: Array<{
            type: string;
            text?: string;
            [key: string]: unknown;
        }>;
    }) => Promise<void>;
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
};
