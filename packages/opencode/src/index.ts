// DANGER ZONE: Shared across CLI + ANR + Desktop sidecar surfaces.
// Changes here must be tested with all flavors. See /AGENTS.md#surface-flavor-rules
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import * as Log from "@opencode-ai/core/util/log"
import { ConsoleCommand } from "./cli/cmd/account"
import { ProvidersCommand } from "./cli/cmd/providers"
import { AgentCommand } from "./cli/cmd/agent"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { NamedError } from "@opencode-ai/core/util/error"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { GithubCommand } from "./cli/cmd/github"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
import { AttachCommand } from "./cli/cmd/tui/attach"
import { TuiThreadCommand } from "./cli/cmd/tui/thread"
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { WebCommand } from "./cli/cmd/web"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { DbCommand } from "./cli/cmd/db"
import { errorMessage } from "./util/error"
import { PluginCommand } from "./cli/cmd/plug"
import { Heap } from "./cli/heap"
import { ensureProcessMetadata } from "@opencode-ai/core/util/opencode-process"
import { isRecord } from "@/util/record"
import {
  getValidatedANRConfig,
  authenticateWithOIDC,
  refreshOIDCTokens,
  exchangeTokenForAWSCredentials,
  initializeOTEL,
  shutdownOTEL,
  trackSessionStart,
  trackSessionEnd,
  trackCommand,
  clearOTELLogs,
  initializeAuditLogger,
  logAuthEvent,
  logSessionStart,
  logSessionEnd,
  logQuotaCheck,
  checkQuota,
  findEnvFiles,
  saveLastEnv,
  getLastEnv,
  clearStaleEnv,
  type TelemetryContext,
} from "@opencode-ai/anr-core"
import { randomUUID } from "crypto"
import { platform, arch, release } from "os"
import { existsSync, readdirSync, readFileSync } from "fs"
import path from "path"

const processMetadata = ensureProcessMetadata("main")

// ANR mode state (when running with OPENCODE_FLAVOR=anr)
let anrContext: {
  telemetryContext: TelemetryContext
  config: any
  sessionStartTime: number
  commandName: string
} | null = null

// Export quota info for TUI access
export let quotaInfo: {
  dailyTokens: number
  monthlyTokens: number
  dailyLimit: number
  monthlyLimit: number
  dailyPercent: number
  monthlyPercent: number
  warningLevel: "normal" | "warning" | "critical"
  warningColor: "green" | "yellow" | "red"
  allowed: boolean
} | null = null

// ANR credential refresh (dedicated module to avoid circular imports)
import * as ANRRefresh from "./auth/anr-refresh"

/**
 * Detect terminal type based on environment variables
 */
function detectTerminalType(): string {
  if (process.env.WT_SESSION) return "windows-terminal"
  if (process.env.ITERM_SESSION_ID) return "iterm2"
  if (process.env.GNOME_TERMINAL_SCREEN) return "gnome-terminal"
  if (process.env.VTE_VERSION) return "vte-based"
  if (process.env.KITTY_WINDOW_ID) return "kitty"
  if (process.env.TERM_PROGRAM === "iTerm.app") return "iterm2"
  if (process.env.TERM === "screen" && process.env.TMUX) return "tmux"
  if (process.env.TERM === "screen") return "screen"
  if (process.env.WSL_DISTRO_NAME) return `wsl-${process.env.WSL_DISTRO_NAME}`
  if (process.env.WSL_INTEROP) return "wsl"
  return process.env.TERM || "unknown"
}

/**
 * Extract OIDC token claims
 */
function extractTokenClaims(idToken: string): Record<string, any> {
  const parts = idToken.split(".")
  if (parts.length !== 3) return {}
  try {
    const payload = parts[1]
    if (!payload) return {}
    return JSON.parse(Buffer.from(payload, "base64").toString())
  } catch {
    return {}
  }
}

/**
 * Build comprehensive telemetry context from OIDC token and config
 */
