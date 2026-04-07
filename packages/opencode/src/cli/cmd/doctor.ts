import type { Argv } from "yargs"
import { EOL } from "os"
import fs from "fs/promises"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Installation } from "../../installation"
import { Config } from "../../config/config"
import { Auth } from "../../auth"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { Agent } from "../../agent/agent"
import { LSP } from "../../lsp"
import { MCP } from "../../mcp"
import { Format } from "../../format"
import { Plugin } from "../../plugin"
import { Permission } from "../../permission"
import { Global } from "../../global"
import { Flag } from "../../flag/flag"

type CheckStatus = "pass" | "warn" | "fail" | "info" | "skip"

interface CheckResult {
  status: CheckStatus
  label: string
  detail?: string
}

interface Section {
  title: string
  checks: CheckResult[]
}

const ICONS: Record<CheckStatus, string> = {
  pass: "✓",
  warn: "⚠",
  fail: "✗",
  info: "•",
  skip: "○",
}

const COLORS: Record<CheckStatus, string> = {
  pass: UI.Style.TEXT_SUCCESS,
  warn: UI.Style.TEXT_WARNING,
  fail: UI.Style.TEXT_DANGER,
  info: UI.Style.TEXT_INFO,
  skip: UI.Style.TEXT_DIM,
}

function formatCheck(check: CheckResult, verbose: boolean): string {
  const icon = ICONS[check.status]
  const color = COLORS[check.status]
  const reset = UI.Style.TEXT_NORMAL
  const dim = UI.Style.TEXT_DIM
  let line = `  ${color}${icon}${reset} ${check.label}`
  if (check.detail && (verbose || check.status === "fail" || check.status === "warn")) {
    line += ` ${dim}${check.detail}${reset}`
  }
  return line
}

function formatSection(section: Section, verbose: boolean): string {
  const lines: string[] = []
  const bold = UI.Style.TEXT_NORMAL_BOLD
  const reset = UI.Style.TEXT_NORMAL
  lines.push(`${bold}${section.title}${reset}`)
  for (const check of section.checks) {
    lines.push(formatCheck(check, verbose))
  }
  return lines.join(EOL)
}

async function runSection(title: string, fn: () => Promise<CheckResult[]>): Promise<Section> {
  try {
    const checks = await fn()
    return { title, checks }
  } catch (e) {
    return {
      title,
      checks: [{ status: "fail", label: "Section failed to run", detail: String(e) }],
    }
  }
}

// --- Section: Environment ---

async function checkEnvironment(): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  checks.push({
    status: "info",
    label: `OpenCode v${Installation.VERSION}`,
    detail: `(${Installation.CHANNEL} channel)`,
  })

  const method = await Installation.method()
  checks.push({ status: "pass", label: `Installed via ${method}` })

  checks.push({
    status: "info",
    label: `Binary: ${process.execPath}`,
  })

  const bunVersion = process.versions.bun
  if (bunVersion) {
    checks.push({ status: "pass", label: `Bun v${bunVersion}` })
  } else {
    checks.push({ status: "warn", label: "Bun version not detected" })
  }

  try {
    const proc = Bun.spawnSync(["git", "--version"])
    const output = proc.stdout.toString().trim()
    const version = output.replace("git version ", "")
    checks.push({ status: "pass", label: `Git v${version}` })
  } catch {
    checks.push({ status: "fail", label: "Git not found", detail: "git is required for version control features" })
  }

  return checks
}

// --- Section: Updates ---

async function checkUpdates(): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  if (Flag.OPENCODE_DISABLE_AUTOUPDATE) {
    checks.push({ status: "warn", label: "Auto-update disabled", detail: "(OPENCODE_DISABLE_AUTOUPDATE=true)" })
  } else {
    checks.push({ status: "pass", label: "Auto-update enabled" })
  }

  if (Installation.isLocal()) {
    checks.push({ status: "info", label: "Local development build", detail: "skipping version check" })
    return checks
  }

  try {
    const method = await Installation.method()
    const latest = await Installation.latest(method)
    if (latest && latest !== Installation.VERSION) {
      const releaseType = Installation.getReleaseType(Installation.VERSION, latest)
      checks.push({
        status: releaseType === "major" ? "warn" : "info",
        label: `Update available: v${latest}`,
        detail: `(${releaseType} update, run: opencode upgrade)`,
      })
    } else {
      checks.push({ status: "pass", label: "Up to date" })
    }
  } catch {
    checks.push({ status: "warn", label: "Could not check for updates" })
  }

  return checks
}

