import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import { validateProviderURL } from "../../security"
import { Config } from "../../config/config"
import { Workflow } from "../../workflow"
import { RECOMMENDED_TOOLS } from "../../mcp/recommended"
import path from "path"

const NINEROUTER_ID = "9router"
const NINEROUTER_NAME = "9Router"
const NINEROUTER_DEFAULT_URL = "http://localhost:20123/v1"

const ALL_SECURITY_MODULES = [
  { value: "ssrf", label: "SSRF protection", hint: "Blocks requests to internal IPs and cloud metadata endpoints" },
  { value: "promptInjection", label: "Prompt injection detection", hint: "Scans input for override and jailbreak patterns" },
  { value: "pathTraversal", label: "Path traversal prevention", hint: "Blocks ../ escapes and NUL byte injection" },
  { value: "auditLog", label: "Audit log", hint: "SHA-256 chained append-only log of sensitive operations" },
  { value: "rateLimiting", label: "Rate limiting", hint: "Token-bucket rate limiting in server mode" },
  { value: "headers", label: "Security headers", hint: "CSP, X-Frame-Options, HSTS, and more" },
] as const

export const OnboardCommand = cmd({
  command: "onboard",
  describe: "interactive setup — choose a provider and model to get started",
  async handler() {
    prompts.intro(UI.logo() + "\n  Welcome to CoBuilder — let's get you set up")

    prompts.log.step("Step 1 of 4 — Choose your provider")

    // Step 1: Provider selection
    const providerChoice = await prompts.select({
      message: "Which provider would you like to use?",
      options: [
        { value: "9router", label: "9Router", hint: "Local OpenAI-compatible proxy" },
        { value: "anthropic", label: "Anthropic", hint: "Claude models via API key" },
        { value: "openai", label: "OpenAI", hint: "GPT models via API key" },
        { value: "openrouter", label: "OpenRouter", hint: "Many providers via one API key" },
        { value: "google", label: "Google", hint: "Gemini models via API key" },
      ],
    })

    if (prompts.isCancel(providerChoice)) {
      prompts.cancel("Setup cancelled.")
      process.exit(0)
    }

    if (providerChoice === NINEROUTER_ID) {
      await setup9Router()
    } else {
      await setupApiKeyProvider(providerChoice as string)
    }

    await setupSecurity()
    await setupWorkflows()
    await setupRecommendedTools()

    prompts.outro("All set! Run  cobuilder  to start coding.")
  },
})

async function setup9Router() {
  // Step 2: URL
  const urlInput = await prompts.text({
    message: "9Router URL",
    placeholder: NINEROUTER_DEFAULT_URL,
    initialValue: NINEROUTER_DEFAULT_URL,
    validate: (v) => {
      if (!v || !/^https?:\/\//.test(v)) return "Must be a valid http/https URL"
    },
  })

  if (prompts.isCancel(urlInput)) {
    prompts.cancel("Setup cancelled.")
    process.exit(0)
  }

  const baseURL = (urlInput as string).trim().replace(/\/+$/, "")

  // SSRF validation (default-on: skipped only if explicitly disabled)
  const cfg = await Config.get()
  if (cfg.security?.ssrf?.enabled !== false) {
    const ssrfCheck = validateProviderURL(baseURL, { allowLocalhost: true })
    if (!ssrfCheck.ok) {
      prompts.log.error(ssrfCheck.reason)
      process.exit(1)
    }
  }

  // Step 3: Test connection + fetch models
  const spin = prompts.spinner()
  spin.start("Testing connection…")

  let modelIds: string[] = []
  try {
    const res = await fetch(`${baseURL}/models`)
    if (!res.ok) throw new Error(`Server returned ${res.status}`)
    const json = (await res.json()) as any
    modelIds = ((json?.data ?? []) as any[]).map((m) => String(m.id)).filter(Boolean)
    if (modelIds.length === 0) throw new Error("No models returned by server")
    spin.stop(`Connected — ${modelIds.length} models available`)
  } catch (e) {
    spin.stop("Connection failed")
    prompts.log.error(e instanceof Error ? e.message : "Could not reach 9Router")
    prompts.outro("Check your URL and make sure 9Router is running, then try again.")
    process.exit(1)
  }

  // Step 4: Model selection
  const modelChoice = await prompts.select({
    message: "Which model would you like to use?",
    options: modelIds.map((id) => ({ value: id, label: id })),
  })

  if (prompts.isCancel(modelChoice)) {
    prompts.cancel("Setup cancelled.")
    process.exit(0)
  }

  const defaultModelId = modelChoice as string
  const chosenIds = [defaultModelId]

  // Step 6: Save config
  const modelConfig: Record<string, { name: string }> = {}
  for (const id of chosenIds) modelConfig[id] = { name: id }

  const configPath = path.join(Global.Path.config, "opencode.json")
  let existing: any = {}
  try {
    existing = await Filesystem.readJson(configPath)
  } catch {}

  // If enabled_providers exists, ensure our provider is in the list
  const existingEnabled: string[] | undefined = existing?.enabled_providers
  const enabledProviders = existingEnabled
    ? Array.from(new Set([...existingEnabled, NINEROUTER_ID]))
    : undefined

  const updated: any = {
    ...existing,
    model: `${NINEROUTER_ID}/${defaultModelId}`,
    provider: {
      ...existing?.provider,
      [NINEROUTER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: NINEROUTER_NAME,
        options: { baseURL: `${baseURL}/v1`.replace(/\/v1\/v1$/, "/v1"), apiKey: "9router" },
        models: modelConfig,
      },
    },
  }
  if (enabledProviders) updated.enabled_providers = enabledProviders

  await Filesystem.writeJson(configPath, updated)

  prompts.log.success(`Default model: ${NINEROUTER_ID}/${defaultModelId}`)
}

async function setupApiKeyProvider(providerId: string) {
  const names: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    google: "Google",
  }
  const name = names[providerId] ?? providerId

  const apiKey = await prompts.text({
    message: `Enter your ${name} API key`,
    placeholder: "sk-...",
    validate: (v) => {
      if (!v?.trim()) return "API key is required"
    },
  })

  if (prompts.isCancel(apiKey)) {
    prompts.cancel("Setup cancelled.")
    process.exit(0)
  }

  // Write to auth file
  const authPath = path.join(Global.Path.data, "auth.json")
  let existing: any = {}
  try {
    existing = await Filesystem.readJson(authPath)
  } catch {}

  existing[providerId] = { type: "api", key: (apiKey as string).trim() }
  await Filesystem.writeJson(authPath, existing, 0o600)

  prompts.log.success(`${name} connected`)
}

