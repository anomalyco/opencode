/**
 * Memory Tools Plugin for OpenCode
 *
 * Provides cloud backup/restore for AgentMemory via Supabase.
 * User configures their own Supabase account via opencode.json.
 *
 * Usage in opencode.json:
 * {
 *   "plugin": [
 *     ["@opencode-ai/memory-tools", {
 *       "supabaseUrl": "https://xxx.supabase.co",
 *       "supabaseKey": "eyJ...",
 *       "syncInterval": "5m"
 *     }]
 *   ]
 * }
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { ToolDefinition } from "@opencode-ai/plugin/tool"
import { getConfig, saveConfig, parseInterval, getLocalDB, getCloudDB, backupToCloud, restoreFromCloud, getSyncStatus, type MemoryConfig, type SyncStatus } from "./sync.js"

// Parse interval string to milliseconds
function intervalToMs(interval: string): number | null {
  const match = interval.match(/^(\d+)(m|h|d)$/)
  if (!match) return null
  const value = parseInt(match[1]!, 10)
  const unit = match[2]!
  switch (unit) {
    case "m": return value * 60 * 1000
    case "h": return value * 60 * 60 * 1000
    case "d": return value * 24 * 60 * 60 * 1000
    default: return null
  }
}

// Scheduler state
let syncTimer: ReturnType<typeof setInterval> | null = null
let currentConfig: MemoryConfig | null = null

async function startScheduler(config: MemoryConfig) {
  // Stop existing scheduler
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }

  // Manual mode - no auto sync
  if (config.syncInterval === "manual" || !config.syncInterval) {
    return
  }

  const ms = intervalToMs(config.syncInterval)
  if (!ms) return

  syncTimer = setInterval(async () => {
    try {
      await backupToCloud(config)
    } catch (error) {
      console.error("[memory-tools] Scheduled backup failed:", error)
    }
  }, ms)
}

async function stopScheduler() {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}

// Tool definitions
const tools: Record<string, ToolDefinition> = {
  "memory.backup": tool({
    description: "Backup all local memories to Supabase cloud storage",
    args: {},
    async execute(_args, context) {
      if (!currentConfig) {
        return "Error: memory-tools not configured. Set supabaseUrl, supabaseKey, and syncInterval in opencode.json"
      }
      try {
        const localDB = await getLocalDB(context.directory)
        const cloudDB = getCloudDB(currentConfig)
        const result = await backupToCloud(currentConfig, localDB, cloudDB)
        return `Backup complete: ${result.pushed} memories pushed to cloud`
      } catch (error) {
        return `Backup failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  }),

  "memory.restore": tool({
    description: "Restore memories from Supabase cloud to local storage (merge)",
    args: {},
    async execute(_args, context) {
      if (!currentConfig) {
        return "Error: memory-tools not configured. Set supabaseUrl, supabaseKey, and syncInterval in opencode.json"
      }
      try {
        const localDB = await getLocalDB(context.directory)
        const cloudDB = getCloudDB(currentConfig)
        const result = await restoreFromCloud(currentConfig, localDB, cloudDB)
        return `Restore complete: ${result.restored} memories restored from cloud`
      } catch (error) {
        return `Restore failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  }),

  "memory.status": tool({
    description: "Show sync status between local and cloud",
    args: {},
    async execute(_args, context) {
      if (!currentConfig) {
        return "Error: memory-tools not configured. Set supabaseUrl, supabaseKey, and syncInterval in opencode.json"
      }
      try {
        const localDB = await getLocalDB(context.directory)
        const cloudDB = getCloudDB(currentConfig)
        const status = await getSyncStatus(currentConfig, localDB, cloudDB)
        return formatStatus(status)
      } catch (error) {
        return `Status check failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  }),

  "memory.schedule": tool({
    description: "Get or set the sync schedule interval. Usage: memory.schedule [interval|null]",
    args: {
      interval: tool.schema.string().optional().describe("Interval like '5m', '15m', '1h', '1d', or 'manual'. Omit to see current value."),
    },
    async execute(args, context) {
      if (!currentConfig) {
        return "Error: memory-tools not configured. Set supabaseUrl, supabaseKey, and syncInterval in opencode.json"
      }

      // Get current schedule
      if (!args.interval) {
        return `Current sync interval: ${currentConfig.syncInterval || "manual"}`
      }

      // Validate interval
      if (args.interval !== "manual" && !intervalToMs(args.interval)) {
        return "Error: Invalid interval. Use formats like '5m', '15m', '1h', '1d', or 'manual'"
      }

      // Update config
      const newConfig = { ...currentConfig, syncInterval: args.interval }
      await saveConfig(context.directory, newConfig)
      currentConfig = newConfig

      // Restart scheduler
      await startScheduler(newConfig)

      return `Sync interval updated to: ${args.interval}`
    },
  }),

  "memory.configure": tool({
    description: "Configure Supabase connection. Usage: memory.configure <url> <key> [interval]",
    args: {
      url: tool.schema.string().describe("Supabase project URL"),
      key: tool.schema.string().describe("Supabase service role key (PAT)"),
      interval: tool.schema.string().optional().describe("Sync interval (e.g., '5m', '15m', '1h', '1d', 'manual')"),
    },
    async execute(args, context) {
      // Validate URL
      if (!args.url.includes(".supabase.co")) {
        return "Error: Invalid Supabase URL. Should be like https://xxx.supabase.co"
      }

      // Validate key format (JWT)
      if (!args.key.startsWith("eyJ")) {
        return "Error: Invalid key format. Should be a Supabase service role key (starts with eyJ...)"
      }

      const interval = args.interval || "manual"
      if (interval !== "manual" && !intervalToMs(interval)) {
        return "Error: Invalid interval. Use formats like '5m', '15m', '1h', '1d', or 'manual'"
      }

      const config: MemoryConfig = {
        supabaseUrl: args.url,
        supabaseKey: args.key,
        syncInterval: interval,
      }

      await saveConfig(context.directory, config)
      currentConfig = config

      // Start scheduler
      await startScheduler(config)

      return `Configuration saved. Sync interval: ${interval}. Run 'memory.backup' to do initial backup.`
    },
  }),
}

function formatStatus(status: SyncStatus): string {
  const lines = [
    "=== Memory Sync Status ===",
    `Local memories: ${status.localCount}`,
    `Cloud memories: ${status.cloudCount}`,
    `Last sync: ${status.lastSyncTime ? new Date(status.lastSyncTime).toISOString() : "never"}`,
  ]

  if (status.newerInCloud > 0) {
    lines.push(`⚠️  ${status.newerInCloud} memories newer in cloud (will be restored)`)
  }
  if (status.newerInLocal > 0) {
    lines.push(`📤  ${status.newerInLocal} memories newer in local (will be backed up)`)
  }
  if (status.localCount === 0 && status.cloudCount === 0) {
    lines.push("No memories found. Create memories first, then backup.")
  }

  return lines.join("\n")
}

// Plugin entry point
export const MemoryToolsPlugin: Plugin = async (input: PluginInput) => {
  // Load existing config
  try {
    currentConfig = await getConfig(input.directory)
    if (currentConfig) {
      // Start scheduler if interval is set
      await startScheduler(currentConfig)
    }
  } catch {
    // No config yet - user needs to configure
  }

  return {
    tool: tools,
  }
}

export default MemoryToolsPlugin
