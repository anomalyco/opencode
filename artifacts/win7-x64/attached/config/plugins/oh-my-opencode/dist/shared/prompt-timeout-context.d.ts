export interface PromptTimeoutArgs {
    signal?: AbortSignal;
}
export interface PromptRetryOptions {
    timeoutMs?: number;
}
export declare const PROMPT_TIMEOUT_MS = 120000;
export declare function createPromptTimeoutContext(args: PromptTimeoutArgs, timeoutMs: number): {
    signal: AbortSignal;
    wasTimedOut: () => boolean;
    cleanup: () => void;
};
