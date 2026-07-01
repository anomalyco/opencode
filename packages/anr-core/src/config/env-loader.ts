/**
 * Environment configuration loader for ANR OpenCode
 * Parses .env files matching the Go wrapper format
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs"
import { resolve, join } from "path"
import type { ANRConfig } from "./types"
import { defaultConfig } from "./types"

export type EnvFileInfo = {
  path: string
  name: string
  display: string
}

const home = process.env.HOME || process.env.USERPROFILE || "~"
const CONFIG_DIR = resolve(home, ".opencode")
const LAST_ENV_FILE = join(CONFIG_DIR, "last-env.txt")

/**
 * Discover all .env.* files across search directories.
 * Matches Donta's FindAllEnvFiles() from GovClaudeClient.
 */
export function findEnvFiles(dirs: string[]): EnvFileInfo[] {
  const seen = new Set<string>()
  const result: EnvFileInfo[] = []

  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!file.startsWith(".env.")) continue
      if (file === ".env.example" || file.endsWith(".bak")) continue

      const abs = resolve(dir, file)
      if (seen.has(abs)) continue
      seen.add(abs)

      const suffix = file.slice(5) // strip ".env."
      result.push({
        path: abs,
        name: suffix,
        display: peekDisplayName(abs) || suffix,
      })
    }
  }
  return result
}

/**
 * Read DISPLAY_NAME= from the first few lines of an env file.
 * Matches Donta's PeekDisplayName().
 */
function peekDisplayName(path: string): string {
  try {
    const text = readFileSync(path, "utf-8")
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      if (trimmed.slice(0, eq).trim() === "DISPLAY_NAME") return trimmed.slice(eq + 1).trim()
      break // stop after first non-comment, non-empty, non-DISPLAY_NAME line
    }
  } catch {}
  return ""
}

/**
 * Save the selected env file path for next launch.
 * Matches Donta's SaveLastEnvFile().
 */
export function saveLastEnv(envPath: string): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
    writeFileSync(LAST_ENV_FILE, envPath, { mode: 0o600 })
  } catch {}
}

/**
 * Read the last-used env file path.
 * Matches Donta's GetLastEnvFile().
 */
export function getLastEnv(): string {
  try {
    return readFileSync(LAST_ENV_FILE, "utf-8").trim()
  } catch {
    return ""
  }
}

/** Keys that must be cleared when switching environments */
const STALE_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "OPENCODE_AWS_REGION",
  "OPENCODE_ANR_ID_TOKEN",
  "OPENCODE_ANR_USER_EMAIL",
  "OPENCODE_ANR_USER_ID",
  "OPENCODE_ANR_USER_NAME",
  "OPENCODE_ANR_SESSION_ID",
  "OPENCODE_ANR_DEPARTMENT",
  "OPENCODE_ANR_TEAM_ID",
  "OPENCODE_ANR_COST_CENTER",
  "OPENCODE_ANR_MANAGER",
  "OPENCODE_ANR_ROLE",
  "OPENCODE_ANR_LOCATION",
  "OPENCODE_ANR_ORGANIZATION",
  "OPENCODE_ANR_ACCOUNT_ID",
  "OPENCODE_API_ENDPOINT",
  "OPENCODE_ENABLE_TELEMETRY",
  "OTEL_METRICS_EXPORTER",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "AUDIT_TABLE_NAME",
  "QUOTA_FAIL_MODE",
  "OPENCODE_METRICS_BATCH_SIZE",
  "OPENCODE_METRICS_INTERVAL_SECONDS",
  "OPENCODE_QUOTA_CHECK_INTERVAL",
  "PROVIDER_DOMAIN",
  "CLIENT_ID",
  "COGNITO_USER_POOL_ID",
  "IDENTITY_POOL_ID",
  "CREDENTIAL_STORAGE",
  "CROSS_REGION_PROFILE",
  "AWS_REGION_PROFILE",
]

/**
 * Clear stale env vars before loading a new env file.
 * Matches Donta's ClearCachedCredentials() intent.
 */
export function clearStaleEnv(): void {
  for (const key of STALE_KEYS) {
    delete process.env[key]
  }
}

/**
 * Load environment variables from .env file or process.env
 */
export async function loadANRConfig(envPath?: string, quiet = false): Promise<ANRConfig> {
  // If a specific env file is provided, load it
  if (envPath) {
    const resolved = resolve(envPath)
    if (existsSync(resolved)) {
      await loadEnvFile(resolved)
    } else if (!quiet) {
      console.warn(`ANR config file not found: ${resolved}`)
    }
  } else {
    // Try to load from default locations — 3-tier .opencode search:
    // 1. Project-level: <cwd>/.opencode/
    //    (+ monorepo root for dev mode where cwd is packages/opencode)
    // 2. User-level:    ~/.opencode/
    // 3. Global-level:  /etc/opencode/ (Mac/Linux) or C:\ProgramData\opencode\ (Windows)
    const cwd = process.cwd()
    // Only use import.meta.url-derived root when running from source (path contains /src/).
    const parts = import.meta.url.replace("file://", "").split("/src/")
    const rootPath = parts.length > 1 ? parts[0] : undefined
    const root = rootPath ? resolve(rootPath, "../.."): undefined
    const userDir = resolve(process.env.HOME || process.env.USERPROFILE || "~", ".opencode")
    const global = process.platform === "win32"
      ? resolve(process.env.PROGRAMDATA || "C:\\ProgramData", "opencode")
      : "/etc/opencode"
    const searchPaths = [
      resolve(cwd, ".opencode"),
      ...(root && root !== cwd ? [resolve(root, ".opencode")] : []),
      userDir,
      global,
    ]
    let loaded = false

    for (const dir of searchPaths) {
      if (!existsSync(dir)) continue

      const { readdirSync } = await import("fs")
      const files = readdirSync(dir)

      // Look for .env or .env.* files
      const envFiles = files.filter((f) => f === ".env" || f.startsWith(".env."))

      if (envFiles.length > 0 && envFiles[0]) {
        // Use the first match
        const envFile = resolve(dir, envFiles[0])
        if (!quiet) console.log(`📄 Loading config from: ${envFile}`)
        await loadEnvFile(envFile)
        loaded = true
        break
      }
    }

    if (!loaded && !quiet) {
      console.log("⚠️  No .env file found, using environment variables only")
    }
  }

  // Parse environment variables into config object
  return parseEnvConfig(quiet)
}

