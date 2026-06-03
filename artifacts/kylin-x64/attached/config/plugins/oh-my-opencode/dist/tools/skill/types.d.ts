import type { SkillScope, LoadedSkill } from "../../features/opencode-skill-loader/types";
import type { SkillMcpManager } from "../../features/skill-mcp-manager";
import type { BrowserAutomationProvider, GitMasterConfig } from "../../config/schema";
import type { CommandInfo } from "../slashcommand/types";
export interface SkillArgs {
    name: string;
    user_message?: string;
}
export interface SkillInfo {
    name: string;
    description: string;
    location?: string;
    scope: SkillScope;
    license?: string;
    compatibility?: string;
    metadata?: Record<string, string>;
    allowedTools?: string[];
}
export interface SkillLoadOptions {
    /** When true, only load from OpenCode paths (.opencode/skills/, ~/.config/opencode/skills/) */
    opencodeOnly?: boolean;
    /** Pre-merged skills to use instead of discovering */
    skills?: LoadedSkill[];
    /** Pre-discovered commands to use instead of discovering */
    commands?: CommandInfo[];
    /** MCP manager for querying skill-embedded MCP servers */
    mcpManager?: SkillMcpManager;
    /** Session ID getter for MCP client identification */
    getSessionID?: () => string | undefined;
    /** Git master configuration for watermark/co-author settings */
    gitMasterConfig?: GitMasterConfig;
    disabledSkills?: Set<string>;
    /** Browser automation provider for provider-gated skill filtering */
    browserProvider?: BrowserAutomationProvider;
    /** Include Claude marketplace plugin commands in discovery (default: true) */
    pluginsEnabled?: boolean;
    /** Override plugin enablement from Claude settings by plugin key */
    enabledPluginsOverride?: Record<string, boolean>;
    /** Native skill accessor from PluginInput for discovering skills registered via config.skills.paths */
    nativeSkills?: {
        all(): {
            name: string;
            description: string;
            location: string;
            content: string;
        }[] | Promise<{
            name: string;
            description: string;
            location: string;
            content: string;
        }[]>;
        get(name: string): {
            name: string;
            description: string;
            location: string;
            content: string;
        } | undefined | Promise<{
            name: string;
            description: string;
            location: string;
            content: string;
        } | undefined>;
        dirs(): string[] | Promise<string[]>;
    };
}