function buildTelemetryContext(idToken: string, config: any, sessionId: string): TelemetryContext {
  const claims = extractTokenClaims(idToken)
  const userId = claims.sub || claims.cognito_username || "unknown"

  const ctx: TelemetryContext = {
    userId,
    userEmail: claims.email,
    userName: claims.name || claims.preferred_username,
    osType: platform(),
    osVersion: release(),
    hostArch: arch(),
    terminalType: detectTerminalType(),
    sessionId,
    organization: claims.organization || claims["custom:organization"],
    department: claims["custom:department"],
    costCenter: claims["custom:cost_center"],
  }

  // Enrich from config
  if (config.department) ctx.department = config.department
  if (config.teamId) ctx.teamId = config.teamId
  if (config.costCenter) ctx.costCenter = config.costCenter
  if (config.manager) ctx.manager = config.manager
  if (config.role) ctx.role = config.role
  if (config.location) ctx.location = config.location
  if (config.organization) ctx.organization = config.organization
  if (config.accountId) ctx.accountId = config.accountId

  return ctx
}

/**
 * Initialize ANR mode: authentication, quota, telemetry
 */
async function initializeANR(envFile?: string): Promise<void> {
  // Clear OTEL logs from previous session for clean debugging
  clearOTELLogs()

  console.error("\n🚀 OpenCode ANR\n")
  process.stderr.write("")

  // Load configuration
  const config = await getValidatedANRConfig(envFile, false)

  // Pass env file path to the worker so it loads the same config
  if (envFile) process.env.OPENCODE_ANR_ENV_FILE = envFile

  // Generate session ID
  const sessionId = randomUUID()

  // Authenticate with OIDC
  console.error("🔐 Authenticating...")
  let tokens
  try {
    tokens = await authenticateWithOIDC(config)
  } catch (err) {
    console.error("❌ Authentication failed:", err instanceof Error ? err.message : err)
    process.exit(1)
  }
  console.error("✅ Authenticated")
  console.error("📍 Debug: Received tokens from OIDC")
  console.error(`   - idToken length: ${tokens.idToken?.length || 0}`)
  console.error(`   - accessToken length: ${tokens.accessToken?.length || 0}`)
  console.error(`   - refreshToken: ${tokens.refreshToken ? "present" : "not provided"}`)
  console.error(`   - expiresIn: ${tokens.expiresIn ?? "not provided"}s`)

  // Build telemetry context
  const telemetryContext = buildTelemetryContext(tokens.idToken, config, sessionId)

  // Exchange token for AWS credentials
  console.error("💱 Exchanging token for AWS credentials...")
  let awsCredentials
  try {
    awsCredentials = await exchangeTokenForAWSCredentials(tokens.idToken, config)
  } catch (err) {
    console.error("❌ AWS credential exchange failed:", err instanceof Error ? err.message : err)
    process.exit(1)
  }
  console.error("✅ AWS credentials obtained")
  console.error("📍 Debug: AWS credentials exchanged")
  console.error(`   - accessKeyId length: ${awsCredentials.accessKeyId?.length || 0}`)
  console.error(`   - secretAccessKey length: ${awsCredentials.secretAccessKey?.length || 0}`)
  console.error(`   - sessionToken length: ${awsCredentials.sessionToken?.length || 0}`)
  console.error(`   - expiration: ${awsCredentials.expiration?.toISOString() ?? "not provided"}`)

  // Set AWS credentials in environment for model calls
  process.env.AWS_ACCESS_KEY_ID = awsCredentials.accessKeyId
  process.env.AWS_SECRET_ACCESS_KEY = awsCredentials.secretAccessKey
  process.env.AWS_SESSION_TOKEN = awsCredentials.sessionToken
  process.env.AWS_REGION = config.awsRegion
  delete process.env.AWS_PROFILE // Avoid credential conflicts

  // Initialize credential refresh state and schedule proactive refresh
  let currentRefreshToken = tokens.refreshToken
  ANRRefresh.init({
    stsExpiration: awsCredentials.expiration?.getTime(),
    async refresh() {
      let refreshedTokens

      // Try silent refresh first
      if (currentRefreshToken) {
        try {
          refreshedTokens = await refreshOIDCTokens(config, currentRefreshToken)
          console.error("🔄 Silently refreshed OIDC tokens")
        } catch {
          console.error("🔄 Silent token refresh failed, opening browser for re-authentication...")
          refreshedTokens = await authenticateWithOIDC(config)
        }
      } else {
        console.error("🔄 No refresh token available, opening browser for re-authentication...")
        refreshedTokens = await authenticateWithOIDC(config)
      }

      // Exchange new ID token for AWS credentials
      const creds = await exchangeTokenForAWSCredentials(refreshedTokens.idToken, config)
      currentRefreshToken = refreshedTokens.refreshToken ?? currentRefreshToken

      console.error("✅ AWS credentials refreshed successfully")
      return {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
        idToken: refreshedTokens.idToken,
        expiration: creds.expiration,
        refreshToken: refreshedTokens.refreshToken,
      }
    },
  })

  if (awsCredentials.expiration) {
    const minutesUntilExpiry = Math.round((awsCredentials.expiration.getTime() - Date.now()) / 60000)
    console.error(
      `🔄 Credential refresh scheduled ~${Math.max(0, minutesUntilExpiry - 5)} min from now (credentials expire in ${minutesUntilExpiry} min)`,
    )
  }

  console.error("📍 Debug: Credentials set in environment")
  console.error(`   - AWS_ACCESS_KEY_ID set: ${!!process.env.AWS_ACCESS_KEY_ID}`)
  console.error(`   - AWS_SECRET_ACCESS_KEY set: ${!!process.env.AWS_SECRET_ACCESS_KEY}`)
  console.error(`   - AWS_SESSION_TOKEN set: ${!!process.env.AWS_SESSION_TOKEN}`)
  console.error(`   - AWS_REGION: ${process.env.AWS_REGION}`)

  // Set models API endpoint if configured
  if (config.modelsApiEndpoint) {
    process.env.OPENCODE_API_ENDPOINT = config.modelsApiEndpoint
  }

  // Initialize audit logging
  initializeAuditLogger(config, {
    accessKeyId: awsCredentials.accessKeyId,
    secretAccessKey: awsCredentials.secretAccessKey,
    sessionToken: awsCredentials.sessionToken,
  })
  await logAuthEvent(config, telemetryContext.userId, "success", telemetryContext)

  // Set telemetry context env vars so the Bun Worker (which has a separate global scope)
  // can reconstruct the context via reconstructTelemetryContextFromEnv()
  process.env.OPENCODE_ANR_USER_ID = telemetryContext.userId
  process.env.OPENCODE_ANR_ID_TOKEN = tokens.idToken // Set ID token early for API calls
  if (telemetryContext.userEmail) process.env.OPENCODE_ANR_USER_EMAIL = telemetryContext.userEmail
  if (telemetryContext.userName) process.env.OPENCODE_ANR_USER_NAME = telemetryContext.userName
  if (telemetryContext.osType) process.env.OPENCODE_ANR_OS_TYPE = telemetryContext.osType
  if (telemetryContext.osVersion) process.env.OPENCODE_ANR_OS_VERSION = telemetryContext.osVersion
  if (telemetryContext.terminalType) process.env.OPENCODE_ANR_TERMINAL_TYPE = telemetryContext.terminalType
  if (telemetryContext.sessionId) process.env.OPENCODE_ANR_SESSION_ID = telemetryContext.sessionId
  if (telemetryContext.projectId) process.env.OPENCODE_ANR_PROJECT_ID = telemetryContext.projectId
  if (telemetryContext.department) process.env.OPENCODE_ANR_DEPARTMENT = telemetryContext.department
  if (telemetryContext.teamId) process.env.OPENCODE_ANR_TEAM_ID = telemetryContext.teamId
  if (telemetryContext.costCenter) process.env.OPENCODE_ANR_COST_CENTER = telemetryContext.costCenter
  if (telemetryContext.manager) process.env.OPENCODE_ANR_MANAGER = telemetryContext.manager
  if (telemetryContext.role) process.env.OPENCODE_ANR_ROLE = telemetryContext.role
  if (telemetryContext.location) process.env.OPENCODE_ANR_LOCATION = telemetryContext.location
  if (telemetryContext.organization) process.env.OPENCODE_ANR_ORGANIZATION = telemetryContext.organization
  if (telemetryContext.accountId) process.env.OPENCODE_ANR_ACCOUNT_ID = telemetryContext.accountId

  // Initialize telemetry
  if (config.enableTelemetry) {
    initializeOTEL(config, telemetryContext)
    trackSessionStart(telemetryContext.userId)
  }
  try {
    await logSessionStart(config, telemetryContext.userId, telemetryContext, { sessionId })
  } catch (err) {
    console.error("⚠️ Session logging failed:", err instanceof Error ? err.message : err)
  }

  // Check quota
  let quotaResult
  try {
    quotaResult = await checkQuota(
      {
        userEmail: telemetryContext.userEmail || telemetryContext.userId,
        organization: telemetryContext.organization,
        teamId: telemetryContext.teamId,
      },
      config.modelsApiEndpoint,
      config.quotaFailMode,
      process.env.OPENCODE_ANR_ID_TOKEN || tokens.idToken,
    )
  } catch (err) {
    if (config.quotaFailMode === "open") {
      console.error("⚠️  Quota service unavailable — continuing with limited tracking.")
    } else {
      console.error("❌ Unable to verify quota (service unavailable). Access denied for safety.")
      console.error("   Contact your administrator if this persists.")
      process.exit(1)
    }
  }

  // Audit the quota check result
  logQuotaCheck(config, telemetryContext.userId, !!quotaResult?.usage?.allowed, telemetryContext, {
    daily: quotaResult?.usage?.dailyUsagePercent,
    monthly: quotaResult?.usage?.monthlyUsagePercent,
  })

  if (quotaResult && !quotaResult.usage.allowed) {
    console.error("❌ Quota exceeded. Access denied.")
    if (quotaResult.policy.dailyTokenLimit > 0) {
      console.error(`   Daily:   ${quotaResult.usage.dailyTokens.toLocaleString()} / ${quotaResult.policy.dailyTokenLimit.toLocaleString()} tokens (${Math.round(quotaResult.usage.dailyUsagePercent)}%)`)
    }
    if (quotaResult.policy.monthlyTokenLimit > 0) {
      console.error(`   Monthly: ${quotaResult.usage.monthlyTokens.toLocaleString()} / ${quotaResult.policy.monthlyTokenLimit.toLocaleString()} tokens (${Math.round(quotaResult.usage.monthlyUsagePercent)}%)`)
    }
    if (quotaResult.usage.dailyResetInfo) console.error(`   ${quotaResult.usage.dailyResetInfo}`)
    if (quotaResult.usage.monthlyResetInfo) console.error(`   ${quotaResult.usage.monthlyResetInfo}`)
    console.error("   Contact your administrator for limit increases.")
    await logSessionEnd(config, telemetryContext.userId, 0, telemetryContext)
    if (config.enableTelemetry) {
      trackSessionEnd(telemetryContext.userId, 0)
      await shutdownOTEL()
    }
    process.exit(1)
  }

  if (!quotaResult) {
    // quotaResult is null — fail-open mode already logged a warning above
    console.error("⚠️  No quota data available — usage will not be tracked.")
  }

  if (quotaResult?.usage) {
    console.error(
      `📊 Quota: ${Math.round(quotaResult.usage.dailyUsagePercent)}% daily, ${Math.round(quotaResult.usage.monthlyUsagePercent)}% monthly`,
    )

    // Determine warning level
    const maxPercent = Math.max(quotaResult.usage.dailyUsagePercent, quotaResult.usage.monthlyUsagePercent)
    let warningLevel: "normal" | "warning" | "critical" = "normal"
    if (maxPercent >= 90) warningLevel = "critical"
    else if (maxPercent >= 80) warningLevel = "warning"

    // Determine color
    let warningColor: "green" | "yellow" | "red" = "green"
    if (warningLevel === "critical") warningColor = "red"
    else if (warningLevel === "warning") warningColor = "yellow"

    // Store quota info for TUI access
    quotaInfo = {
      dailyTokens: quotaResult.usage.dailyTokens,
      monthlyTokens: quotaResult.usage.monthlyTokens,
      dailyLimit: quotaResult.policy.dailyTokenLimit,
      monthlyLimit: quotaResult.policy.monthlyTokenLimit,
      dailyPercent: quotaResult.usage.dailyUsagePercent,
      monthlyPercent: quotaResult.usage.monthlyUsagePercent,
      warningLevel,
      warningColor,
      allowed: quotaResult.usage.allowed,
    }

    // Set environment variables for TUI to display quota (for backward compatibility)
    process.env.OPENCODE_ANR_QUOTA_DAILY_TOKENS = String(quotaResult.usage.dailyTokens)
    process.env.OPENCODE_ANR_QUOTA_MONTHLY_TOKENS = String(quotaResult.usage.monthlyTokens)
    process.env.OPENCODE_ANR_QUOTA_DAILY_LIMIT = String(quotaResult.policy.dailyTokenLimit)
    process.env.OPENCODE_ANR_QUOTA_MONTHLY_LIMIT = String(quotaResult.policy.monthlyTokenLimit)
    process.env.OPENCODE_ANR_QUOTA_DAILY_PERCENT = String(quotaResult.usage.dailyUsagePercent)
    process.env.OPENCODE_ANR_QUOTA_MONTHLY_PERCENT = String(quotaResult.usage.monthlyUsagePercent)
    process.env.OPENCODE_ANR_QUOTA_WARNING_LEVEL = quotaResult.usage.warningLevel
    process.env.OPENCODE_ANR_QUOTA_ALLOWED = String(quotaResult.usage.allowed)

    // OPENCODE_API_ENDPOINT is already set above (line 176) for TUI's periodic quota refresh
    process.env.OPENCODE_ANR_USER_EMAIL = telemetryContext.userEmail || telemetryContext.userId
  } else {
    console.warn("⚠️ No quota data received")
  }
  console.error()

  // Store context for later use
  anrContext = {
    telemetryContext,
    config,
    sessionStartTime: Date.now(),
    commandName: process.argv[2] || "tui",
  }

  // Also store in global for cross-module access (logToFile happens in initializeOTEL)
  ;(global as any).__ANR_TELEMETRY_CONTEXT__ = telemetryContext

  // Setup exit handlers for telemetry cleanup
  const exitHandler = async () => {
    if (anrContext) {
      const duration = (Date.now() - anrContext.sessionStartTime) / 1000
      if (anrContext.config.enableTelemetry) {
        trackSessionEnd(anrContext.telemetryContext.userId, duration)
        await shutdownOTEL()
      }
      await logSessionEnd(anrContext.config, anrContext.telemetryContext.userId, duration, anrContext.telemetryContext)
    }
  }

  process.on("SIGINT", async () => {
    await exitHandler()
    process.exit(0)
  })

  process.on("SIGTERM", async () => {
    await exitHandler()
    process.exit(0)
  })

  process.on("exit", () => {
    // Synchronous cleanup only
  })
}

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: errorMessage(e),
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: errorMessage(e),
  })
})

