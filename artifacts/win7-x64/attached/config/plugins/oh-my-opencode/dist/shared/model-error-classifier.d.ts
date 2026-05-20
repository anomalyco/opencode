import type { FallbackEntry } from "./model-requirements";
export interface ErrorInfo {
    name?: string;
    message?: string;
}
/**
 * Determines if an error is a retryable model error.
 * Returns true if the error is a known retryable type OR matches retryable message patterns.
 */
export declare function isRetryableModelError(error: ErrorInfo): boolean;
/**
 * Determines if an error should trigger a fallback retry.
 * Returns true for deadstop errors that completely halt the action loop.
 */
export declare function shouldRetryError(error: ErrorInfo): boolean;
/**
 * Gets the next fallback model from the chain based on attempt count.
 * Returns undefined if all fallbacks have been exhausted.
 */
export declare function getNextFallback(fallbackChain: FallbackEntry[], attemptCount: number): FallbackEntry | undefined;
/**
 * Checks if there are more fallbacks available after the current attempt.
 */
export declare function hasMoreFallbacks(fallbackChain: FallbackEntry[], attemptCount: number): boolean;
/**
 * Selects the best provider for a fallback entry.
 * Priority:
 * 1) First connected provider in the entry's provider preference order
 * 2) Preferred provider when connected (and entry providers are unavailable)
 * 3) First provider listed in the fallback entry
 */
export declare function selectFallbackProvider(providers: string[], preferredProviderID?: string): string;
