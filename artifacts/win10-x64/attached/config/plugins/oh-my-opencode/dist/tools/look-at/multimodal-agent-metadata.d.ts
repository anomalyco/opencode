import type { PluginInput } from "@opencode-ai/plugin";
type AgentModel = {
    providerID: string;
    modelID: string;
};
type ResolvedAgentMetadata = {
    agentModel?: AgentModel;
    agentVariant?: string;
};
export declare function resolveMultimodalLookerAgentMetadata(ctx: PluginInput): Promise<ResolvedAgentMetadata>;
export {};