// --- Section: Configuration ---

async function checkConfiguration(): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  try {
    const dirs = await Config.directories()
    if (dirs.length > 0) {
      checks.push({ status: "info", label: `Config sources: ${dirs.join(", ")}` })
    }
  } catch {
    checks.push({ status: "warn", label: "Could not determine config directories" })
  }

  try {
    await Config.get()
    checks.push({ status: "pass", label: "Config loaded and valid" })
  } catch (e: any) {
    if (e?.name === "ConfigJsonError" || e?._tag === "ConfigJsonError") {
      checks.push({ status: "fail", label: "Config has JSON syntax errors", detail: String(e.message ?? e) })
    } else if (e?.name === "ConfigInvalidError" || e?._tag === "ConfigInvalidError") {
      checks.push({ status: "fail", label: "Config has schema validation errors", detail: String(e.message ?? e) })
    } else if (e?.name === "ConfigDirectoryTypoError" || e?._tag === "ConfigDirectoryTypoError") {
      checks.push({
        status: "fail",
        label: "Config directory typo detected",
        detail: 'Did you mean ".opencode" instead of "opencode"?',
      })
    } else {
      checks.push({ status: "fail", label: "Config failed to load", detail: String(e) })
    }
  }

  return checks
}

// --- Section: Providers & Models ---

async function checkProviders(verbose: boolean): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  // Auth credentials
  let storedAuth: Record<string, Auth.Info> = {}
  try {
    storedAuth = await Auth.all()
  } catch {
    checks.push({ status: "warn", label: "Could not read stored credentials" })
  }

  // Model database
  let providers: Record<string, any> = {}
  let totalModels = 0
  try {
    providers = await ModelsDev.get()
    for (const p of Object.values(providers)) {
      totalModels += Object.keys((p as any).models ?? {}).length
    }
    checks.push({
      status: "pass",
      label: `Model database: ${totalModels} models from ${Object.keys(providers).length} providers`,
    })
  } catch {
    checks.push({ status: "warn", label: "Could not fetch model database from models.dev" })
  }

  // Per-provider auth status
  const providerEntries = Object.entries(providers) as [string, { env?: string[]; name?: string }][]
  const providersSorted = providerEntries.sort(([a], [b]) => a.localeCompare(b))

  for (const [id, provider] of providersSorted) {
    const envVars = provider.env ?? []
    const hasStoredKey = !!storedAuth[id]
    const hasEnvKey = envVars.some((e: string) => !!process.env[e])

    if (hasStoredKey) {
      const authType = storedAuth[id].type
      checks.push({ status: "pass", label: `${id}`, detail: `(stored ${authType} credential)` })
    } else if (hasEnvKey) {
      const envVar = envVars.find((e: string) => !!process.env[e])
      checks.push({ status: "pass", label: `${id}`, detail: `(env: ${envVar})` })
    } else if (verbose) {
      checks.push({ status: "skip", label: `${id}`, detail: "(no credentials)" })
    }
  }

  // Default model
  try {
    const defaultModel = await Provider.defaultModel()
    checks.push({
      status: "pass",
      label: `Default model: ${defaultModel.providerID}/${defaultModel.modelID}`,
    })
  } catch (e) {
    checks.push({
      status: "fail",
      label: "Default model not configured",
      detail: "Run: opencode providers",
    })
  }

  return checks
}

// --- Section: Agents ---

async function checkAgents(verbose: boolean): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  try {
    const agents = await Agent.list()
    const native = agents.filter((a) => a.native)
    const custom = agents.filter((a) => !a.native)
    checks.push({
      status: "pass",
      label: `${agents.length} agents`,
      detail: `(${native.length} native, ${custom.length} custom)`,
    })

    for (const agent of agents) {
      if (agent.model) {
        try {
          await Provider.getModel(agent.model.providerID, agent.model.modelID)
        } catch {
          checks.push({
            status: "warn",
            label: `Agent "${agent.name}" references unresolvable model`,
            detail: `${agent.model.providerID}/${agent.model.modelID}`,
          })
        }
      }

      if (verbose && agent.description && agent.description.length > 10000) {
        checks.push({
          status: "warn",
          label: `Agent "${agent.name}" has large description`,
          detail: `(${(agent.description.length / 1000).toFixed(1)}K chars — may impact context window)`,
        })
      }
    }
  } catch (e) {
    checks.push({ status: "fail", label: "Could not load agents", detail: String(e) })
  }

  return checks
}

