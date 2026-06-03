import { type ToolCallIDCarrier } from "./resolve-tool-call-id";
import { type PendingToolMetadata } from "./store";
export interface ToolMetadataPublisherContext extends ToolCallIDCarrier {
    sessionID: string;
    metadata?: (input: PendingToolMetadata) => void | Promise<void>;
}
export declare function publishToolMetadata(ctx: ToolMetadataPublisherContext, payload: PendingToolMetadata): Promise<{
    stored: boolean;
}>;