const ANR_MARKERS = ["OPENCODE_API_ENDPOINT", "PROVIDER_DOMAIN", "IDENTITY_POOL_ID"]

function detectANR(): boolean {
  if (process.env.OPENCODE_FLAVOR === "anr") return true
  const home = process.env.HOME || process.env.USERPROFILE
  if (!home) return false
  const global = process.platform === "win32"
    ? path.resolve(process.env.PROGRAMDATA || "C:\\ProgramData", "opencode")
    : "/etc/opencode"
  // In dev mode, cwd may be packages/opencode — also check repo root.
  // Only use import.meta.url-derived root when running from source (path contains /src/).
  const parts = Bun.fileURLToPath(import.meta.url).split(path.sep + "src" + path.sep)
  const pkg = parts.length > 1 ? parts[0] : undefined
  const root = pkg ? path.resolve(pkg, "../..") : undefined
  const dirs = [
    path.join(process.cwd(), ".opencode"),
    ...(root && root !== process.cwd() ? [path.join(root, ".opencode")] : []),
    path.join(home, ".opencode"),
    global,
  ]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (name !== ".env" && !name.startsWith(".env.")) continue
      try {
        const content = readFileSync(path.join(dir, name), "utf-8")
        const found = content.split("\n").some((line: string) => {
          const trimmed = line.trim()
          return ANR_MARKERS.some((m) => trimmed.startsWith(m))
        })
        if (found) return true
      } catch {}
    }
  }
  return false
}

