import type { DelegateTaskArgs } from "./types";
/**
 * Context for error formatting.
 */
export interface ErrorContext {
    operation: string;
    args?: DelegateTaskArgs;
    sessionID?: string;
    agent?: string;
    category?: string;
}
/**
 * Format an error with detailed context for debugging.
 */
export declare function formatDetailedError(error: unknown, ctx: ErrorContext): string;
