import type { CallOmoAgentArgs } from "./types";
import type { BackgroundManager } from "../../features/background-agent";
import type { PluginInput } from "@opencode-ai/plugin";
import type { DelegatedModelConfig } from "../../shared/model-resolution-types";
import type { FallbackEntry } from "../../shared/model-requirements";
export declare function executeBackground(args: CallOmoAgentArgs, toolContext: {
    sessionID: string;
    messageID: string;
    agent: string;
    abort: AbortSignal;
    metadata?: (input: {
        title?: string;
        metadata?: Record<string, unknown>;
    }) => void;
}, manager: BackgroundManager, client: PluginInput["client"], fallbackChain?: FallbackEntry[], model?: DelegatedModelConfig): Promise<string>;
