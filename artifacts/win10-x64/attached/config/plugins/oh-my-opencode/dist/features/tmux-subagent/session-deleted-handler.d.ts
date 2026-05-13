import type { TmuxConfig } from "../../config/schema";
import type { TrackedSession } from "./types";
import { type SessionMapping } from "./decision-engine";
export interface SessionDeletedHandlerDeps {
    tmuxConfig: TmuxConfig;
    serverUrl: string;
    sourcePaneId: string | undefined;
    sessions: Map<string, TrackedSession>;
    isEnabled: () => boolean;
    getSessionMappings: () => SessionMapping[];
    stopPolling: () => void;
}
export declare function handleSessionDeleted(deps: SessionDeletedHandlerDeps, event: {
    sessionID: string;
}): Promise<void>;
