import type { SkillMcpManager } from "../../features/skill-mcp-manager";
import type { LoadedSkill } from "../../features/opencode-skill-loader";
export declare function formatMcpCapabilities(skill: LoadedSkill, manager: SkillMcpManager, sessionID: string): Promise<string | null>;