// --- Section: Tools & Permissions ---

async function checkToolsPermissions(verbose: boolean): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  try {
    const config = await Config.get()
    const defaultModel = await Provider.defaultModel()
    const defaultAgentName = await Agent.defaultAgent()
    const agent = await Agent.get(defaultAgentName)
    const tools = await import("../../tool/registry").then((m) => m.ToolRegistry.tools(defaultModel, agent))
    checks.push({
      status: "pass",
      label: `${tools.length} tools available`,
      detail: `(for agent: ${defaultAgentName})`,
    })

    const toolIds = tools.map((t) => t.id)
    const configPermission = config.permission
    if (configPermission) {
      const ruleset = Permission.fromConfig(configPermission)
      const disabledSet = Permission.disabled(toolIds, ruleset)
      if (disabledSet.size > 0) {
        const disabledList = Array.from(disabledSet).join(", ")
        checks.push({
          status: "warn",
          label: `${disabledSet.size} tools disabled by permission rules`,
          detail: verbose ? `(${disabledList})` : undefined,
        })
      } else {
        checks.push({ status: "pass", label: "No tools disabled by permission rules" })
      }
    } else {
      checks.push({ status: "info", label: "No custom permission rules configured" })
    }
  } catch (e) {
    checks.push({ status: "warn", label: "Could not check tool permissions", detail: String(e) })
  }

  return checks
}

// --- Section: LSP Servers ---

async function checkLSP(): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  try {
    const statuses = await LSP.status()
    if (statuses.length === 0) {
      checks.push({ status: "info", label: "No LSP servers running" })
      return checks
    }

    for (const server of statuses) {
      if (server.status === "connected") {
        checks.push({ status: "pass", label: `${server.name}`, detail: `connected (${server.root})` })
      } else {
        checks.push({ status: "fail", label: `${server.name}`, detail: `error (${server.root})` })
      }
    }
  } catch {
    checks.push({ status: "info", label: "LSP not initialized", detail: "(normal for CLI-only usage)" })
  }

  return checks
}

// --- Section: MCP Servers ---

async function checkMCP(verbose: boolean): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  try {
    const statuses = await MCP.status()
    const entries = Object.entries(statuses)

    if (entries.length === 0) {
      checks.push({ status: "info", label: "No MCP servers configured" })
      return checks
    }

    let mcpTools: Record<string, any> = {}
    try {
      mcpTools = await MCP.tools()
    } catch {
      // tools may not be available if servers aren't connected
    }

    for (const [name, status] of entries) {
      if (typeof status === "string") {
        // Simple string status
        if (status === "connected") {
          const toolCount = Object.values(mcpTools).filter((t: any) => t?.client === name).length
          checks.push({
            status: "pass",
            label: name,
            detail: toolCount > 0 ? `connected (${toolCount} tools)` : "connected",
          })
        } else if (status === "disabled") {
          checks.push({ status: "skip", label: name, detail: "disabled" })
        } else if (status === "needs_auth") {
          checks.push({ status: "warn", label: name, detail: "needs authentication" })
        } else {
          checks.push({ status: "fail", label: name, detail: String(status) })
        }
      } else if (typeof status === "object" && status !== null) {
        // Object status
        const s = status as any
        if (s.status === "connected") {
          const toolCount = Object.values(mcpTools).filter((t: any) => t?.client === name).length
          checks.push({
            status: "pass",
            label: name,
            detail: toolCount > 0 ? `connected (${toolCount} tools)` : "connected",
          })
        } else if (s.status === "disabled") {
          checks.push({ status: "skip", label: name, detail: "disabled" })
        } else if (s.status === "needs_auth") {
          checks.push({ status: "warn", label: name, detail: "needs authentication" })
        } else if (s.status === "needs_client_registration") {
          checks.push({
            status: "warn",
            label: name,
            detail: `needs client registration${s.error ? ": " + s.error : ""}`,
          })
        } else if (s.status === "failed") {
          checks.push({ status: "fail", label: name, detail: s.error ?? "failed" })
        } else {
          checks.push({ status: "fail", label: name, detail: String(s.status) })
        }
      }
    }
  } catch {
    checks.push({ status: "info", label: "MCP not initialized", detail: "(normal for CLI-only usage)" })
  }

  return checks
}

