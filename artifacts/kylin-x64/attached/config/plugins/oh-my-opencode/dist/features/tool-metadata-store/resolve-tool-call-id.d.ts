export interface ToolCallIDCarrier {
    callID?: string;
    callId?: string;
    call_id?: string;
}
export declare function resolveToolCallID(ctx: ToolCallIDCarrier): string | undefined;
