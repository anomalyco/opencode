export declare const AGENT_NAMES: string[];
export declare const agentPattern: RegExp;
export declare function detectAgentFromSession(sessionID: string): string | undefined;
export declare function normalizeAgentName(agent: string | undefined): string | undefined;
export declare function resolveAgentForSession(sessionID: string, eventAgent?: string): string | undefined;
