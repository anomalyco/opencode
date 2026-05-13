import type { InteractiveBashSessionState } from "./types";
type AbortSession = (args: {
    path: {
        id: string;
    };
}) => Promise<unknown>;
export declare function createInteractiveBashSessionTracker(options: {
    abortSession: AbortSession;
}): {
    getOrCreateState: (sessionID: string) => InteractiveBashSessionState;
    handleSessionDeleted: (sessionID: string) => Promise<void>;
    handleTmuxCommand: (input: {
        sessionID: string;
        subCommand: string;
        sessionName: string | null;
        toolOutput: string;
    }) => {
        reminderToAppend: string | null;
    };
};
export {};
