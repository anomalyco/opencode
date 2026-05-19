import type { TmuxConfig } from "../../../config/schema";
import type { SpawnPaneResult } from "../types";
import type { SplitDirection } from "./environment";
export declare function spawnTmuxPane(sessionId: string, description: string, config: TmuxConfig, serverUrl: string, targetPaneId?: string, splitDirection?: SplitDirection): Promise<SpawnPaneResult>;
