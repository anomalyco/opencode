#!/usr/bin/env bun

import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as prompts from "@clack/prompts"
import { AwsV4Signer } from "aws4fetch"

type Provider = {
  readonly id: string
  readonly label: string
  readonly tier: "core" | "canary" | "compatible" | "optional"
  readonly note: string
  readonly vars: ReadonlyArray<{
    readonly name: string
    readonly label?: string
    readonly optional?: boolean
  }>
}

const PROVIDERS: ReadonlyArray<Provider> = [
  {
    id: "openai",
    label: "OpenAI",
    tier: "core",
    note: "Native OpenAI Chat / Responses recorded tests",
    vars: [{ name: "OPENAI_API_KEY" }],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    tier: "core",
    note: "Native Anthropic Messages recorded tests",
    vars: [{ name: "ANTHROPIC_API_KEY" }],
  },
  {
    id: "google",
    label: "Google Gemini",
    tier: "core",
    note: "Native Gemini recorded tests",
    vars: [{ name: "GOOGLE_GENERATIVE_AI_API_KEY" }],
  },
  {
    id: "bedrock",
    label: "Amazon Bedrock",
    tier: "core",
    note: "Native Bedrock Converse recorded tests",
    vars: [
      { name: "AWS_ACCESS_KEY_ID" },
      { name: "AWS_SECRET_ACCESS_KEY" },
      { name: "AWS_SESSION_TOKEN", optional: true },
      { name: "BEDROCK_RECORDING_REGION", optional: true },
      { name: "BEDROCK_MODEL_ID", optional: true },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    tier: "canary",
    note: "Fast OpenAI-compatible canary for text/tool streaming",
    vars: [{ name: "GROQ_API_KEY" }],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    tier: "canary",
    note: "Router canary for OpenAI-compatible text/tool streaming",
    vars: [{ name: "OPENROUTER_API_KEY" }],
  },
  {
    id: "xai",
    label: "xAI",
    tier: "canary",
    note: "OpenAI-compatible xAI chat endpoint",
    vars: [{ name: "XAI_API_KEY" }],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    tier: "compatible",
    note: "Existing OpenAI-compatible recorded tests",
    vars: [{ name: "DEEPSEEK_API_KEY" }],
  },
  {
    id: "togetherai",
    label: "TogetherAI",
    tier: "compatible",
    note: "Existing OpenAI-compatible text/tool recorded tests",
    vars: [{ name: "TOGETHER_AI_API_KEY" }],
  },
  {
    id: "mistral",
    label: "Mistral",
    tier: "optional",
    note: "OpenAI-compatible bridge; native reasoning parity is follow-up work",
    vars: [{ name: "MISTRAL_API_KEY" }],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    tier: "optional",
    note: "OpenAI-compatible bridge; citations/search metadata are follow-up work",
    vars: [{ name: "PERPLEXITY_API_KEY" }],
  },
  {
    id: "venice",
    label: "Venice",
    tier: "optional",
    note: "OpenAI-compatible bridge",
    vars: [{ name: "VENICE_API_KEY" }],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    tier: "optional",
    note: "OpenAI-compatible bridge",
    vars: [{ name: "CEREBRAS_API_KEY" }],
  },
  {
    id: "deepinfra",
    label: "DeepInfra",
    tier: "optional",
    note: "OpenAI-compatible bridge",
    vars: [{ name: "DEEPINFRA_API_KEY" }],
  },
  {
    id: "fireworks",
    label: "Fireworks",
    tier: "optional",
    note: "OpenAI-compatible bridge",
    vars: [{ name: "FIREWORKS_API_KEY" }],
  },
  {
    id: "baseten",
    label: "Baseten",
    tier: "optional",
    note: "OpenAI-compatible bridge",
    vars: [{ name: "BASETEN_API_KEY" }],
  },
]

const args = process.argv.slice(2)
const hasFlag = (name: string) => args.includes(name)
const option = (name: string) => {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

const envPath = path.resolve(process.cwd(), option("--env") ?? ".env.local")
const checkOnly = hasFlag("--check")
const providerOption = option("--providers")
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)

type Env = Record<string, string>

const providersForOption = (value: string | undefined) => {
  if (!value || value === "recommended") return PROVIDERS.filter((provider) => provider.tier === "core" || provider.tier === "canary")
  if (value === "recorded") return PROVIDERS.filter((provider) => provider.tier !== "optional")
  if (value === "all") return PROVIDERS
  const ids = new Set(value.split(",").map((item) => item.trim()).filter(Boolean))
  return PROVIDERS.filter((provider) => ids.has(provider.id))
}

const chooseProviders = async () => {
  if (providerOption) return providersForOption(providerOption)
  return providersForOption("recommended")
}

const readEnvFile = async () => {
  try {
    return await Bun.file(envPath).text()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""
    throw error
  }
}

const parseEnv = (contents: string): Env =>
  Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1], unquote(match[2] ?? "")]),
  )

