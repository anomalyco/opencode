import { type ToolDefinition } from "@opencode-ai/plugin";
import type { DelegateTaskToolOptions } from "./types";
export { resolveCategoryConfig } from "./categories";
export type { SyncSessionCreatedEvent, DelegateTaskToolOptions, BuildSystemContentInput } from "./types";
export { buildSystemContent, buildTaskPrompt } from "./prompt-builder";
export declare function createDelegateTask(options: DelegateTaskToolOptions): ToolDefinition;
