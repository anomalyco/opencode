import type { PluginInput } from "@opencode-ai/plugin";
import type { MessageWithInfo, ResolveLatestMessageInfoResult } from "./types";
export declare function resolveLatestMessageInfo(ctx: PluginInput, sessionID: string, prefetchedMessages?: MessageWithInfo[]): Promise<ResolveLatestMessageInfoResult>;