async function setupSecurity() {
  prompts.log.step("Step 2 of 4 — Security modules")

  const selected = await prompts.multiselect({
    message: "Which security modules should be enabled?",
    options: ALL_SECURITY_MODULES.map((m) => ({ ...m })),
    initialValues: ALL_SECURITY_MODULES.map((m) => m.value),
    required: false,
  })

  if (prompts.isCancel(selected)) return

  const enabledSet = new Set(selected as string[])
  const allKeys = ALL_SECURITY_MODULES.map((m) => m.value)

  const disabled = allKeys.filter((k) => !enabledSet.has(k))

  if (disabled.length === 0) {
    prompts.log.info("All security modules enabled (default)")
    return
  }

  // Only write entries for explicitly disabled modules — enabled is the default
  const securityConfig: Record<string, { enabled: false }> = {}
  for (const mod of disabled) {
    securityConfig[mod] = { enabled: false }
  }

  const configPath = path.join(Global.Path.config, "opencode.json")
  let existing: any = {}
  try {
    existing = await Filesystem.readJson(configPath)
  } catch {}

  await Filesystem.writeJson(configPath, {
    ...existing,
    security: { ...existing?.security, ...securityConfig },
  })

  prompts.log.success(
    `${disabled.length} module${disabled.length !== 1 ? "s" : ""} disabled: ${disabled.join(", ")}`,
  )
}

async function setupWorkflows() {
  prompts.log.step("Step 3 of 4 — Workflow plugins (optional)")

  const selected = await prompts.multiselect({
    message: "Which workflow plugins would you like to install?",
    options: [
      { value: "gsd", label: "GSD", hint: "Get Shit Done — structured planning and execution methodology" },
    ],
    initialValues: [],
    required: false,
  })

  if (prompts.isCancel(selected) || (selected as string[]).length === 0) {
    prompts.log.info("No workflow plugins installed — run  cobuilder workflow add <name>  anytime")
    return
  }

  const toInstall = selected as string[]

  for (const alias of toInstall) {
    const spin = prompts.spinner()
    spin.start(`Installing ${alias}…`)
    try {
      await Workflow.install(alias)
      spin.stop(`${alias} installed`)
    } catch (e) {
      spin.stop(`${alias} failed`)
      prompts.log.warn(e instanceof Error ? e.message : `Could not install ${alias} — try  cobuilder workflow add ${alias}  later`)
    }
  }
}

async function setupRecommendedTools() {
  const configPath = path.join(Global.Path.config, "opencode.json")

  // Read current config to skip already-installed tools
  let existing: any = {}
  try {
    existing = await Filesystem.readJson(configPath)
  } catch {}

  const alreadyConfigured = new Set(Object.keys(existing?.mcp ?? {}))
  const available = RECOMMENDED_TOOLS.filter((t) => !alreadyConfigured.has(t.id))

  if (available.length === 0) {
    prompts.log.info("Recommended tools — all already installed")
    return
  }

  prompts.log.step("Step 4 of 4 — Recommended tools (optional)")

  const selected = await prompts.multiselect({
    message: "Which recommended tools would you like to install?",
    options: available.map((t) => ({
      value: t.id,
      label: `${t.label}  ${t.source}`,
      hint: t.hint,
    })),
    initialValues: [],
    required: false,
  })

  if (prompts.isCancel(selected) || (selected as string[]).length === 0) {
    prompts.log.info("No tools installed — you can add them anytime via  cobuilder mcp")
    return
  }

  const toInstall = RECOMMENDED_TOOLS.filter((t) => (selected as string[]).includes(t.id))

  for (const tool of toInstall) {
    const spin = prompts.spinner()
    spin.start(`Installing ${tool.label}…`)
    try {
      if (tool.type === "mcp" && tool.mcpConfig) {
        // Write MCP config to opencode.json
        let cfg: any = {}
        try { cfg = await Filesystem.readJson(configPath) } catch {}
        await Filesystem.writeJson(configPath, {
          ...cfg,
          mcp: { ...cfg?.mcp, [tool.id]: tool.mcpConfig },
        })
        spin.stop(`${tool.label} configured`)
      } else if (tool.type === "cli" && tool.installCommands) {
        // Run install commands sequentially
        for (const cmd of tool.installCommands) {
          const parts = cmd.split(" ")
          const proc = Bun.spawn(parts, { stdout: "pipe", stderr: "pipe" })
          const code = await proc.exited
          if (code !== 0) throw new Error(`Command failed: ${cmd}`)
        }
        spin.stop(`${tool.label} installed`)
      }
    } catch (e) {
      spin.stop(`${tool.label} failed`)
      prompts.log.warn(
        `Could not install ${tool.label} automatically.\n  Manual install: ${tool.manualInstall}\n  Source: ${tool.source}`,
      )
    }
  }
}
