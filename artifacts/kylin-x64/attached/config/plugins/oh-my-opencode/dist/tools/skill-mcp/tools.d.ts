import { type ToolDefinition } from "@opencode-ai/plugin";
import type { SkillMcpManager } from "../../features/skill-mcp-manager";
import type { LoadedSkill } from "../../features/opencode-skill-loader/types";
interface SkillMcpToolOptions {
    manager: SkillMcpManager;
    getLoadedSkills: () => LoadedSkill[];
    getSessionID?: () => string | undefined;
}
export declare function applyGrepFilter(output: string, pattern: string | undefined): string;
export declare function createSkillMcpTool(options: SkillMcpToolOptions): ToolDefinition;
export {};
