import type { PluginInput } from "@opencode-ai/plugin";
import type { TmuxConfig } from "../../config/schema";
import type { TrackedSession } from "./types";
type OpencodeClient = PluginInput["client"];
export interface SessionPollingController {
    startPolling: () => void;
    stopPolling: () => void;
    closeSessionById: (sessionId: string) => Promise<void>;
    waitForSessionReady: (sessionId: string) => Promise<boolean>;
    pollSessions: () => Promise<void>;
}
export declare function createSessionPollingController(params: {
    client: OpencodeClient;
    tmuxConfig: TmuxConfig;
    serverUrl: string;
    sourcePaneId: string | undefined;
    sessions: Map<string, TrackedSession>;
}): SessionPollingController;
export {};