/**
 * Interactive env file picker for ANR mode.
 * Matches Donta's ui.Select() behavior from GovClaudeClient.
 */
async function selectEnvFile(): Promise<string | undefined> {
  // Search for .env files in standard .opencode locations (3-tier):
  // 1. Project-level: <cwd>/.opencode/ — developer overrides
  //    (+ monorepo root for dev mode where cwd is packages/opencode)
  // 2. User-level:    ~/.opencode/ — personal config / exe users
  // 3. Global-level:  /etc/opencode/ or C:\ProgramData\opencode\ — enterprise
  const home = process.env.HOME || process.env.USERPROFILE || "~"
  // Only use import.meta.url-derived root when running from source (path contains /src/).
  const srcParts = Bun.fileURLToPath(import.meta.url).split(path.sep + "src" + path.sep)
  const srcPkg = srcParts.length > 1 ? srcParts[0] : undefined
  const root = srcPkg ? path.resolve(srcPkg, "../.."): undefined
  const global = process.platform === "win32"
    ? path.resolve(process.env.PROGRAMDATA || "C:\\ProgramData", "opencode")
    : "/etc/opencode"
  const dirs = [
    path.join(process.cwd(), ".opencode"),
    ...(root && root !== process.cwd() ? [path.join(root, ".opencode")] : []),
    path.resolve(home, ".opencode"),
    global,
  ]

  const files = findEnvFiles(dirs)
  if (files.length === 0) return undefined
  if (files.length === 1) {
    saveLastEnv(files[0].path)
    return files[0].path
  }

  // Pre-select the last-used env file
  const last = getLastEnv()
  const lastIdx = last ? files.findIndex((f) => f.path === last) : -1

  // If not a terminal, use last or first
  if (!process.stderr.isTTY) {
    const idx = lastIdx >= 0 ? lastIdx : 0
    return files[idx]?.path
  }

  // Interactive picker
  process.stderr.write("\nSelect environment:\n")
  for (let i = 0; i < files.length; i++) {
    const marker = i === lastIdx ? " (last used)" : ""
    process.stderr.write(`  ${i + 1}. ${files[i]?.display ?? files[i]?.name}${marker}\n`)
  }

  const rl = await import("readline")
  const prompt = rl.createInterface({ input: process.stdin, output: process.stderr })
  const dflt = lastIdx >= 0 ? lastIdx + 1 : 1
  const answer = await new Promise<string>((ok) => {
    prompt.question(`Choice [${dflt}]: `, (a) => {
      prompt.close()
      ok(a.trim())
    })
  })

  const choice = answer === "" ? dflt : parseInt(answer, 10)
  if (Number.isNaN(choice) || choice < 1 || choice > files.length) {
    process.stderr.write("Invalid selection, using default.\n")
    return files[dflt - 1]?.path
  }

  const selected = files[choice - 1]?.path
  if (selected) saveLastEnv(selected)
  return selected
}

