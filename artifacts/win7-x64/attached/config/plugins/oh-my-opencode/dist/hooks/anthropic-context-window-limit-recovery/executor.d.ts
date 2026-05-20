import type { AutoCompactState } from "./types";
import type { OhMyOpenCodeConfig } from "../../config";
import type { ExperimentalConfig } from "../../config";
import type { Client } from "./client";
export { getLastAssistant } from "./message-builder";
export declare function executeCompact(sessionID: string, msg: Record<string, unknown>, autoCompactState: AutoCompactState, client: Client, directory: string, pluginConfig: OhMyOpenCodeConfig, _experimental?: ExperimentalConfig): Promise<void>;
