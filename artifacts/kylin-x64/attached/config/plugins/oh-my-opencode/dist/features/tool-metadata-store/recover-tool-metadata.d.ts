import { type PendingToolMetadata } from "./store";
import { type ToolCallIDCarrier } from "./resolve-tool-call-id";
export declare function recoverToolMetadata(sessionID: string, source: ToolCallIDCarrier | string | undefined): PendingToolMetadata | undefined;
