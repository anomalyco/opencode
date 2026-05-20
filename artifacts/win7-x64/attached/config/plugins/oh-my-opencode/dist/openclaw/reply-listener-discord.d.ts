import { ReplyListenerRateLimiter } from "./reply-listener-injection";
import { type ReplyListenerDaemonState } from "./reply-listener-state";
import type { OpenClawConfig } from "./types";
export declare function pollDiscordReplies(config: OpenClawConfig, state: ReplyListenerDaemonState, rateLimiter: ReplyListenerRateLimiter): Promise<void>;
