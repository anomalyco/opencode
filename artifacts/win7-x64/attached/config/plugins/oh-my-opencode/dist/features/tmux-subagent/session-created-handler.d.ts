import type { PluginInput } from "@opencode-ai/plugin";
import type { TmuxConfig } from "../../config/schema";
import type { CapacityConfig, TrackedSession } from "./types";
import { type SessionMapping } from "./decision-engine";
import type { SessionCreatedEvent } from "./session-created-event";
type OpencodeClient = PluginInput["client"];
export interface SessionCreatedHandlerDeps {
    client: OpencodeClient;
    tmuxConfig: TmuxConfig;
    serverUrl: string;
    sourcePaneId: string | undefined;
    sessions: Map<string, TrackedSession>;
    pendingSessions: Set<string>;
    isInsideTmux: () => boolean;
    isEnabled: () => boolean;
    getCapacityConfig: () => CapacityConfig;
    getSessionMappings: () => SessionMapping[];
    waitForSessionReady: (sessionId: string) => Promise<boolean>;
    startPolling: () => void;
}
export declare function handleSessionCreated(deps: SessionCreatedHandlerDeps, event: SessionCreatedEvent): Promise<void>;
export {};
