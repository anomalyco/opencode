import path from "path"
import fs from "fs/promises"
import { Config } from "../config/config"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { MarketplaceSchema } from "./schema"
import { MarketplaceCache } from "./cache"
import { MarketplaceGitHub } from "./github"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import fuzzysort from "fuzzysort"

export namespace Marketplace {
  const log = Log.create({ service: "marketplace" })

  // Errors
  export const AgentExistsError = NamedError.create(
    "MarketplaceAgentExistsError",
    z.object({
      path: z.string(),
      name: z.string(),
    }),
  )

  export const SourceNotFoundError = NamedError.create(
    "MarketplaceSourceNotFoundError",
    z.object({
      repo: z.string(),
    }),
  )

  export const AgentNotFoundError = NamedError.create(
    "MarketplaceAgentNotFoundError",
    z.object({
      name: z.string(),
      source: z.string().optional(),
    }),
  )

  export const RegistryFetchError = NamedError.create(
    "MarketplaceRegistryFetchError",
    z.object({
      repo: z.string(),
      message: z.string(),
    }),
  )

  // Agent with source info for display/installation
  export interface MarketplaceAgent {
    source: MarketplaceSchema.Source
    agent: MarketplaceSchema.AgentEntry
    installed: boolean
    installedPath?: string
  }

  // Check if marketplace is enabled
  export async function isEnabled(): Promise<boolean> {
    const config = await Config.get()
    return config.marketplace?.enabled !== false
  }

  // List all configured sources
  export async function listSources(): Promise<MarketplaceSchema.Source[]> {
    const config = await Config.get()
    const sources = config.marketplace?.sources ?? []
    return sources.filter((s) => s.enabled !== false)
  }

  // Get a specific source by repo
  export async function getSource(repo: string): Promise<MarketplaceSchema.Source | null> {
    const sources = await listSources()
    return sources.find((s) => s.repo === repo) ?? null
  }

  // Get all agents from all sources
  export async function listAgents(options?: {
    refresh?: boolean
    source?: string
  }): Promise<MarketplaceAgent[]> {
    const sources = await listSources()
    const config = await Config.get()
    const cacheDuration = config.marketplace?.cacheDuration ?? 3600000

    const results: MarketplaceAgent[] = []
    const installedAgents = await getInstalledAgents()

    for (const source of sources) {
      if (options?.source && source.repo !== options.source) continue

      try {
        const cached = await MarketplaceCache.getRegistry(source, {
          refresh: options?.refresh,
          cacheDuration,
        })

        for (const agent of cached.registry.agents ?? []) {
          const installedPath = installedAgents.get(`${source.repo}:${agent.path}`)
          results.push({
            source,
            agent,
            installed: !!installedPath,
            installedPath,
          })
        }
      } catch (error) {
        log.error("failed to fetch registry", { repo: source.repo, error })
        // Continue with other sources
      }
    }

    return results
  }

  // Search agents across all sources
  export async function searchAgents(query: string): Promise<MarketplaceAgent[]> {
    const agents = await listAgents()

    if (!query.trim()) {
      return agents
    }

    // Prepare data for fuzzy search
    const searchableAgents = agents.map((a) => ({
      ...a,
      searchName: a.agent.name,
      searchDescription: a.agent.description ?? "",
      searchTags: (a.agent.tags ?? []).join(" "),
    }))

    const results = fuzzysort.go(query, searchableAgents, {
      keys: ["searchName", "searchDescription", "searchTags"],
      threshold: -10000,
    })

    return results.map((r) => r.obj)
  }

  // Get an agent by name (optionally filtered by source)
  export async function getAgent(
    name: string,
    sourceRepo?: string,
  ): Promise<MarketplaceAgent | null> {
    const agents = await listAgents({ source: sourceRepo })
    return agents.find((a) => a.agent.name === name) ?? null
  }

  // Fetch agent content from source
  async function fetchAgentContent(
    source: MarketplaceSchema.Source,
    agentPath: string,
  ): Promise<string> {
    const basePath = source.path ? `${source.path}/${agentPath}` : agentPath

    const { content } = await MarketplaceGitHub.getRawContent(source.repo, basePath, source.ref)

    return content
  }

  // Get map of installed agents: "source:path" -> local path
  async function getInstalledAgents(): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    const dataPath = path.join(Global.Path.data, "marketplace", "installed.json")

    try {
      const data = await Bun.file(dataPath).json()
      const records = z.array(MarketplaceSchema.InstalledAgent).parse(data)
      for (const record of records) {
        map.set(`${record.source}:${record.sourcePath}`, record.localPath)
      }
    } catch {
      // No installed agents file
    }

