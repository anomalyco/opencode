/**
 * Asynchronously get comment-checker binary path.
 * Will trigger lazy download if binary not found.
 */
export declare function getCommentCheckerPath(): Promise<string | null>;
/**
 * Synchronously get comment-checker path (no download).
 * Returns cached path or searches known locations.
 */
export declare function getCommentCheckerPathSync(): string | null;
/**
 * Start background initialization.
 * Call this early to trigger download while other init happens.
 */
export declare function startBackgroundInit(): void;
export interface HookInput {
    session_id: string;
    tool_name: string;
    transcript_path: string;
    cwd: string;
    hook_event_name: string;
    tool_input: {
        file_path?: string;
        content?: string;
        old_string?: string;
        new_string?: string;
        edits?: Array<{
            old_string: string;
            new_string: string;
        }>;
    };
    tool_response?: unknown;
}
export interface CheckResult {
    hasComments: boolean;
    message: string;
}
/**
 * Run comment-checker CLI with given input.
 * @param input Hook input to check
 * @param cliPath Optional explicit path to CLI binary
 * @param customPrompt Optional custom prompt to replace default warning message
 */
export declare function runCommentChecker(input: HookInput, cliPath?: string, customPrompt?: string): Promise<CheckResult>;
/**
 * Check if CLI is available (sync check, no download).
 */
export declare function isCliAvailable(): boolean;
/**
 * Check if CLI will be available (async, may trigger download).
 */
export declare function ensureCliAvailable(): Promise<boolean>;
