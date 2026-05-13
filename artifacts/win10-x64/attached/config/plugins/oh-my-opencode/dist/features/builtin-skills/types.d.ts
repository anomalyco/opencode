import type { SkillMcpConfig } from "../skill-mcp-manager/types";
export interface BuiltinSkill {
    name: string;
    description: string;
    template: string;
    license?: string;
    compatibility?: string;
    metadata?: Record<string, unknown>;
    allowedTools?: string[];
    agent?: string;
    model?: string;
    subtask?: boolean;
    argumentHint?: string;
    mcpConfig?: SkillMcpConfig;
}
