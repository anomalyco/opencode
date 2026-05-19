import type { AgentPromptMetadata } from "./types";
type RegisteredAgentSummary = {
    name: string;
    description: string;
};
export declare function parseRegisteredAgentSummaries(input: unknown): RegisteredAgentSummary[];
export declare function buildCustomAgentMetadata(agentName: string, description: string): AgentPromptMetadata;
export {};
