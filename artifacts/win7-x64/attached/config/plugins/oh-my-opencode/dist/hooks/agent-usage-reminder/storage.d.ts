import type { AgentUsageState } from "./types";
export declare function loadAgentUsageState(sessionID: string): AgentUsageState | null;
export declare function saveAgentUsageState(state: AgentUsageState): void;
export declare function clearAgentUsageState(sessionID: string): void;
