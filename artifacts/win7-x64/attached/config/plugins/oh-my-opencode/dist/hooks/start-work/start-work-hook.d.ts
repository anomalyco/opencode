import type { PluginInput } from "@opencode-ai/plugin";
export declare const HOOK_NAME: "start-work";
interface StartWorkHookInput {
    sessionID: string;
    messageID?: string;
}
interface StartWorkCommandExecuteBeforeInput {
    sessionID: string;
    command: string;
    arguments: string;
}
interface StartWorkHookOutput {
    message?: Record<string, unknown>;
    parts: Array<{
        type: string;
        text?: string;
    }>;
}
export declare function createStartWorkHook(ctx: PluginInput): {
    "chat.message": (input: StartWorkHookInput, output: StartWorkHookOutput) => Promise<void>;
    "command.execute.before": (input: StartWorkCommandExecuteBeforeInput, output: StartWorkHookOutput) => Promise<void>;
};
export {};