// --- Section: Formatters ---

async function checkFormatters(verbose: boolean): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  try {
    const statuses = await Format.status()
    const enabled = statuses.filter((f) => f.enabled)
    const disabled = statuses.filter((f) => !f.enabled)

    if (enabled.length > 0) {
      const summary = enabled.map((f) => `${f.name} (${f.extensions.join(", ")})`).join(", ")
      checks.push({
        status: "pass",
        label: `${enabled.length} formatters active`,
        detail: verbose ? `(${summary})` : undefined,
      })

      if (!verbose) {
        const names = enabled.map((f) => f.name).join(", ")
        checks.push({ status: "info", label: names })
      }
    } else {
      checks.push({ status: "info", label: "No formatters active" })
    }

    if (verbose && disabled.length > 0) {
      checks.push({
        status: "skip",
        label: `${disabled.length} formatters disabled`,
        detail: `(${disabled.map((f) => f.name).join(", ")})`,
      })
    }
  } catch {
    checks.push({ status: "warn", label: "Could not check formatter status" })
  }

  return checks
}

// --- Section: Plugins ---

async function checkPlugins(): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  try {
    const plugins = await Plugin.list()
    if (plugins.length > 0) {
      checks.push({ status: "pass", label: `${plugins.length} plugins loaded` })
    } else {
      checks.push({ status: "info", label: "No plugins loaded" })
    }
  } catch (e) {
    checks.push({ status: "warn", label: "Could not load plugins", detail: String(e) })
  }

  return checks
}

// --- Section: Environment Variables ---

async function checkEnvironmentVariables(verbose: boolean): Promise<CheckResult[]> {
  const checks: CheckResult[] = []
  const activeFlags: string[] = []

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("OPENCODE_")) continue
    if (key === "OPENCODE" || key === "OPENCODE_PID") continue // internal
    activeFlags.push(`${key}=${value}`)
  }

  if (activeFlags.length > 0) {
    checks.push({ status: "info", label: `${activeFlags.length} OPENCODE_* environment variables set` })
    if (verbose) {
      for (const flag of activeFlags.sort()) {
        checks.push({ status: "info", label: `  ${flag}` })
      }
    }
  } else {
    checks.push({ status: "info", label: "No OPENCODE_* environment variables set" })
  }

  // Check for experimental flags
  const experimentalFlags = activeFlags.filter((f) => f.startsWith("OPENCODE_EXPERIMENTAL"))
  if (experimentalFlags.length > 0) {
    checks.push({
      status: "warn",
      label: `${experimentalFlags.length} experimental flags enabled`,
      detail: `(${experimentalFlags.map((f) => f.split("=")[0]).join(", ")})`,
    })
  }

  return checks
}

// --- Section: Paths ---

async function checkPaths(): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  const paths: [string, string][] = [
    ["data", Global.Path.data],
    ["config", Global.Path.config],
    ["cache", Global.Path.cache],
    ["state", Global.Path.state],
    ["log", Global.Path.log],
  ]

  for (const [name, dir] of paths) {
    try {
      await fs.access(dir, fs.constants.W_OK)
      checks.push({ status: "pass", label: `${name.padEnd(8)} ${dir}` })
    } catch {
      try {
        await fs.access(dir, fs.constants.R_OK)
        checks.push({ status: "warn", label: `${name.padEnd(8)} ${dir}`, detail: "(read-only)" })
      } catch {
        checks.push({ status: "fail", label: `${name.padEnd(8)} ${dir}`, detail: "(not accessible)" })
      }
    }
  }

  return checks
}

// --- Section: Context Analysis ---

