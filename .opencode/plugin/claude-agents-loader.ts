/**
 * Claude Agents Loader Plugin
 * 
 * Loads agent definitions from ~/.claude/agents/*.md and converts them
 * to OpenCode agent format for compatibility with Claude Desktop agents.
 * 
 * Features:
 * - Discovers .md files in ~/.claude/agents/
 * - Parses Claude Desktop frontmatter format
 * - Converts to OpenCode agent configuration
 * - Merges into config.agent
 */

import { type Plugin } from "@opencode-ai/plugin"
import { join } from "path"
import { homedir } from "os"
import matter from "gray-matter"
import { z } from "zod"

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

const ClaudeFormat = z.object({
  name: z.string(),
  description: z.string(),
  model: z.string().optional(),
  color: z.string().optional(),
})

interface ClaudeAgent {
  name: string
  description: string
  model?: string
  color?: string
  prompt: string
  mode: "primary"
}

// ============================================================================
// CLAUDE AGENTS LOADER
// ============================================================================

async function loadClaudeAgents(dir: string): Promise<Record<string, ClaudeAgent>> {
  const result: Record<string, ClaudeAgent> = {}

  const glob = new Bun.Glob("*.md")

  for await (const item of glob.scan({
    absolute: true,
    followSymlinks: true,
    cwd: dir,
  })) {
    try {
      const content = await Bun.file(item).text()
      const md = matter(content)

      if (!md.data) {
        continue
      }

      const parsed = ClaudeFormat.safeParse(md.data)
      if (!parsed.success) {
        continue
      }

      const agentName = parsed.data.name.toLowerCase().replace(/\s+/g, "-")

      const config: ClaudeAgent = {
        name: agentName,
        description: parsed.data.description,
        model: parsed.data.model,
        prompt: md.content.trim(),
        mode: "primary" as const,
      }

      result[agentName] = config
      //console.log(`[ClaudeAgentsLoader] Loaded Claude agent: ${agentName} from ${item}`)
    } catch (err) {
      //console.warn(`[ClaudeAgentsLoader] Failed to load Claude agent from ${item}:`, err)
    }
  }

  return result
}

// ============================================================================
// PLUGIN EXPORT
// ============================================================================

export const ClaudeAgentsLoaderPlugin: Plugin = async (ctx) => {
  return {
    config: async (config) => {
      const claudeAgentDir = join(homedir(), ".claude", "agents")

      try {
        // Check if directory exists
        const stats = await Bun.file(join(claudeAgentDir, ".keep")).exists()
        
        // Try to load agents
        const agents = await loadClaudeAgents(claudeAgentDir)

        // Merge into config.agent
        if (!config.agent) {
          config.agent = {}
        }

        for (const [name, agent] of Object.entries(agents)) {
          config.agent[name] = agent
        }

        if (Object.keys(agents).length > 0) {
          //console.log(
          //  `[ClaudeAgentsLoader] Loaded ${Object.keys(agents).length} Claude agent(s): ${Object.keys(agents).join(", ")}`,
         // )
        }
      } catch (err) {
        // Directory doesn't exist or other error - silently skip
        console.log("[ClaudeAgentsLoader] No Claude agents directory found, skipping")
      }
    },
  }
}
