import { Log } from "../util/log"
import { Global } from "../global"
import path from "path"
import fs from "fs/promises"

export namespace Atum {
  const log = Log.create({ service: "atum" })

  export const ATUM_API_KEY = process.env["ATUM_API_KEY"]
  export const ATUM_API_KEY_ID = process.env["ATUM_API_KEY_ID"]
  export const ATUM_MCP_URL = process.env["ATUM_MCP_URL"]
  export const DEFAULT_AGENT_ID = "a37"

  const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
  const CACHE_DIR = path.join(Global.Path.cache, "atum-agents")

  export function hasCredentials(): boolean {
    return !!(ATUM_API_KEY && ATUM_API_KEY_ID && ATUM_MCP_URL)
  }

  /** The built-in Atum MCP server config, injected unless the user explicitly disables it. */
  export function mcpConfig() {
    if (!hasCredentials()) return undefined
    return {
      type: "remote" as const,
      url: ATUM_MCP_URL!,
      headers: {
        "X-Atum-Api-Key": ATUM_API_KEY!,
        "X-Atum-Api-Key-Id": ATUM_API_KEY_ID!,
      },
      oauth: false as const,
    }
  }

  // --- Disk cache helpers ---

  interface CacheEntry<T> {
    timestamp: number
    data: T
  }

  async function readCache<T>(filename: string): Promise<T | undefined> {
    try {
      const filepath = path.join(CACHE_DIR, filename)
      const raw = await fs.readFile(filepath, "utf-8")
      const entry = JSON.parse(raw) as CacheEntry<T>
      if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
        return entry.data
      }
      log.info("cache expired", { filename })
    } catch {
      // cache miss — file doesn't exist or is corrupt
    }
    return undefined
  }

  async function writeCache<T>(filename: string, data: T): Promise<void> {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true })
      const entry: CacheEntry<T> = { timestamp: Date.now(), data }
      await fs.writeFile(path.join(CACHE_DIR, filename), JSON.stringify(entry), "utf-8")
    } catch (e) {
      log.warn("failed to write cache", { filename, error: e })
    }
  }

  // --- MCP call function, set during MCP init ---
  type McpCallTool = (name: string, args: Record<string, unknown>) => Promise<any>
  let _mcpCallTool: McpCallTool | undefined

  export function setMcpCallTool(fn: McpCallTool) {
    _mcpCallTool = fn
  }

  // --- Agent list ---

  export interface AgentListEntry {
    id: string
    name?: string
    description?: string
    mode?: "primary" | "subagent" | "all"
    [key: string]: unknown
  }

  let _agentList: AgentListEntry[] | undefined

  export async function fetchAgentList(callTool: McpCallTool): Promise<AgentListEntry[]> {
    if (_agentList) return _agentList

    // Try disk cache first
    const cached = await readCache<AgentListEntry[]>("agent-list.json")
    if (cached) {
      log.info("using cached agent list", { count: cached.length })
      _agentList = cached
      return _agentList
    }

    try {
      log.info("fetching atum agent list")
      const result = await callTool("atum_list_agents", {})
      const text = result?.content?.find((c: any) => c.type === "text")?.text
      if (!text) {
        log.warn("atum_list_agents returned no text content")
        _agentList = []
        return _agentList
      }

      const parsed = JSON.parse(text)
      // Handle various response shapes: direct array, { agents: [...] }, { body: { items: [...] } }, etc.
      const list = Array.isArray(parsed)
        ? parsed
        : parsed.body?.items ?? parsed.items ?? parsed.agents ?? parsed.data ?? []
      _agentList = list.map((entry: any) => ({
        ...entry,
        id: entry.agentId ?? entry.id,
      })) as AgentListEntry[]
      log.info("atum agent list loaded", { count: _agentList.length, agents: _agentList.map((a) => a.id) })

      // Write to disk cache
      await writeCache("agent-list.json", _agentList)

      return _agentList
    } catch (e) {
      log.error("failed to fetch atum agent list", { error: e })
      _agentList = []
      return _agentList
    }
  }

  export function getCachedAgentList(): AgentListEntry[] {
    return _agentList ?? []
  }

  // --- Individual agent configs (loaded on demand) ---

  export interface AgentConfig {
    id: string
    name?: string
    system_prompt?: string
    tools?: string[]
    description?: string
    mode?: "primary" | "subagent" | "all"
    [key: string]: unknown
  }

  const _agentConfigs = new Map<string, AgentConfig>()
  const _agentFetchPromises = new Map<string, Promise<AgentConfig | undefined>>()

  /**
   * Fetch a single agent config from the Atum MCP server by calling `atum_get_agent`.
   * Results are cached in memory and on disk (1 hour TTL).
   */
  export async function fetchAgentConfig(agentId: string, callTool?: McpCallTool): Promise<AgentConfig | undefined> {
    // In-memory cache
    const memCached = _agentConfigs.get(agentId)
    if (memCached) return memCached

    const pending = _agentFetchPromises.get(agentId)
    if (pending) return pending

    const fn = callTool ?? _mcpCallTool
    if (!fn) {
      log.warn("no mcp call tool available to fetch agent config", { agentId })
      return undefined
    }

    const promise = (async () => {
      // Try disk cache
      const diskCached = await readCache<AgentConfig>(`agent-${agentId}.json`)
      if (diskCached) {
        log.info("using cached agent config", { agentId })
        _agentConfigs.set(agentId, diskCached)
        return diskCached
      }

      try {
        log.info("fetching atum agent config", { agentId })
        const result = await fn("atum_get_agent", { agentId, includeContext: true })

        const text = result?.content?.find((c: any) => c.type === "text")?.text
        if (!text) {
          log.warn("atum_get_agent returned no text content", { agentId })
          return undefined
        }

        const parsed = JSON.parse(text)
        // Handle nested response: { body: { ... } } or direct object
        const raw = parsed.body ?? parsed
        const config: AgentConfig = {
          ...raw,
          id: raw.agentId ?? raw.id ?? agentId,
          system_prompt: raw.assembledPrompt ?? raw.system_prompt ?? raw.systemPrompt ?? raw.prompt,
        }
        _agentConfigs.set(agentId, config)
        log.info("atum agent config loaded", { agentId: config.id, name: config.name })

        // Write to disk cache
        await writeCache(`agent-${agentId}.json`, config)

        return config
      } catch (e) {
        log.error("failed to fetch atum agent config", { agentId, error: e })
        return undefined
      } finally {
        _agentFetchPromises.delete(agentId)
      }
    })()

    _agentFetchPromises.set(agentId, promise)
    return promise
  }

  export function getCachedAgentConfig(agentId: string): AgentConfig | undefined {
    return _agentConfigs.get(agentId)
  }

  /**
   * Returns the system prompt for a given agent, fetching it if not cached.
   * Returns undefined if the agent has no system prompt.
   */
  export async function getAgentPrompt(agentId: string): Promise<string | undefined> {
    const config = _agentConfigs.get(agentId) ?? (await fetchAgentConfig(agentId))
    return config?.system_prompt
  }
}
