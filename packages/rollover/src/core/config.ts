/** Configuration loading: ~/.config/opencode/rollover.json → .opencode/rollover.json → ROLLOVER_MODE (spec Part A §4.1). */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import type { RolloverConfig, RolloverMode } from "./types"

// 2026-11-17: the built-in default mode is OFF — every session starts
// disabled and opts in per chat via `/rollover on` (settings.enabled wins
// over every config layer). A rollover.json / ROLLOVER_MODE can still set a
// project- or global-wide default (spec Part A §4.1, amended).
export const DEFAULT_CONFIG: RolloverConfig = {
  mode: "off",
  thresholdRatio: 0.5,
  thresholdCapTokens: 200_000,
  thresholdMinTokens: 20_000,
  thresholdTokens: null,
  // Keep the last 2 prompts verbatim after a swap so the model can pick up
  // mid-task without re-reading the ledger (user ruling 2026-11-17).
  tailN: 2,
  tailMaxN: 20,
  renderBudgetTokens: 4_000,
  extractionModel: null,
  extractionDeltaMaxTokens: 12_000,
  // Reasoning models spend a minute and more thinking before the JSON; the
  // extraction runs at idle in the background, so a generous timeout only
  // delays the swap, never the user.
  extractionTimeoutMs: 180_000,
  consolidateAfterRecords: 40,
  consolidationTimeoutMs: 90_000,
  ledger: true,
  dataDir: ".opencode/rollover",
}

const MODES = ["off", "metrics_only", "auto"] as const

const fileSchema = z.strictObject({
  mode: z.enum(MODES).optional(),
  thresholdRatio: z.number().positive().max(1).optional(),
  thresholdCapTokens: z.number().int().positive().optional(),
  thresholdMinTokens: z.number().int().positive().optional(),
  thresholdTokens: z.number().int().positive().nullable().optional(),
  tailN: z.number().int().min(0).optional(),
  tailMaxN: z.number().int().min(0).optional(),
  renderBudgetTokens: z.number().int().positive().optional(),
  extractionModel: z.string().regex(/^[^/]+\/[^/]+$/).nullable().optional(),
  extractionDeltaMaxTokens: z.number().int().positive().optional(),
  extractionTimeoutMs: z.number().int().positive().optional(),
  consolidateAfterRecords: z.number().int().positive().optional(),
  consolidationTimeoutMs: z.number().int().positive().optional(),
  ledger: z.boolean().optional(),
  dataDir: z.string().optional(),
})

export interface LoadConfigEnv {
  homeConfigDir: string
  projectDir: string
  env: Record<string, string | undefined>
  /** defaults to console.error; injected by tests and the plugin for fork-style logging */
  onError?: (message: string) => void
}

function readLayer(file: string, onError: (m: string) => void): Partial<RolloverConfig> {
  if (!existsSync(file)) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    onError(`rollover config parse failed at ${file}: ${String(error)}`)
    return {}
  }
  const result = fileSchema.safeParse(parsed)
  if (!result.success) {
    onError(`rollover config invalid at ${file}: ${result.error.message}`)
    return {}
  }
  return result.data as Partial<RolloverConfig>
}

export function loadConfig(input: LoadConfigEnv): RolloverConfig {
  const onError = input.onError ?? ((message: string) => console.error(`[rollover] ${message}`))
  const home = readLayer(path.join(input.homeConfigDir, "rollover.json"), onError)
  const project = readLayer(path.join(input.projectDir, ".opencode", "rollover.json"), onError)
  const cfg: RolloverConfig = { ...DEFAULT_CONFIG, ...home, ...project }
  const rawMode = input.env["ROLLOVER_MODE"]
  if (rawMode !== undefined && (MODES as readonly string[]).includes(rawMode)) {
    cfg.mode = rawMode as RolloverMode
  }
  return cfg
}

/**
 * Per-session opt-in (2026-11-17): `/rollover on|off` writes
 * `settings.enabled`, which wins over every config layer — true runs the full
 * auto pipeline in that session, false disables it entirely, and an absent
 * flag (the fresh-session state) falls back to the config mode (default: off).
 */
/** Merges the session's /rollover settings over the config layers. */
export function withSessionSettings(
  cfg: RolloverConfig,
  st: { settings: { enabled?: boolean; renderBudgetTokens?: number } } | null | undefined,
): RolloverConfig {
  const enabled = st?.settings.enabled
  const renderBudgetTokens = st?.settings.renderBudgetTokens
  if (enabled === undefined && renderBudgetTokens === undefined) return cfg
  return {
    ...cfg,
    ...(enabled !== undefined ? { mode: enabled ? ("auto" as const) : ("off" as const) } : {}),
    ...(renderBudgetTokens !== undefined ? { renderBudgetTokens } : {}),
  }
}
