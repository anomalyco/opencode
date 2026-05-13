import type { CompactionAgentConfigCheckpoint } from "../../shared/compaction-agent-config-checkpoint";
type ResolverContext = {
    client: {
        session: {
            messages: (input: {
                path: {
                    id: string;
                };
            }) => Promise<unknown>;
        };
    };
    directory: string;
};
export declare function resolveSessionPromptConfig(ctx: ResolverContext, sessionID: string): Promise<CompactionAgentConfigCheckpoint>;
export declare function resolveLatestSessionPromptConfig(ctx: ResolverContext, sessionID: string): Promise<CompactionAgentConfigCheckpoint>;
export {};
