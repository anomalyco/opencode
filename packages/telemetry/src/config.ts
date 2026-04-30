import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"

/**
 * Resolve whether telemetry is enabled.
 *
 * Priority (highest first):
 *   1. ENV: OPENCODE_TELEMETRY=0|false|no  → disabled
 *      ENV: OPENCODE_TELEMETRY=1|true|yes  → enabled (overrides config)
 *   2. Init flag (e.g. from CLI `--no-telemetry`): explicit `false` disables.
 *   3. Config file `~/.config/opencode/config.json` field `"telemetry": false`.
 *   4. Default: true.
 *
 * Returns `true` if the SDK should send events.
 */

interface ResolveOptions {
  /** Explicit boolean from a CLI flag. `false` disables. `undefined` ignores. */
  flag?: boolean
  /** Path to config file. Defaults to ~/.config/opencode/config.json. */
  configPath?: string
  /** Override env (mostly for tests). Defaults to process.env. */
  env?: NodeJS.ProcessEnv
}

const TRUE_LITERALS = new Set(["1", "true", "yes", "on"])
const FALSE_LITERALS = new Set(["0", "false", "no", "off"])

function parseBoolEnv(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined
  const v = raw.trim().toLowerCase()
  if (TRUE_LITERALS.has(v)) return true
  if (FALSE_LITERALS.has(v)) return false
  return undefined
}

export function defaultConfigPath(): string {
  const home = process.env.OPENCODE_TEST_HOME || os.homedir()
  return path.join(home, ".config", "opencode", "config.json")
}

async function readConfigFlag(file: string, key: string): Promise<boolean | undefined> {
  try {
    const raw = await fs.readFile(file, "utf8")
    const obj = JSON.parse(raw) as Record<string, unknown>
    const v = obj[key]
    if (typeof v === "boolean") return v
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the telemetry-enabled decision. Async because we may read config from disk.
 */
export async function isTelemetryEnabled(opts: ResolveOptions = {}): Promise<boolean> {
  const env = opts.env ?? process.env
  const envVal = parseBoolEnv(env.OPENCODE_TELEMETRY)
  if (envVal !== undefined) return envVal

  if (opts.flag === false) return false
  if (opts.flag === true) return true // explicit enable wins over config-file disable

  const configPath = opts.configPath ?? defaultConfigPath()
  const fromConfig = await readConfigFlag(configPath, "telemetry")
  if (fromConfig !== undefined) return fromConfig

  return true
}

/**
 * Resolve the update-check-enabled decision. Same priority chain but uses
 * `OPENCODE_UPDATE_CHECK` env / `update_check` config key. Independent of telemetry.
 */
export async function isUpdateCheckEnabled(opts: ResolveOptions = {}): Promise<boolean> {
  const env = opts.env ?? process.env
  const envVal = parseBoolEnv(env.OPENCODE_UPDATE_CHECK)
  if (envVal !== undefined) return envVal

  if (opts.flag === false) return false
  if (opts.flag === true) return true

  const configPath = opts.configPath ?? defaultConfigPath()
  const fromConfig = await readConfigFlag(configPath, "update_check")
  if (fromConfig !== undefined) return fromConfig

  return true
}

/** Sync helper used in tight paths (e.g. inside track/heartbeat). Only consults env + flag. */
export function isTelemetryEnabledSync(opts: { flag?: boolean; env?: NodeJS.ProcessEnv } = {}): boolean | undefined {
  const env = opts.env ?? process.env
  const envVal = parseBoolEnv(env.OPENCODE_TELEMETRY)
  if (envVal !== undefined) return envVal
  if (opts.flag === false) return false
  if (opts.flag === true) return true
  return undefined // caller should fall back to whatever was resolved at init time
}
