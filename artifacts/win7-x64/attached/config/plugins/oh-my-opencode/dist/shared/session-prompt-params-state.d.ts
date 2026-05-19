export type SessionPromptParams = {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    options?: Record<string, unknown>;
};
export declare function setSessionPromptParams(sessionID: string, params: SessionPromptParams): void;
export declare function getSessionPromptParams(sessionID: string): SessionPromptParams | undefined;
export declare function clearSessionPromptParams(sessionID: string): void;
export declare function clearAllSessionPromptParams(): void;
