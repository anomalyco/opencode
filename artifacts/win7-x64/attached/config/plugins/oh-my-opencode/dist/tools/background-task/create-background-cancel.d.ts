import { type ToolDefinition } from "@opencode-ai/plugin";
import type { BackgroundManager } from "../../features/background-agent";
import type { BackgroundCancelClient } from "./clients";
export declare function createBackgroundCancel(manager: BackgroundManager, _client: BackgroundCancelClient): ToolDefinition;
