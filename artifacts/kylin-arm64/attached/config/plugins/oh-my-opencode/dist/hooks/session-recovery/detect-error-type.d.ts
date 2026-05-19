export type RecoveryErrorType = "tool_result_missing" | "thinking_block_order" | "thinking_disabled_violation" | "assistant_prefill_unsupported" | "unavailable_tool" | null;
export declare function extractMessageIndex(error: unknown): number | null;
export declare function extractUnavailableToolName(error: unknown): string | null;
export declare function detectErrorType(error: unknown): RecoveryErrorType;
