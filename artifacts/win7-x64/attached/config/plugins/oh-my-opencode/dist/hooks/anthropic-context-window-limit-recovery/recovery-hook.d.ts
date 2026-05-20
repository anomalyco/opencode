import type { PluginInput } from "@opencode-ai/plugin";
import type { ExperimentalConfig, OhMyOpenCodeConfig } from "../../config";
import { parseAnthropicTokenLimitError } from "./parser";
import { executeCompact, getLastAssistant } from "./executor";
import { log } from "../../shared/logger";
export interface AnthropicContextWindowLimitRecoveryOptions {
    experimental?: ExperimentalConfig;
    pluginConfig: OhMyOpenCodeConfig;
    dependencies?: {
        executeCompact?: typeof executeCompact;
        getLastAssistant?: typeof getLastAssistant;
        log?: typeof log;
        parseAnthropicTokenLimitError?: typeof parseAnthropicTokenLimitError;
    };
}
export declare function createAnthropicContextWindowLimitRecoveryHook(ctx: PluginInput, options?: AnthropicContextWindowLimitRecoveryOptions): {
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    dispose: () => void;
};
