import type { PluginInput } from "@opencode-ai/plugin";
import type { ContextCollector } from "../../features/context-injector";
import type { RalphLoopHook } from "../ralph-loop";
export declare function createKeywordDetectorHook(ctx: PluginInput, _collector?: ContextCollector, _ralphLoop?: Pick<RalphLoopHook, "startLoop">): {
    "chat.message": (input: {
        sessionID: string;
        agent?: string;
        model?: {
            providerID: string;
            modelID: string;
        };
        messageID?: string;
        variant?: string;
    }, output: {
        message: Record<string, unknown>;
        parts: Array<{
            type: string;
            text?: string;
            [key: string]: unknown;
        }>;
    }) => Promise<void>;
};
