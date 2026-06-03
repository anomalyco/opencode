import type { BackgroundManager } from "../../features/background-agent";
interface Event {
    type: string;
    properties?: Record<string, unknown>;
}
interface EventInput {
    event: Event;
}
interface ChatMessageInput {
    sessionID: string;
}
interface ChatMessageOutput {
    parts: Array<{
        type: string;
        text?: string;
        [key: string]: unknown;
    }>;
}
/**
 * Background notification hook - handles event routing to BackgroundManager.
 *
 * Notifications are now delivered directly via session.prompt({ noReply })
 * from the manager, so this hook only needs to handle event routing.
 */
export declare function createBackgroundNotificationHook(manager: BackgroundManager): {
    "chat.message": (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>;
    event: ({ event }: EventInput) => Promise<void>;
};
export {};
