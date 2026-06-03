import type { InteractiveBashSessionState } from "./types";
export declare function loadInteractiveBashSessionState(sessionID: string): InteractiveBashSessionState | null;
export declare function saveInteractiveBashSessionState(state: InteractiveBashSessionState): void;
export declare function clearInteractiveBashSessionState(sessionID: string): void;
