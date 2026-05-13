/**
 * Claude Code Plugin Types
 *
 * Type definitions for Claude Code plugin system compatibility.
 * Based on https://code.claude.com/docs/en/plugins-reference
 */
export type PluginScope = "user" | "project" | "local" | "managed";
/**
 * Plugin installation entry in installed_plugins.json
 */
export interface PluginInstallation {
    scope: PluginScope;
    installPath: string;
    version: string;
    installedAt: string;
    lastUpdated: string;
    gitCommitSha?: string;
    isLocal?: boolean;
    /**
     * Claude Code records this on project/local-scoped installations.
     * Absolute path (or `~`-prefixed) of the project the plugin was installed for.
     * Used to filter project/local plugins that do not belong to the current cwd.
     */
    projectPath?: string;
}
/**
 * Installed plugins database v1 (legacy)
 * plugins stored as direct objects
 */
export interface InstalledPluginsDatabaseV1 {
    version: 1;
    plugins: Record<string, PluginInstallation>;
}
/**
 * Installed plugins database v2
 * plugins stored as arrays keyed by plugin identifier
 */
export interface InstalledPluginsDatabaseV2 {
    version: 2;
    plugins: Record<string, PluginInstallation[]>;
}
/**
 * Installed plugins database v3 entry (current Claude Code format)
 * A flat array of plugin entries, each containing name and marketplace fields
 * used to construct the plugin key as "name@marketplace".
 */
export interface InstalledPluginEntryV3 {
    name: string;
    marketplace: string;
    scope: PluginScope;
    version: string;
    installPath: string;
    lastUpdated: string;
    gitCommitSha?: string;
    /**
     * Claude Code records this on project/local-scoped installations.
     * Absolute path (or `~`-prefixed) of the project the plugin was installed for.
     */
    projectPath?: string;
}
/**
 * Installed plugins database structure
 * Located at ~/.claude/plugins/installed_plugins.json
 *
 * Supports three formats:
 * - v1: { version: 1, plugins: Record<string, PluginInstallation> }
 * - v2: { version: 2, plugins: Record<string, PluginInstallation[]> }
 * - v3: InstalledPluginEntryV3[] (flat array, current Claude Code format)
 */
export type InstalledPluginsDatabase = InstalledPluginsDatabaseV1 | InstalledPluginsDatabaseV2 | InstalledPluginEntryV3[];
/**
 * Plugin author information
 */
export interface PluginAuthor {
    name?: string;
    email?: string;
    url?: string;
}
/**
 * Plugin manifest (plugin.json)
 * Located at <plugin_root>/.claude-plugin/plugin.json
 */
export interface PluginManifest {
    name: string;
    version?: string;
    description?: string;
    author?: PluginAuthor;
    homepage?: string;
    repository?: string;
    license?: string;
    keywords?: string[];
    commands?: string | string[];
    agents?: string | string[];
    skills?: string | string[];
    hooks?: string | HooksConfig;
    mcpServers?: string | McpServersConfig;
    lspServers?: string | LspServersConfig;
    outputStyles?: string | string[];
}
/**
 * Hooks configuration
 */
export type HookEntry = {
    type: "command";
    command?: string;
} | {
    type: "prompt";
    prompt?: string;
} | {
    type: "agent";
    agent?: string;
} | {
    type: "http";
    url: string;
    headers?: Record<string, string>;
    allowedEnvVars?: string[];
    timeout?: number;
};
export interface HookMatcher {
    matcher?: string;
    hooks: HookEntry[];
}
export interface HooksConfig {
    hooks?: {
        PreToolUse?: HookMatcher[];
        PostToolUse?: HookMatcher[];
        PostToolUseFailure?: HookMatcher[];
        PermissionRequest?: HookMatcher[];
        UserPromptSubmit?: HookMatcher[];
        Notification?: HookMatcher[];
        Stop?: HookMatcher[];
        SubagentStart?: HookMatcher[];
        SubagentStop?: HookMatcher[];
        SessionStart?: HookMatcher[];
        SessionEnd?: HookMatcher[];
        PreCompact?: HookMatcher[];
    };
}
/**
 * MCP servers configuration in plugin
 */
export interface PluginMcpServer {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    type?: "stdio" | "http" | "sse";
    disabled?: boolean;
}
export interface McpServersConfig {
    mcpServers?: Record<string, PluginMcpServer>;
}
/**
 * LSP server configuration
 */
export interface LspServerConfig {
    command: string;
    args?: string[];
    extensionToLanguage: Record<string, string>;
    transport?: "stdio" | "socket";
    env?: Record<string, string>;
    initializationOptions?: Record<string, unknown>;
    settings?: Record<string, unknown>;
    workspaceFolder?: string;
    startupTimeout?: number;
    shutdownTimeout?: number;
    restartOnCrash?: boolean;
    maxRestarts?: number;
    loggingConfig?: {
        args?: string[];
        env?: Record<string, string>;
    };
}
export interface LspServersConfig {
    [language: string]: LspServerConfig;
}
/**
 * Loaded plugin with all resolved components
 */
export interface LoadedPlugin {
    name: string;
    version: string;
    scope: PluginScope;
    installPath: string;
    manifest?: PluginManifest;
    pluginKey: string;
    commandsDir?: string;
    agentsDir?: string;
    skillsDir?: string;
    hooksPath?: string;
    mcpPath?: string;
    lspPath?: string;
}
/**
 * Plugin load result with all components
 */
export interface PluginLoadResult {
    plugins: LoadedPlugin[];
    errors: PluginLoadError[];
}
export interface PluginLoadError {
    pluginKey: string;
    installPath: string;
    error: string;
}
/**
 * Claude settings from ~/.claude/settings.json
 */
export interface ClaudeSettings {
    enabledPlugins?: Record<string, boolean>;
    [key: string]: unknown;
}
/**
 * Plugin loader options
 */
export interface PluginLoaderOptions {
    /**
     * Override the plugins home directory for testing.
     * If not provided, uses CLAUDE_PLUGINS_HOME env var or ~/.claude/plugins
     */
    pluginsHomeOverride?: string;
    /**
     * Override plugin manifest loading for testing.
     * Return null to force plugin name derivation from the plugin key.
     */
    loadPluginManifestOverride?: (installPath: string) => PluginManifest | null;
    /**
     * Override enabled plugins from oh-my-opencode config.
     * Key format: "pluginName@marketplace" (e.g., "shell-scripting@claude-code-workflows")
     * Value: true = enabled, false = disabled
     *
     * This takes precedence over ~/.claude/settings.json enabledPlugins
     */
    enabledPluginsOverride?: Record<string, boolean>;
}
