export type TailMonitorState = {
    currentMessageID?: string;
    currentHasOutput: boolean;
    consecutiveNoTextMessages: number;
    lastCompactedAt?: number;
    lastRecoveryAt?: number;
};
export declare function finalizeTrackedAssistantMessage(state: TailMonitorState): number;
export declare function shouldTreatAssistantPartAsOutput(part: {
    type?: string;
    text?: string;
}): boolean;
export declare function trackAssistantOutput(state: TailMonitorState, messageID?: string): void;
