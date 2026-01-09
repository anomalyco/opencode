import z from "zod"

export namespace MarketplaceSchema {
  // Source configuration - a GitHub repository containing agents
  export const Source = z
    .object({
      // GitHub repository in format "owner/repo" or full URL
      repo: z.string().describe("GitHub repository in format 'owner/repo'"),
      // Optional branch/tag/commit (defaults to default branch)
      ref: z.string().optional().describe("Branch, tag, or commit SHA (defaults to default branch)"),
      // Optional subdirectory within repo
      path: z.string().optional().describe("Subdirectory path within the repository"),
      // Whether this is a private repository
      private: z.boolean().optional().describe("Whether this is a private repository"),
      // Enable/disable this source
      enabled: z.boolean().optional().default(true).describe("Enable or disable this source"),
      // Optional name override for display
      name: z.string().optional().describe("Display name for this source"),
    })
    .strict()
    .meta({
      ref: "MarketplaceSource",
    })
  export type Source = z.infer<typeof Source>

  // Agent entry in a registry index
  export const AgentEntry = z
    .object({
      // Relative path to agent file from registry root
      path: z.string().describe("Relative path to the agent markdown file"),
      // Metadata extracted from frontmatter
      name: z.string().describe("Agent name"),
      description: z.string().optional().describe("Agent description"),
      mode: z.enum(["subagent", "primary", "all"]).optional().describe("Agent mode"),
      color: z.string().optional().describe("Hex color code for the agent"),
      // Additional searchable tags
      tags: z.array(z.string()).optional().describe("Searchable tags"),
      // Version info
      version: z.string().optional().describe("Semantic version"),
      // Author info
      author: z.string().optional().describe("Author name or GitHub username"),
    })
    .strict()
    .meta({
      ref: "MarketplaceAgentEntry",
    })
  export type AgentEntry = z.infer<typeof AgentEntry>

  // Skill entry (for future expansion)
  export const SkillEntry = z
    .object({
      path: z.string(),
      name: z.string(),
      description: z.string().optional(),
      triggers: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      version: z.string().optional(),
      author: z.string().optional(),
    })
    .strict()
    .meta({
      ref: "MarketplaceSkillEntry",
    })
  export type SkillEntry = z.infer<typeof SkillEntry>

  // Plugin entry (for future expansion)
  export const PluginEntry = z
    .object({
      path: z.string(),
      name: z.string(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      version: z.string().optional(),
      author: z.string().optional(),
    })
    .strict()
    .meta({
      ref: "MarketplacePluginEntry",
    })
  export type PluginEntry = z.infer<typeof PluginEntry>

  // MCP entry (for future expansion)
  export const McpEntry = z
    .object({
      path: z.string(),
      name: z.string(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      version: z.string().optional(),
      author: z.string().optional(),
    })
    .strict()
    .meta({
      ref: "MarketplaceMcpEntry",
    })
  export type McpEntry = z.infer<typeof McpEntry>

  // Registry index file schema (registry.json in source repos)
  export const RegistryIndex = z
    .object({
      version: z.literal("1").describe("Registry schema version"),
      name: z.string().describe("Registry name"),
      description: z.string().optional().describe("Registry description"),
      // Content types available in this registry
      types: z
        .array(z.enum(["agent", "skill", "plugin", "tool", "mcp"]))
        .default(["agent"])
        .describe("Content types available in this registry"),
      // List of agents with metadata
      agents: z.array(AgentEntry).optional().describe("Available agents"),
      // Future: skills, plugins, tools, mcp servers
      skills: z.array(SkillEntry).optional().describe("Available skills"),
      plugins: z.array(PluginEntry).optional().describe("Available plugins"),
      mcp: z.array(McpEntry).optional().describe("Available MCP server configurations"),
    })
    .strict()
    .meta({
      ref: "MarketplaceRegistry",
    })
  export type RegistryIndex = z.infer<typeof RegistryIndex>

  // Cached source metadata
  export const CachedSource = z
    .object({
      source: Source,
      registry: RegistryIndex,
      lastFetched: z.number().describe("Unix timestamp of last fetch"),
      etag: z.string().optional().describe("ETag for conditional requests"),
    })
    .strict()
    .meta({
      ref: "MarketplaceCachedSource",
    })
  export type CachedSource = z.infer<typeof CachedSource>

  // Installed agent record
  export const InstalledAgent = z
    .object({
      // Source repo reference
      source: z.string().describe("Source repository"),
      // Path within source
      sourcePath: z.string().describe("Path within source repository"),
      // Local installation path
      localPath: z.string().describe("Local file path where agent is installed"),
      // Version/commit at installation
      installedRef: z.string().describe("Git ref at time of installation"),
      // Installation timestamp
      installedAt: z.number().describe("Unix timestamp of installation"),
    })
    .strict()
    .meta({
      ref: "MarketplaceInstalledAgent",
    })
  export type InstalledAgent = z.infer<typeof InstalledAgent>

  // Marketplace config for Config.Info
  export const Config = z
    .object({
      sources: z.array(Source).optional().describe("Marketplace sources (GitHub repositories)"),
      // Cache duration in milliseconds (default: 1 hour)
      cacheDuration: z
        .number()
        .optional()
        .default(3600000)
        .describe("Cache duration in milliseconds (default: 1 hour)"),
      // Enable marketplace features
      enabled: z.boolean().optional().default(true).describe("Enable marketplace features"),
    })
    .strict()
    .meta({
      ref: "MarketplaceConfig",
    })
  export type Config = z.infer<typeof Config>
}
