import type { PluginInput } from "@opencode-ai/plugin";
import type { PluginConfig } from "./types";
import type { ContextCollector } from "../../features/context-injector";
export declare function createClaudeCodeHooksHook(ctx: PluginInput, config?: PluginConfig, contextCollector?: ContextCollector): {
    "experimental.session.compacting": (input: {
        sessionID: string;
    }, output: {
        context: string[];
    }) => Promise<void>;
    "chat.message": (input: {
        sessionID: string;
        agent?: string;
        model?: {
            providerID: string;
            modelID: string;
        };
        messageID?: string;
    }, output: {
        message: Record<string, unknown>;
        parts: Array<{
            type: string;
            text?: string;
            [key: string]: unknown;
        }>;
    }) => Promise<void>;
    "tool.execute.before": (input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, output: {
        args: Record<string, unknown>;
    }) => Promise<void>;
    "tool.execute.after": (input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, output: {
        title: string;
        output: string;
        metadata: unknown;
    } | undefined) => Promise<void>;
    event: (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    dispose: () => void;
};
