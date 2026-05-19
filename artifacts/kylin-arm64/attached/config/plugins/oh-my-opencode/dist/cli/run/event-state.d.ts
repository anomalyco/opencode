export interface EventState {
    mainSessionIdle: boolean;
    mainSessionError: boolean;
    lastError: string | null;
    lastOutput: string;
    lastPartText: string;
    currentTool: string | null;
    /** Set to true when the main session has produced meaningful work (text, tool call, or tool result) */
    hasReceivedMeaningfulWork: boolean;
    /** Timestamp of the last received event (for watchdog detection) */
    lastEventTimestamp: number;
    /** Count of assistant messages for the main session */
    messageCount: number;
    /** Current agent name from the latest assistant message */
    currentAgent: string | null;
    /** Current model ID from the latest assistant message */
    currentModel: string | null;
    /** Current model variant from the latest assistant message */
    currentVariant: string | null;
    currentMessageRole: string | null;
    /** Agent profile colors keyed by display name */
    agentColorsByName: Record<string, string>;
    /** Part type registry keyed by partID (text, reasoning, tool, ...) */
    partTypesById: Record<string, string>;
    /** Whether a THINK block is currently open in output */
    inThinkBlock: boolean;
    /** Tracks streamed reasoning text to avoid duplicates */
    lastReasoningText: string;
    /** Whether compact thinking line already printed for current reasoning block */
    hasPrintedThinkingLine: boolean;
    /** Last rendered thinking line width (for in-place padding updates) */
    lastThinkingLineWidth: number;
    /** Message role lookup by message ID to filter user parts */
    messageRoleById: Record<string, string>;
    /** Last rendered thinking summary (to avoid duplicate re-render) */
    lastThinkingSummary: string;
    /** Whether text stream is currently at line start (for padding) */
    textAtLineStart: boolean;
    /** Whether reasoning stream is currently at line start (for padding) */
    thinkingAtLineStart: boolean;
    currentMessageId: string | null;
    /** Assistant message start timestamp by message ID */
    messageStartedAtById: Record<string, number>;
    /** Prevent duplicate completion metadata lines per message */
    completionMetaPrintedByMessageId: Record<string, boolean>;
}
export declare function createEventState(): EventState;
