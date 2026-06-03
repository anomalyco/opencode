export interface SkillMcpArgs {
    mcp_name: string;
    tool_name?: string;
    resource_name?: string;
    prompt_name?: string;
    arguments?: string | Record<string, unknown>;
    grep?: string;
}
