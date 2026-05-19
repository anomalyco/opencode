import type { PluginInput } from "@opencode-ai/plugin";
/**
 * Known Edit tool error patterns that indicate the AI made a mistake
 */
export declare const EDIT_ERROR_PATTERNS: readonly ["oldString and newString must be different", "oldString not found", "oldString found multiple times"];
/**
 * System reminder injected when Edit tool fails due to AI mistake
 * Short, direct, and commanding - forces immediate corrective action
 */
export declare const EDIT_ERROR_REMINDER = "\n[EDIT ERROR - IMMEDIATE ACTION REQUIRED]\n\nYou made an Edit mistake. STOP and do this NOW:\n\n1. READ the file immediately to see its ACTUAL current state\n2. VERIFY what the content really looks like (your assumption was wrong)\n3. APOLOGIZE briefly to the user for the error\n4. CONTINUE with corrected action based on the real file content\n\nDO NOT attempt another edit until you've read and verified the file state.\n";
/**
 * Detects Edit tool errors caused by AI mistakes and injects a recovery reminder
 *
 * This hook catches common Edit tool failures:
 * - oldString and newString must be different (trying to "edit" to same content)
 * - oldString not found (wrong assumption about file content)
 * - oldString found multiple times (ambiguous match, need more context)
 *
 * @see https://github.com/sst/opencode/issues/4718
 */
export declare function createEditErrorRecoveryHook(_ctx: PluginInput): {
    "tool.execute.after": (input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, output: {
        title: string;
        output: string;
        metadata: unknown;
    }) => Promise<void>;
};
