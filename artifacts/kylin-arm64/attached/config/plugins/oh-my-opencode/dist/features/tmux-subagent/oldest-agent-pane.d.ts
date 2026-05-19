import type { TmuxPaneInfo } from "./types";
export interface SessionMapping {
    sessionId: string;
    paneId: string;
    createdAt: Date;
}
export declare function findOldestAgentPane(agentPanes: TmuxPaneInfo[], sessionMappings: SessionMapping[]): TmuxPaneInfo | null;
