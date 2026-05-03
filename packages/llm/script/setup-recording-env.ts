#!/usr/bin/env bun

import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

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

const selectedProviders = () => {
  if (!providerOption) return PROVIDERS.filter((provider) => provider.tier === "core" || provider.tier === "canary")
  if (providerOption === "all") return PROVIDERS
  const ids = new Set(providerOption.split(",").map((item) => item.trim()).filter(Boolean))
  return PROVIDERS.filter((provider) => ids.has(provider.id))
}

const readEnvFile = async () => {
  try {
    return await Bun.file(envPath).text()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""
    throw error
  }
}

const parseEnv = (contents: string) =>
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

const status = (name: string, fileEnv: Record<string, string>) => {
  if (fileEnv[name]) return "file"
  if (process.env[name]) return "shell"
  return "missing"
}

const printStatus = (providers: ReadonlyArray<Provider>, fileEnv: Record<string, string>) => {
  console.log(`Recording env: ${envPath}`)
  console.log("")
  for (const provider of providers) {
    console.log(`${provider.label} (${provider.tier}) - ${provider.note}`)
    for (const item of provider.vars) {
      const value = status(item.name, fileEnv)
      const suffix = item.optional ? " optional" : ""
      console.log(`  ${value === "missing" ? "missing" : "set"} ${item.name}${suffix}${value === "shell" ? " (shell only)" : ""}`)
    }
  }
  console.log("")
}

const question = async (rl: readline.Interface, prompt: string) => (await rl.question(prompt)).trim()

const secret = async (prompt: string) => {
  if (!input.isTTY) return ""
  output.write(prompt)
  input.setRawMode(true)
  input.resume()
  return await new Promise<string>((resolve) => {
    let value = ""
    const onData = (buffer: Buffer) => {
      const char = buffer.toString("utf8")
      if (char === "\u0003") process.exit(130)
      if (char === "\r" || char === "\n") {
        input.setRawMode(false)
        input.off("data", onData)
        output.write("\n")
        resolve(value)
        return
      }
      if (char === "\u007f") {
        value = value.slice(0, -1)
        return
      }
      value += char
    }
    input.on("data", onData)
  })
}

const upsertEnv = (contents: string, values: Record<string, string>) => {
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

const main = async () => {
  const contents = await readEnvFile()
  const fileEnv = parseEnv(contents)
  const providers = selectedProviders()
  printStatus(providers, fileEnv)
  if (checkOnly) return

  const rl = readline.createInterface({ input, output })
  const values: Record<string, string> = {}
  for (const provider of providers) {
    const missing = provider.vars.filter((item) => !item.optional && status(item.name, fileEnv) === "missing")
    if (missing.length === 0) continue
    const add = (await question(rl, `Add missing ${provider.label} credential${missing.length === 1 ? "" : "s"}? [y/N] `)).toLowerCase()
    if (add !== "y" && add !== "yes") continue
    for (const item of missing) {
      const value = await secret(`${item.name}${item.label ? ` (${item.label})` : ""}: `)
      if (value !== "") values[item.name] = value
    }
  }
  rl.close()

  if (Object.keys(values).length === 0) {
    console.log("No changes.")
    return
  }

  await fs.mkdir(path.dirname(envPath), { recursive: true })
  await fs.writeFile(envPath, upsertEnv(contents, values), { mode: 0o600 })
  console.log(`Saved ${Object.keys(values).length} value${Object.keys(values).length === 1 ? "" : "s"} to ${envPath}`)
  console.log("Keep this file local. For shared team credentials, store the source secrets in your password manager/vault.")
}

await main()
