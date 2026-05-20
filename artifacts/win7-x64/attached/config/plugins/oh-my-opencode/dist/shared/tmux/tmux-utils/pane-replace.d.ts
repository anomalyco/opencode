import type { TmuxConfig } from "../../../config/schema";
import type { SpawnPaneResult } from "../types";
export declare function replaceTmuxPane(paneId: string, sessionId: string, description: string, config: TmuxConfig, serverUrl: string): Promise<SpawnPaneResult>;