const unquote = (value: string) => {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return JSON.parse(trimmed)
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1)
  return trimmed.split(/\s+#/)[0]?.trim() ?? ""
}

const quote = (value: string) => JSON.stringify(value)

const status = (name: string, fileEnv: Env) => {
  if (fileEnv[name]) return "file"
  if (process.env[name]) return "shell"
  return "missing"
}

const statusLine = (provider: Provider, fileEnv: Env) =>
  [
    `${provider.label} (${provider.tier})`,
    provider.note,
    ...provider.vars.map((item) => {
      const value = status(item.name, fileEnv)
      const suffix = item.optional ? " optional" : ""
      return `  ${value === "missing" ? "missing" : "set"} ${item.name}${suffix}${value === "shell" ? " (shell only)" : ""}`
    }),
  ].join("\n")

const printStatus = (providers: ReadonlyArray<Provider>, fileEnv: Env) => {
  prompts.note(providers.map((provider) => statusLine(provider, fileEnv)).join("\n\n"), `Recording env: ${envPath}`)
}

const exitIfCancel = <A>(value: A | symbol): A => {
  if (!prompts.isCancel(value)) return value
  prompts.cancel("Cancelled")
  process.exit(130)
}

const upsertEnv = (contents: string, values: Env) => {
  const names = Object.keys(values)
  const seen = new Set<string>()
  const lines = contents.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (!match || !names.includes(match[1])) return line
    seen.add(match[1])
    return `${match[1]}=${quote(values[match[1]])}`
  })
  const missing = names.filter((name) => !seen.has(name))
  if (missing.length === 0) return lines.join("\n").replace(/\n*$/, "\n")
  const prefix = lines.join("\n").trimEnd()
  const block = ["", "# Added by bun run setup:recording-env", ...missing.map((name) => `${name}=${quote(values[name])}`)].join("\n")
  return `${prefix}${block}\n`
}

const providerRequiredStatus = (provider: Provider, fileEnv: Env) => {
  const required = provider.vars.filter((item) => !item.optional)
  if (required.some((item) => status(item.name, fileEnv) === "missing")) return "missing"
  if (required.some((item) => status(item.name, fileEnv) === "shell")) return "set in shell"
  return "already added"
}

const envWithValues = (fileEnv: Env, values: Env): Env => ({
  ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  ...fileEnv,
  ...values,
})

const validateBearer = async (url: string, token: string, headers: Record<string, string> = {}) => {
  const response = await fetch(url, { headers: { ...headers, authorization: `Bearer ${token}` } })
  if (response.ok) return undefined
  return `${response.status} ${response.statusText}`
}