    return map
  }

  // Save installed agent record
  async function saveInstalledAgent(record: MarketplaceSchema.InstalledAgent): Promise<void> {
    const dataPath = path.join(Global.Path.data, "marketplace", "installed.json")
    await fs.mkdir(path.dirname(dataPath), { recursive: true })

    const existing = await getInstalledAgents()
    existing.set(`${record.source}:${record.sourcePath}`, record.localPath)

    const records: MarketplaceSchema.InstalledAgent[] = []
    // Rebuild from map (we need to reconstruct full records)
    const allData = await Bun.file(dataPath)
      .json()
      .catch(() => [])
    const existingRecords = z.array(MarketplaceSchema.InstalledAgent).parse(allData).filter(
      (r) => r.source !== record.source || r.sourcePath !== record.sourcePath,
    )
    records.push(...existingRecords, record)

    await Bun.write(dataPath, JSON.stringify(records, null, 2))
  }

  // Remove installed agent record
  async function removeInstalledAgent(source: string, sourcePath: string): Promise<void> {
    const dataPath = path.join(Global.Path.data, "marketplace", "installed.json")

    try {
      const data = await Bun.file(dataPath).json()
      const records = z.array(MarketplaceSchema.InstalledAgent).parse(data)
      const filtered = records.filter((r) => r.source !== source || r.sourcePath !== sourcePath)
      await Bun.write(dataPath, JSON.stringify(filtered, null, 2))
    } catch {
      // File doesn't exist
    }
  }

  // Install an agent from a source
  export async function installAgent(options: {
    source: MarketplaceSchema.Source
    agentPath: string
    scope: "global" | "project"
    force?: boolean
  }): Promise<string> {
    const { source, agentPath, scope, force = false } = options

    log.info("installing agent", { source: source.repo, path: agentPath, scope })

    // Fetch agent content from GitHub
    const content = await fetchAgentContent(source, agentPath)

    // Determine target directory
    const targetDir =
      scope === "global"
        ? path.join(Global.Path.config, "agent")
        : path.join(Instance.worktree, ".opencode", "agent")

    // Extract agent filename
    const filename = path.basename(agentPath)
    const targetPath = path.join(targetDir, filename)

    // Check for conflicts
    if (!force && (await Bun.file(targetPath).exists())) {
      // Extract agent name from the content
      const nameMatch = content.match(/^---[\s\S]*?name:\s*(.+?)[\s\n]/)
      const name = nameMatch ? nameMatch[1].trim() : filename.replace(".md", "")
      throw new AgentExistsError({ path: targetPath, name })
    }

    // Write agent file
    await fs.mkdir(targetDir, { recursive: true })
    await Bun.write(targetPath, content)

    // Record installation
    await saveInstalledAgent({
      source: source.repo,
      sourcePath: agentPath,
      localPath: targetPath,
      installedRef: source.ref ?? "main",
      installedAt: Date.now(),
    })

    log.info("installed agent", { source: source.repo, path: targetPath })
    return targetPath
  }

  // Uninstall an agent
  export async function uninstallAgent(localPath: string): Promise<void> {
    log.info("uninstalling agent", { path: localPath })

    // Find and remove the installed record
    const dataPath = path.join(Global.Path.data, "marketplace", "installed.json")
    try {
      const data = await Bun.file(dataPath).json()
      const records = z.array(MarketplaceSchema.InstalledAgent).parse(data)
      const record = records.find((r) => r.localPath === localPath)
      if (record) {
        await removeInstalledAgent(record.source, record.sourcePath)
      }
    } catch {
      // No records file
    }

    // Delete the agent file
    await fs.rm(localPath, { force: true })

    log.info("uninstalled agent", { path: localPath })
  }

  // Add a new source
  export async function addSource(source: MarketplaceSchema.Source): Promise<void> {
    log.info("adding source", { repo: source.repo })

    // Validate source by fetching registry
    try {
      await MarketplaceCache.refreshRegistry(source)
    } catch (error) {
      throw new RegistryFetchError({
        repo: source.repo,
        message: error instanceof Error ? error.message : "Unknown error",
      })
    }

    // Note: Actual config update would need to be done by the caller
    // since we don't have a way to write back to config files here
    log.info("source validated", { repo: source.repo })
  }

  // Validate a source
  export async function validateSource(
    source: MarketplaceSchema.Source,
  ): Promise<{ valid: boolean; error?: string; registry?: MarketplaceSchema.RegistryIndex }> {
    try {
      const cached = await MarketplaceCache.refreshRegistry(source)
      return { valid: true, registry: cached.registry }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  // Refresh all sources
  export async function refreshAllSources(): Promise<{
    success: string[]
    failed: { repo: string; error: string }[]
  }> {
    const sources = await listSources()
    const success: string[] = []
    const failed: { repo: string; error: string }[] = []

    for (const source of sources) {
      try {
        await MarketplaceCache.refreshRegistry(source)
        success.push(source.repo)
      } catch (error) {
        failed.push({
          repo: source.repo,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    }

    return { success, failed }
  }

  // Clear marketplace cache
  export async function clearCache(): Promise<void> {
    await MarketplaceCache.clearAll()
    log.info("marketplace cache cleared")
  }

  // Check if GitHub authentication is available
  export async function hasGitHubAuth(): Promise<boolean> {
    return MarketplaceGitHub.isAuthenticated()
  }
}
