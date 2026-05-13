/**
 * Creates an AbortController that automatically aborts after a timeout.
 *
 * Uses bind() instead of arrow functions to avoid capturing the surrounding
 * scope in closures. Arrow functions like `() => controller.abort()` capture
 * request bodies and other large objects, preventing GC for the timer lifetime.
 *
 * @param ms Timeout in milliseconds
 * @returns Object with controller, signal, and clearTimeout function
 */
export declare function abortAfter(ms: number): {
    controller: AbortController;
    signal: AbortSignal;
    clearTimeout: () => void;
};
/**
 * Combines multiple AbortSignals with a timeout.
 *
 * @param ms Timeout in milliseconds
 * @param signals Additional signals to combine
 * @returns Combined signal that aborts on timeout or when any input signal aborts
 */
export declare function abortAfterAny(ms: number, ...signals: AbortSignal[]): {
    signal: AbortSignal;
    clearTimeout: () => void;
};
