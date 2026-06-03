import type { CapacityConfig, PaneAction, SpawnDecision, WindowState } from "./types";
import { type SessionMapping } from "./oldest-agent-pane";
export declare function decideSpawnActions(state: WindowState, sessionId: string, description: string, config: CapacityConfig, sessionMappings: SessionMapping[]): SpawnDecision;
export declare function decideCloseAction(state: WindowState, sessionId: string, sessionMappings: SessionMapping[]): PaneAction | null;
