/**
 * RAID Configuration Management
 * Loads and validates RAID system configuration from environment and defaults
 */

import { join } from "node:path"
import { homedir } from "node:os"
import type { RaidConfig } from "./raid-types"

/**
 * Default RAID configuration values
 */
const DEFAULTS = {
  globalKbPath: join(homedir(), ".opencode", "raid"),
  enableAutoIndexing: true,
  maxConcurrentShards: 5,
  baseUrl: "https://api.openai.com/v1",
  shardModel: "gpt-4o-mini",
  orchModel: "gpt-4o",
  maxTokensPerShard: 4000,
  numShards: 10,
  overlapTokens: 200,
} as const

/**
 * Load RAID configuration from environment and defaults
 */
export function loadRaidConfig(projectRoot?: string): RaidConfig {
  const root = projectRoot ?? process.cwd()
  const globalKb = process.env.RAID_GLOBAL_KB_PATH ?? DEFAULTS.globalKbPath

  return {
    projectRoot: root,
    globalKbPath: globalKb,
    dbPath: join(root, ".opencode", "raid.db"),
    enableAutoIndexing:
      process.env.RAID_AUTO_INDEX === "false" ? false : DEFAULTS.enableAutoIndexing,
    maxConcurrentShards: parseInt(
      process.env.RAID_MAX_CONCURRENT ?? String(DEFAULTS.maxConcurrentShards),
      10,
    ),
    baseUrl: process.env.RAID_BASE_URL ?? process.env.OPENAI_BASE_URL ?? DEFAULTS.baseUrl,
    apiKey: process.env.RAID_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    shardModel: process.env.RAID_SHARD_MODEL ?? DEFAULTS.shardModel,
    orchModel: process.env.RAID_ORCH_MODEL ?? DEFAULTS.orchModel,
    maxTokensPerShard: parseInt(
      process.env.RAID_MAX_TOKENS_PER_SHARD ?? String(DEFAULTS.maxTokensPerShard),
      10,
    ),
    numShards: parseInt(process.env.RAID_NUM_SHARDS ?? String(DEFAULTS.numShards), 10),
    overlapTokens: parseInt(process.env.RAID_OVERLAP_TOKENS ?? String(DEFAULTS.overlapTokens), 10),
  }
}

/**
 * Validate RAID configuration
 */
export function validateRaidConfig(config: RaidConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!config.projectRoot) {
    errors.push("Project root is required")
  }

  if (!config.globalKbPath) {
    errors.push("Global knowledge base path is required")
  }

  if (!config.dbPath) {
    errors.push("Database path is required")
  }

  if (!config.apiKey) {
    errors.push("API key is required (set RAID_API_KEY or OPENAI_API_KEY)")
  }

  if (config.maxConcurrentShards < 1) {
    errors.push("maxConcurrentShards must be at least 1")
  }

  if (config.maxTokensPerShard < 100) {
    errors.push("maxTokensPerShard must be at least 100")
  }

  if (config.numShards < 1) {
    errors.push("numShards must be at least 1")
  }

  if (config.overlapTokens < 0) {
    errors.push("overlapTokens must be non-negative")
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
