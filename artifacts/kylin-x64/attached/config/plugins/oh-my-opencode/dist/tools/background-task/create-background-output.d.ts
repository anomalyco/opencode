import { type ToolDefinition } from "@opencode-ai/plugin";
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients";
export declare function createBackgroundOutput(manager: BackgroundOutputManager, client: BackgroundOutputClient): ToolDefinition;
