import { logReplyListenerMessage } from "./reply-listener-log";
import { type ReplyListenerDaemonState } from "./reply-listener-state";
import type { OpenClawConfig } from "./types";
export declare function isDaemonRunning(): Promise<boolean>;
export declare function pollLoop(): Promise<void>;
export declare function startReplyListener(config: OpenClawConfig): Promise<{
    success: boolean;
    message: string;
    state?: ReplyListenerDaemonState;
    error?: string;
}>;
export declare function stopReplyListener(): Promise<{
    success: boolean;
    message: string;
    state?: ReplyListenerDaemonState;
    error?: string;
}>;
export { logReplyListenerMessage };
