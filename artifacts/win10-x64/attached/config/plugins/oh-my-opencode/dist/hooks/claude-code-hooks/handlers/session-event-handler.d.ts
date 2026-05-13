import type { PluginInput } from "@opencode-ai/plugin";
import type { ContextCollector } from "../../../features/context-injector";
import type { PluginConfig } from "../types";
export declare function createSessionEventHandler(ctx: PluginInput, config: PluginConfig, contextCollector?: ContextCollector): (input: {
    event: {
        type: string;
        properties?: unknown;
    };
}) => Promise<void>;
export declare function disposeSessionEventHandler(contextCollector?: ContextCollector): void;
