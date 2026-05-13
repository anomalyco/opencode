export declare const subagentSessions: Set<string>;
export declare const syncSubagentSessions: Set<string>;
export declare function setMainSession(id: string | undefined): void;
export declare function getMainSessionID(): string | undefined;
export declare function registerAgentName(name: string): void;
export declare function isAgentRegistered(name: string): boolean;
export declare function resolveRegisteredAgentName(name: string | undefined): string | undefined;
/** @internal For testing only */
export declare function _resetForTesting(): void;
export declare function setSessionAgent(sessionID: string, agent: string): void;
export declare function updateSessionAgent(sessionID: string, agent: string): void;
export declare function getSessionAgent(sessionID: string): string | undefined;
export declare function clearSessionAgent(sessionID: string): void;
