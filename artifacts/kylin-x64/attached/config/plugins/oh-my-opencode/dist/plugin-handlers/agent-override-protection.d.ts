export declare function normalizeProtectedAgentName(agentName: string): string;
export declare function createProtectedAgentNameSet(agentNames: Iterable<string>): Set<string>;
export declare function filterProtectedAgentOverrides<TAgent>(agents: Record<string, TAgent>, protectedAgentNames: ReadonlySet<string>): Record<string, TAgent>;
