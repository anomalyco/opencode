/**
 * Debounce controller that manages debounce instances for a specific scope
 */
export declare class DebounceController {
    private scopeId;
    constructor(scopeId: string | number);
    /**
     * Debounces the provided function with the given ID
     *
     * @param id Unique identifier within this scope
     * @param ms Milliseconds to wait before executing
     * @param fn Function to execute
     */
    debounce<R>(id: string | number, ms: number, fn: () => Promise<R>): Promise<R>;
    /**
     * Clear a specific debounce timer in this scope
     *
     * @param id The debounce ID to clear
     */
    clearDebounce(id: string | number): void;
    /**
     * Clear all debounce timers in this scope
     */
    clear(): void;
}
/**
 * Creates a new debounce controller for a specific scope
 *
 * @param scopeId Unique identifier for this debounce scope
 * @returns A DebounceController for the specified scope
 */
export declare function createDebounce(scopeId: string | number): DebounceController;
/**
 * Clears all debounce timers for a specific scope
 *
 * @param scopeId The scope identifier
 */
export declare function clearDebounceScope(scopeId: string | number): void;
/**
 * Clears all active debounce timers across all scopes
 */
export declare function clearAllDebounces(): void;
