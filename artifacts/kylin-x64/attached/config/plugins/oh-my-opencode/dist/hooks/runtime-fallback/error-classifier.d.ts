export { extractAutoRetrySignal } from "./auto-retry-signal";
export declare function getErrorMessage(error: unknown): string;
export declare function extractStatusCode(error: unknown, retryOnErrors?: number[]): number | undefined;
export declare function extractErrorName(error: unknown): string | undefined;
export declare function classifyErrorType(error: unknown): string | undefined;
export declare function containsErrorContent(parts: Array<{
    type?: string;
    text?: string;
}> | undefined): {
    hasError: boolean;
    errorMessage?: string;
};
export declare function isRetryableError(error: unknown, retryOnErrors: number[]): boolean;
