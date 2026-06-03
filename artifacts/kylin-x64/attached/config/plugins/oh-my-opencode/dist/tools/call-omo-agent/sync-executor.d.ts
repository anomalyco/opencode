import type { CallOmoAgentArgs } from "./types";
import type { PluginInput } from "@opencode-ai/plugin";
import { clearSessionFallbackChain, setSessionFallbackChain } from "../../hooks/model-fallback/hook";
import type { DelegatedModelConfig } from "../../shared/model-resolution-types";
import type { FallbackEntry } from "../../shared/model-requirements";
import { waitForCompletion } from "./completion-poller";
import { processMessages } from "./message-processor";
import { createOrGetSession } from "./session-creator";
type ExecuteSyncDeps = {
    createOrGetSession: typeof createOrGetSession;
    waitForCompletion: typeof waitForCompletion;
    processMessages: typeof processMessages;
    setSessionFallbackChain: typeof setSessionFallbackChain;
    clearSessionFallbackChain: typeof clearSessionFallbackChain;
};
type SpawnReservation = {
    commit: () => number;
    rollback: () => void;
};
export declare function executeSync(args: CallOmoAgentArgs, toolContext: {
    sessionID: string;
    messageID: string;
    agent: string;
    abort: AbortSignal;
    metadata?: (input: {
        title?: string;
        metadata?: Record<string, unknown>;
    }) => void | Promise<void>;
}, ctx: PluginInput, deps?: ExecuteSyncDeps, fallbackChain?: FallbackEntry[], spawnReservation?: SpawnReservation, model?: DelegatedModelConfig): Promise<string>;
export {};
