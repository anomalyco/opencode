import { type LoadedSkill } from "../../features/opencode-skill-loader";
import type { ParsedSlashCommand } from "./types";
export interface ExecutorOptions {
    skills?: LoadedSkill[];
    pluginsEnabled?: boolean;
    enabledPluginsOverride?: Record<string, boolean>;
    agent?: string;
    directory?: string;
}
export interface ExecuteResult {
    success: boolean;
    replacementText?: string;
    error?: string;
}
export declare function executeSlashCommand(parsed: ParsedSlashCommand, options?: ExecutorOptions): Promise<ExecuteResult>;