/**
 * Load environment variables from a file into process.env
 */
async function loadEnvFile(path: string): Promise<void> {
  try {
    const file = Bun.file(path)
    const text = await file.text()

    const lines = text.split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#")) continue

      const [key, ...valueParts] = trimmed.split("=")
      if (key && valueParts.length > 0) {
        const value = valueParts.join("=").trim()
        process.env[key.trim()] = value
      }
    }
  } catch (error) {
    console.error(`Failed to load env file: ${path}`, error)
  }
}

/**
 * Parse process.env into ANRConfig structure
 */
function parseEnvConfig(quiet = false): ANRConfig {
  const env = process.env

  return {
    // AWS & Bedrock
    awsRegion: env.AWS_REGION || env.OPENCODE_AWS_REGION || defaultConfig.awsRegion!,
    useBedrockProvider: env.OPENCODE_USE_BEDROCK === "1",
    anthropicModel: env.ANTHROPIC_MODEL || "",
    anthropicSmallFastModel: env.ANTHROPIC_SMALL_FAST_MODEL || "",

    // Telemetry
    enableTelemetry: env.OPENCODE_ENABLE_TELEMETRY === "1",
    enableAudit: env.OPENCODE_ENABLE_AUDIT !== "0", // enabled by default unless explicitly disabled
    otelMetricsExporter: env.OTEL_METRICS_EXPORTER || defaultConfig.otelMetricsExporter!,
    otelProtocol: env.OTEL_EXPORTER_OTLP_PROTOCOL || defaultConfig.otelProtocol!,
    otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT || "",
    metricsBatchSize: parseInt(env.OPENCODE_METRICS_BATCH_SIZE || String(defaultConfig.metricsBatchSize), 10),
    metricsIntervalSeconds: parseInt(
      env.OPENCODE_METRICS_INTERVAL_SECONDS || String(defaultConfig.metricsIntervalSeconds),
      10,
    ),

    // Audit & Compliance
    auditTableName: env.AUDIT_TABLE_NAME || "",

    // Quota & Policy (uses modelsApiEndpoint + /quota routes)
    quotaFailMode: (env.QUOTA_FAIL_MODE as "open" | "closed") || defaultConfig.quotaFailMode!,
    quotaCheckInterval:
      env.OPENCODE_QUOTA_CHECK_INTERVAL === "PROMPT"
        ? "PROMPT"
        : parseInt(env.OPENCODE_QUOTA_CHECK_INTERVAL || String(defaultConfig.quotaCheckInterval), 10),

    // Models API
    modelsApiEndpoint: env.OPENCODE_API_ENDPOINT || "",

    // AWS Cognito SSO
    providerDomain: env.PROVIDER_DOMAIN || "",
    clientId: env.CLIENT_ID || "",
    awsRegionProfile: env.AWS_REGION_PROFILE || env.AWS_REGION || defaultConfig.awsRegion!,
    providerType: "cognito",
    credentialStorage: (env.CREDENTIAL_STORAGE as "session" | "persistent") || defaultConfig.credentialStorage!,
    crossRegionProfile: env.CROSS_REGION_PROFILE || "",
    identityPoolId: env.IDENTITY_POOL_ID || "",
    federationType: "cognito",
    cognitoUserPoolId: env.COGNITO_USER_POOL_ID || "",

    // Optional installer URLs
    installerUrlOpencode: env.INSTALLER_URL_OPENCODE,
    installerUrlGit: env.INSTALLER_URL_GIT,
  }
}

/**
 * Validate that required configuration is present
 */
export function validateANRConfig(config: ANRConfig): string[] {
  const errors: string[] = []

  if (!config.awsRegion) errors.push("AWS_REGION or OPENCODE_AWS_REGION is required")

  return errors
}

/**
 * Get configuration with validation
 */
export async function getValidatedANRConfig(envPath?: string, quiet = false): Promise<ANRConfig> {
  const config = await loadANRConfig(envPath, quiet)
  const errors = validateANRConfig(config)

  if (errors.length > 0) {
    if (!quiet) {
      console.error("❌ ANR Configuration validation failed:")
      for (const error of errors) {
        console.error(`  - ${error}`)
      }
    }
    throw new Error("Invalid ANR configuration. Please check your .env file.")
  }

  return config
}
