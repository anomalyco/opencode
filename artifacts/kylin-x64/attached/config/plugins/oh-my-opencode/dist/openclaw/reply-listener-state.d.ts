import type { OpenClawConfig } from "./types";
export declare const REPLY_LISTENER_STARTUP_TOKEN_ENV = "OMO_OPENCLAW_REPLY_LISTENER_STARTUP_TOKEN";
export interface ReplyListenerDaemonState {
    isRunning: boolean;
    pid: number | null;
    startedAt: string;
    startupToken: string | null;
    configSignature: string | null;
    lastPollAt: string | null;
    telegramLastUpdateId: number | null;
    discordLastMessageId: string | null;
    lastDiscordMessageId: string | null;
    messagesSeen: number;
    messagesInjected: number;
    errors: number;
    lastError?: string;
}
export declare function createPendingReplyListenerState(startupToken: string): ReplyListenerDaemonState;
export declare function readReplyListenerDaemonState(): ReplyListenerDaemonState | null;
export declare function writeReplyListenerDaemonState(state: ReplyListenerDaemonState): void;
export declare function readReplyListenerDaemonConfig(): OpenClawConfig | null;
export declare function writeReplyListenerDaemonConfig(config: OpenClawConfig): void;
export declare function readReplyListenerPid(): number | null;
export declare function writeReplyListenerPid(pid: number): void;
export declare function removeReplyListenerPid(): void;
export declare function getReplyListenerStartupTokenFromEnv(): string | null;
export declare function recordReplyListenerPoll(state: ReplyListenerDaemonState, pid: number): void;
export declare function recordSeenDiscordMessage(state: ReplyListenerDaemonState, messageId: string): void;
export declare function markReplyListenerStopped(state: ReplyListenerDaemonState | null, error?: string): ReplyListenerDaemonState;
