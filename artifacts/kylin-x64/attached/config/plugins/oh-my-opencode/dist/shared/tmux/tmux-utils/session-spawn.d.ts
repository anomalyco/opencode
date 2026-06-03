import type { TmuxConfig } from "../../../config/schema";
import type { SpawnPaneResult } from "../types";
export declare function spawnTmuxSession(sessionId: string, description: string, config: TmuxConfig, serverUrl: string, sourcePaneId?: string): Promise<SpawnPaneResult>;
