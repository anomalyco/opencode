import type { SkillMcpConfig } from "../skill-mcp-manager/types";
export declare function parseSkillMcpConfigFromFrontmatter(content: string): SkillMcpConfig | undefined;
export declare function loadMcpJsonFromDir(skillDir: string): Promise<SkillMcpConfig | undefined>;
