import type { ReplyListenerDaemonState } from "./reply-listener-state";
interface WaitForReplyListenerReadyOptions {
    pid: number;
    startupToken: string;
    timeoutMs: number;
    readState: () => ReplyListenerDaemonState | null;
    sleep: (ms: number) => Promise<void>;
}
export declare function createReplyListenerStartupToken(): string;
export declare function getReplyListenerStartupTimeoutMs(): number;
export declare function waitForReplyListenerReady(options: WaitForReplyListenerReadyOptions): Promise<ReplyListenerDaemonState | null>;
export {};
