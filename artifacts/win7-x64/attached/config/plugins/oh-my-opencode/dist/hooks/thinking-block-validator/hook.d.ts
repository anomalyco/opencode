/**
 * Proactive Thinking Block Validator Hook
 *
 * Prevents "Expected thinking/redacted_thinking but found tool_use" errors
 * by validating and fixing message structure BEFORE sending to Anthropic API.
 *
 * This hook runs on the "experimental.chat.messages.transform" hook point,
 * which is called before messages are converted to ModelMessage format and
 * sent to the API.
 *
 * Key differences from session-recovery hook:
 * - PROACTIVE (prevents error) vs REACTIVE (fixes after error)
 * - Runs BEFORE API call vs AFTER API error
 * - User never sees the error vs User sees error then recovery
 */
import type { Message, Part } from "@opencode-ai/sdk";
interface MessageWithParts {
    info: Message;
    parts: Part[];
}
type MessagesTransformHook = {
    "experimental.chat.messages.transform"?: (input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
};
/**
 * Validate and fix assistant messages that have tool_use but no thinking block
 */
export declare function createThinkingBlockValidatorHook(): MessagesTransformHook;
export {};
