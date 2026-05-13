import type { FallbackEntry } from "../../shared/model-requirements";
import type { ChatMessageInput, ChatMessageHandlerOutput } from "../../plugin/chat-message";
type FallbackToast = (input: {
    title: string;
    message: string;
    variant?: "info" | "success" | "warning" | "error";
    duration?: number;
}) => void | Promise<void>;
type FallbackCallback = (input: {
    sessionID: string;
    providerID: string;
    modelID: string;
    variant?: string;
}) => void | Promise<void>;
export type ModelFallbackState = {
    providerID: string;
    modelID: string;
    fallbackChain: FallbackEntry[];
    attemptCount: number;
    pending: boolean;
};
export declare function setSessionFallbackChain(sessionID: string, fallbackChain: FallbackEntry[] | undefined): void;
export declare function clearSessionFallbackChain(sessionID: string): void;
/**
 * Sets a pending model fallback for a session.
 * Called when a model error is detected in session.error handler.
 */
export declare function setPendingModelFallback(sessionID: string, agentName: string, currentProviderID: string, currentModelID: string): boolean;
/**
 * Gets the next fallback model for a session.
 * Increments attemptCount each time called.
 */
export declare function getNextFallback(sessionID: string): {
    providerID: string;
    modelID: string;
    variant?: string;
} | null;
/**
 * Clears the pending fallback for a session.
 * Called after fallback is successfully applied.
 */
export declare function clearPendingModelFallback(sessionID: string): void;
/**
 * Checks if there's a pending fallback for a session.
 */
export declare function hasPendingModelFallback(sessionID: string): boolean;
/**
 * Gets the current fallback state for a session (for debugging).
 */
export declare function getFallbackState(sessionID: string): ModelFallbackState | undefined;
/**
 * Creates a chat.message hook that applies model fallbacks when pending.
 */
export declare function createModelFallbackHook(args?: {
    toast?: FallbackToast;
    onApplied?: FallbackCallback;
}): {
    "chat.message": (input: ChatMessageInput, output: ChatMessageHandlerOutput) => Promise<void>;
};
/**
 * Resets all module-global state for testing.
 * Clears pending fallbacks, toast keys, and session chains.
 */
export declare function _resetForTesting(): void;
export {};
