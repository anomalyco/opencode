import type { PluginInput } from "@opencode-ai/plugin";
import type { ExperimentalConfig } from "../../config";
interface MessageInfo {
    id?: string;
    role?: string;
    sessionID?: string;
    parentID?: string;
    error?: unknown;
}
export interface SessionRecoveryOptions {
    experimental?: ExperimentalConfig;
}
export interface SessionRecoveryHook {
    handleSessionRecovery: (info: MessageInfo) => Promise<boolean>;
    isRecoverableError: (error: unknown) => boolean;
    setOnAbortCallback: (callback: (sessionID: string) => void) => void;
    setOnRecoveryCompleteCallback: (callback: (sessionID: string) => void) => void;
}
export declare function createSessionRecoveryHook(ctx: PluginInput, options?: SessionRecoveryOptions): SessionRecoveryHook;
export {};