const validateProvider = async (provider: Provider, env: Env) => {
  try {
    if (provider.id === "openai") return await validateBearer("https://api.openai.com/v1/models", env.OPENAI_API_KEY)
    if (provider.id === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "anthropic-version": "2023-06-01", "x-api-key": env.ANTHROPIC_API_KEY },
      })
      if (response.ok) return undefined
      return `${response.status} ${response.statusText}`
    }
    if (provider.id === "google") {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(env.GOOGLE_GENERATIVE_AI_API_KEY)}`)
      if (response.ok) return undefined
      return `${response.status} ${response.statusText}`
    }
    if (provider.id === "bedrock") {
      const request = await new AwsV4Signer({
        url: `https://bedrock.${env.BEDROCK_RECORDING_REGION || "us-east-1"}.amazonaws.com/foundation-models`,
        method: "GET",
        service: "bedrock",
        region: env.BEDROCK_RECORDING_REGION || "us-east-1",
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        sessionToken: env.AWS_SESSION_TOKEN || undefined,
      }).sign()
      const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body })
      if (response.ok) return undefined
      return `${response.status} ${response.statusText}`
    }
    if (provider.id === "groq") return await validateBearer("https://api.groq.com/openai/v1/models", env.GROQ_API_KEY)
    if (provider.id === "openrouter") return await validateBearer("https://openrouter.ai/api/v1/models", env.OPENROUTER_API_KEY)
    if (provider.id === "xai") return await validateBearer("https://api.x.ai/v1/models", env.XAI_API_KEY)
    if (provider.id === "deepseek") return await validateBearer("https://api.deepseek.com/models", env.DEEPSEEK_API_KEY)
    if (provider.id === "togetherai") return await validateBearer("https://api.together.xyz/v1/models", env.TOGETHER_AI_API_KEY)
    if (provider.id === "mistral") return await validateBearer("https://api.mistral.ai/v1/models", env.MISTRAL_API_KEY)
    if (provider.id === "perplexity") return await validateBearer("https://api.perplexity.ai/models", env.PERPLEXITY_API_KEY)
    if (provider.id === "venice") return await validateBearer("https://api.venice.ai/api/v1/models", env.VENICE_API_KEY)
    if (provider.id === "cerebras") return await validateBearer("https://api.cerebras.ai/v1/models", env.CEREBRAS_API_KEY)
    if (provider.id === "deepinfra") return await validateBearer("https://api.deepinfra.com/v1/openai/models", env.DEEPINFRA_API_KEY)
    if (provider.id === "fireworks") return await validateBearer("https://api.fireworks.ai/inference/v1/models", env.FIREWORKS_API_KEY)
    return "no lightweight validator"
  } catch (error) {
    if (error instanceof Error) return error.message
    return String(error)
  }
}

const validateProviders = async (providers: ReadonlyArray<Provider>, env: Env) => {
  const spinner = prompts.spinner()
  spinner.start("Validating credentials")
  const results = await Promise.all(providers.map(async (provider) => ({ provider, error: await validateProvider(provider, env) })))
  spinner.stop("Validation complete")
  prompts.note(
    results.map((result) => `${result.error ? "failed" : "ok"} ${result.provider.label}${result.error ? ` - ${result.error}` : ""}`).join("\n"),
    "Credential validation",
  )
}

const main = async () => {
  prompts.intro("LLM recording credentials")
  const contents = await readEnvFile()
  const fileEnv = parseEnv(contents)
  const providers = await chooseProviders()
  printStatus(providers, fileEnv)
  if (checkOnly) {
    prompts.outro("Check complete")
    return
  }
  if (!interactive) {
    prompts.outro("Run this command in a terminal to enter credentials")
    return
  }

  const values: Env = {}
  const configurableProviders = providers.filter((provider) => provider.vars.some((item) => !item.optional))

  const selected = exitIfCancel(await prompts.multiselect({
    message: "Select provider credentials to add or override",
    options: configurableProviders.map((provider) => ({
      value: provider.id,
      label: provider.label,
      hint: `${providerRequiredStatus(provider, fileEnv)} - ${provider.vars.filter((item) => !item.optional).map((item) => item.name).join(", ")}`,
    })),
    initialValues: configurableProviders
      .filter((provider) => providerRequiredStatus(provider, fileEnv) === "missing")
      .map((provider) => provider.id),
  }))

  const selectedProviders = configurableProviders.filter((provider) => selected.includes(provider.id))
  for (const provider of selectedProviders) {
    prompts.log.info(`${provider.label}: ${provider.note}`)
    for (const item of provider.vars.filter((item) => !item.optional)) {
      const value = exitIfCancel(await prompts.password({
        message: item.label ?? item.name,
        validate: (input) => !input || input.length === 0 ? "Leave blank by pressing Esc/cancel, or paste a value" : undefined,
      }))
      if (value !== "") values[item.name] = value
    }
  }

  if (Object.keys(values).length === 0) {
    prompts.outro("No changes")
    return
  }

  if (interactive && exitIfCancel(await prompts.confirm({ message: "Validate credentials before saving?", initialValue: true }))) {
    await validateProviders(selectedProviders, envWithValues(fileEnv, values))
  }

  await fs.mkdir(path.dirname(envPath), { recursive: true })
  await fs.writeFile(envPath, upsertEnv(contents, values), { mode: 0o600 })
  prompts.log.success(`Saved ${Object.keys(values).length} value${Object.keys(values).length === 1 ? "" : "s"} to ${envPath}`)
  prompts.outro("Keep .env.local local. Store shared team credentials in a password manager or vault.")
}

await main()