/**
 * Main CLI function
 * Pass argv to test/override, or undefined to use process.argv
 */
export async function main(argv?: string[]) {
  // Auto-detect ANR mode from .env files if not already set
  if (!process.env.OPENCODE_FLAVOR && detectANR()) {
    process.env.OPENCODE_FLAVOR = "anr"
  }

  // Check if running in ANR mode
  const anrMode =
    process.env.OPENCODE_FLAVOR === "anr" && !process.argv.includes("--help") && !process.argv.includes("--version")

  // Parse --env-file before ANR init so the config loader can use it
  const envIdx = process.argv.indexOf("--env-file")
  let envFile = envIdx !== -1 ? process.argv[envIdx + 1] : undefined

  if (anrMode) {
    // If no --env-file flag, show picker (or auto-select if only one)
    if (!envFile) {
      envFile = await selectEnvFile()
    }

    // Clear stale env vars before loading new config
    clearStaleEnv()

    await initializeANR(envFile)
  }

  const args = argv ?? hideBin(process.argv)

  function show(out: string) {
    const text = out.trimStart()
    if (!text.startsWith("opencode ")) {
      process.stderr.write(UI.logo() + EOL + EOL)
      process.stderr.write(text)
      return
    }
    process.stderr.write(out)
  }

  let cli = yargs(args)
    .parserConfiguration({ "populate--": true })
    .scriptName("opencode")
    .wrap(100)
    .help("help", "show help")
    .alias("help", "h")
    .version("version", "show version number", InstallationVersion)
    .alias("version", "v")
    .option("print-logs", {
      describe: "print logs to stderr",
      type: "boolean",
    })
    .option("log-level", {
      describe: "log level",
      type: "string",
      choices: ["DEBUG", "INFO", "WARN", "ERROR"],
    })
    .option("pure", {
      describe: "run without external plugins",
      type: "boolean",
    })
    .option("env-file", {
      describe: "path to ANR .env config file",
      type: "string",
    })
    .middleware(async (opts) => {
      if (opts.pure) {
        process.env.OPENCODE_PURE = "1"
      }

      await Log.init({
        print: process.argv.includes("--print-logs"),
        dev: Installation.isLocal(),
        level: (() => {
          if (opts.logLevel) return opts.logLevel as Log.Level
          if (Installation.isLocal()) return "DEBUG"
          return "INFO"
        })(),
      })

      Heap.start()

      process.env.AGENT = "1"
      process.env.OPENCODE = "1"
      process.env.OPENCODE_PID = String(process.pid)

      Log.Default.info("opencode", {
        version: InstallationVersion,
        args: process.argv.slice(2),
        process_role: processMetadata.processRole,
        run_id: processMetadata.runID,
      })
    })
    .usage("")
    .completion("completion", "generate shell completion script")
    .command(AcpCommand)
    .command(McpCommand)
    .command(TuiThreadCommand)
    .command(AttachCommand)
    .command(RunCommand)
    .command(GenerateCommand)
    .command(DebugCommand)
    .command(ConsoleCommand)
    .command(ProvidersCommand)
    .command(AgentCommand)
    .command(UpgradeCommand)
    .command(UninstallCommand)
    .command(ServeCommand)
    .command(WebCommand)
    .command(ModelsCommand)
    .command(StatsCommand)
    .command(ExportCommand)
    .command(ImportCommand)
    .command(GithubCommand)
    .command(PrCommand)
    .command(SessionCommand)
    .command(PluginCommand)
    .command(DbCommand)
    .fail((msg, err) => {
      if (
        msg?.startsWith("Unknown argument") ||
        msg?.startsWith("Not enough non-option arguments") ||
        msg?.startsWith("Invalid values:")
      ) {
        if (err) throw err
        cli.showHelp(show)
      }
      if (err) throw err
      process.exit(1)
    })
    .strict()

  try {
    if (args.includes("-h") || args.includes("--help")) {
      await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
        if (err) throw err
        if (!out) return
        show(out)
      })
    } else {
      await cli.parse()
    }
  } catch (e) {
    let data: Record<string, any> = {}
    if (e instanceof Error) {
      Object.assign(data, {
        name: e.name,
        message: e.message,
        cause: e.cause?.toString(),
        stack: e.stack,
      })
    }

    if (e instanceof NamedError) {
      const obj = e.toObject()
      if (isRecord(obj.data)) {
        for (const [key, value] of Object.entries(obj.data)) {
          if (key === "name" || key === "stack" || key === "cause") continue
          data[key] = value
        }
      }
    }

    if (e instanceof ResolveMessage) {
      Object.assign(data, {
        name: e.name,
        message: e.message,
        code: e.code,
        specifier: e.specifier,
        referrer: e.referrer,
        position: e.position,
        importKind: e.importKind,
      })
    }
    Log.Default.error("fatal", data)
    const formatted = FormatError(e)
    if (formatted) UI.error(formatted)
    if (formatted === undefined) {
      UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
      process.stderr.write(errorMessage(e) + EOL)
    }
    process.exitCode = 1
  } finally {
    // Flush telemetry metrics with a timeout to prevent hanging
    try {
      const shutdownPromise = shutdownOTEL()
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 2000))
      await Promise.race([shutdownPromise, timeoutPromise])
    } catch {
      // Silently fail if shutdown has issues, don't block exit
    }

    // Some subprocesses don't react properly to SIGTERM and similar signals.
    // Most notably, some docker-container-based MCP servers don't handle such signals unless
    // run using `docker run --init`.
    // Explicitly exit to avoid any hanging subprocesses.
    //
    // Skip forced exit for long-running server commands (serve, web, workspace-serve).
    // Yargs can resolve cli.parse() before the command handler's promise settles,
    // causing the finally block to run while the server is still active.
    const command = args[args.findIndex((a) => !a.startsWith("-"))]
    if (command === "serve" || command === "web" || command === "workspace-serve") return
    process.exit()
  }
}

// Run main when executed directly. In compiled binaries built with
// conditions:["browser"], import.meta.main is false, so also check for
// the build-time OPENCODE_VERSION constant which is only defined in
// compiled builds.
if (import.meta.main || typeof OPENCODE_VERSION === "string") {
  main().catch((error) => {
    console.error("❌ Fatal error:", error)
    process.exit(1)
  })
}
