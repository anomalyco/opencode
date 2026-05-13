import type { PluginInput } from "@opencode-ai/plugin";
export interface CompactionTodoPreserver {
    capture: (sessionID: string) => Promise<void>;
    event: (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
}
export declare function createCompactionTodoPreserverHook(ctx: PluginInput): CompactionTodoPreserver;
