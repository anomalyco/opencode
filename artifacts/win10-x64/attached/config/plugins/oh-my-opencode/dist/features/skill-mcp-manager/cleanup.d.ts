import type { SkillMcpManagerState } from "./types";
export declare function registerProcessCleanup(state: SkillMcpManagerState): void;
export declare function unregisterProcessCleanup(state: SkillMcpManagerState): void;
export declare function startCleanupTimer(state: SkillMcpManagerState): void;
export declare function stopCleanupTimer(state: SkillMcpManagerState): void;
export declare function disconnectSession(state: SkillMcpManagerState, sessionID: string): Promise<void>;
export declare function disconnectAll(state: SkillMcpManagerState): Promise<void>;
export declare function forceReconnect(state: SkillMcpManagerState, clientKey: string): Promise<boolean>;
