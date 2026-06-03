import type { BackgroundOutputMessage, BackgroundOutputMessagesResult } from "./clients";
export declare function getErrorMessage(value: BackgroundOutputMessagesResult): string | null;
export declare function extractMessages(value: BackgroundOutputMessagesResult): BackgroundOutputMessage[];
