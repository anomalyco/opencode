import type { TmuxConfig } from "../../config/schema";
import type { TrackedSession } from "./types";
export declare function cleanupTmuxSessions(params: {
    tmuxConfig: TmuxConfig;
    serverUrl: string;
    sourcePaneId: string | undefined;
    sessions: Map<string, TrackedSession>;
    stopPolling: () => void;
}): Promise<void>;
