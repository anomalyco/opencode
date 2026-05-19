export type AgentMode = "subagent" | "primary" | "all" | undefined;
export type AgentInfo = {
    name: string;
    mode?: "subagent" | "primary" | "all";
    model?: string | {
        providerID: string;
        modelID: string;
    };
};
export declare function sanitizeSubagentType(subagentType: string): string;
export declare function mergeWithClaudeCodeAgents(serverAgents: AgentInfo[], directory: string | undefined): AgentInfo[];
export declare function isTaskCallableAgentMode(mode: AgentMode): boolean;
export declare function findPrimaryAgentMatch(agents: AgentInfo[], requestedAgentName: string): AgentInfo | undefined;
export declare function findCallableAgentMatch(agents: AgentInfo[], requestedAgentName: string): AgentInfo | undefined;
export declare function listCallableAgentNames(agents: AgentInfo[]): string;
