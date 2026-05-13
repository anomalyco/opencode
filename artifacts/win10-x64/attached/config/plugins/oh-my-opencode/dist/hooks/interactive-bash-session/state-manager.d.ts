import type { InteractiveBashSessionState } from "./types";
export declare function getOrCreateState(sessionID: string, sessionStates: Map<string, InteractiveBashSessionState>): InteractiveBashSessionState;
export declare function isOmoSession(sessionName: string | null): boolean;
export declare function killAllTrackedSessions(state: InteractiveBashSessionState): Promise<void>;