async function checkContext(verbose: boolean): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  try {
    const agents = await Agent.list()
    let totalDescChars = 0
    const largeAgents: string[] = []
    for (const agent of agents) {
      const len = agent.description?.length ?? 0
      totalDescChars += len
      if (len > 10000) largeAgents.push(`${agent.name} (${(len / 1000).toFixed(1)}K)`)
    }

    if (largeAgents.length > 0) {
      checks.push({
        status: "warn",
        label: `${largeAgents.length} agents have large descriptions`,
        detail: `(${largeAgents.join(", ")})`,
      })
    }

    if (verbose) {
      checks.push({
        status: "info",
        label: `Total agent description size: ${(totalDescChars / 1000).toFixed(1)}K chars`,
      })
    }
  } catch {
    // Agent data already covered in agents section
  }

  try {
    const mcpTools = await MCP.tools()
    const toolCount = Object.keys(mcpTools).length
    if (toolCount > 30) {
      checks.push({
        status: "warn",
        label: `${toolCount} MCP tools loaded`,
        detail: "(high tool count may impact context window)",
      })
    } else if (toolCount > 0) {
      checks.push({ status: "pass", label: `${toolCount} MCP tools loaded` })
    }
  } catch {
    // MCP data already covered in MCP section
  }

  if (checks.length === 0) {
    checks.push({ status: "pass", label: "No context pressure issues detected" })
  }

  return checks
}

// --- JSON output ---

function toJSON(sections: Section[]): object {
  let totalPass = 0
  let totalWarn = 0
  let totalFail = 0

  const result = sections.map((section) => {
    for (const check of section.checks) {
      if (check.status === "pass") totalPass++
      else if (check.status === "warn") totalWarn++
      else if (check.status === "fail") totalFail++
    }
    return {
      title: section.title,
      checks: section.checks,
    }
  })

  return {
    version: Installation.VERSION,
    channel: Installation.CHANNEL,
    summary: { pass: totalPass, warn: totalWarn, fail: totalFail },
    sections: result,
  }
}

// --- Main ---

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "diagnose your opencode installation and configuration",
  builder: (yargs: Argv) => {
    return yargs
      .option("json", {
        describe: "output as JSON",
        type: "boolean",
        default: false,
      })
      .option("verbose", {
        describe: "show all details including skipped and unconfigured items",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const verbose = !!args.verbose
      const json = !!args.json

      const sections: Section[] = []

      sections.push(await runSection("Environment", checkEnvironment))
      sections.push(await runSection("Updates", checkUpdates))
      sections.push(await runSection("Configuration", checkConfiguration))
      sections.push(await runSection("Providers & Models", () => checkProviders(verbose)))
      sections.push(await runSection("Agents", () => checkAgents(verbose)))
      sections.push(await runSection("Tools & Permissions", () => checkToolsPermissions(verbose)))
      sections.push(await runSection("LSP Servers", checkLSP))
      sections.push(await runSection("MCP Servers", () => checkMCP(verbose)))
      sections.push(await runSection("Formatters", () => checkFormatters(verbose)))
      sections.push(await runSection("Plugins", checkPlugins))
      sections.push(await runSection("Context Analysis", () => checkContext(verbose)))
      sections.push(await runSection("Environment Variables", () => checkEnvironmentVariables(verbose)))
      sections.push(await runSection("Paths", checkPaths))

      if (json) {
        const output = toJSON(sections)
        process.stdout.write(JSON.stringify(output, null, 2) + EOL)
        if ((output as any).summary.fail > 0) process.exit(1)
        return
      }

      // Summary counts
      let totalPass = 0
      let totalWarn = 0
      let totalFail = 0
      for (const section of sections) {
        for (const check of section.checks) {
          if (check.status === "pass") totalPass++
          else if (check.status === "warn") totalWarn++
          else if (check.status === "fail") totalFail++
        }
      }

      process.stderr.write(EOL)
      for (const section of sections) {
        process.stderr.write(formatSection(section, verbose) + EOL + EOL)
      }

      // Summary line
      const parts: string[] = []
      if (totalPass > 0) parts.push(`${UI.Style.TEXT_SUCCESS}${totalPass} passed${UI.Style.TEXT_NORMAL}`)
      if (totalWarn > 0) parts.push(`${UI.Style.TEXT_WARNING}${totalWarn} warnings${UI.Style.TEXT_NORMAL}`)
      if (totalFail > 0) parts.push(`${UI.Style.TEXT_DANGER}${totalFail} errors${UI.Style.TEXT_NORMAL}`)
      process.stderr.write(parts.join(", ") + EOL)

      if (totalFail > 0) process.exit(1)
    })
  },
})
