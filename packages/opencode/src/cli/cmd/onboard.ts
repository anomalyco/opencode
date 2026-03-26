import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import path from "path"

const NINEROUTER_ID = "9router"
const NINEROUTER_NAME = "9Router"
const NINEROUTER_DEFAULT_URL = "http://localhost:20123/v1"

export const OnboardCommand = cmd({
  command: "onboard",
  describe: "interactive setup — choose a provider and model to get started",
  async handler() {
    prompts.intro(UI.logo() + "\n  Welcome to CoBuilder — let's get you set up")

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
  prompts.log.info("Available models:\n" + modelIds.map((id, i) => `  ${i + 1}. ${id}`).join("\n"))

  const selectionInput = await prompts.text({
    message: 'Select models (enter numbers separated by commas, or "all")',
    placeholder: "e.g. 1,2,5 or all",
    validate: (v) => {
      if (!v?.trim()) return "Please select at least one model"
      if (v.trim() === "all") return
      const parts = v.split(",").map((s) => s.trim())
      for (const p of parts) {
        const n = parseInt(p)
        if (isNaN(n) || n < 1 || n > modelIds.length) return `"${p}" is not a valid number (1–${modelIds.length})`
      }
    },
  })

  if (prompts.isCancel(selectionInput)) {
    prompts.cancel("Setup cancelled.")
    process.exit(0)
  }

  const raw = (selectionInput as string).trim()
  const chosenIds =
    raw === "all"
      ? modelIds
      : raw
          .split(",")
          .map((s) => parseInt(s.trim()) - 1)
          .map((i) => modelIds[i])
          .filter(Boolean)

  // Step 5: Default model
  let defaultModelId = chosenIds[0]
  if (chosenIds.length > 1) {
    const defaultChoice = await prompts.select({
      message: "Which model should be your default?",
      options: chosenIds.map((id) => ({ value: id, label: id })),
    })
    if (!prompts.isCancel(defaultChoice)) {
      defaultModelId = defaultChoice as string
    }
  }

  // Step 6: Save config
  const modelConfig: Record<string, { name: string }> = {}
  for (const id of chosenIds) modelConfig[id] = { name: id }

  const configPath = path.join(Global.Path.config, "opencode.json")
  let existing: any = {}
  try {
    existing = await Filesystem.readJson(configPath)
  } catch {}

  const updated = {
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

  await Filesystem.writeJson(configPath, updated)

  prompts.log.success(`${chosenIds.length} model${chosenIds.length !== 1 ? "s" : ""} registered`)
  prompts.log.success(`Default model: ${NINEROUTER_ID}/${defaultModelId}`)
  prompts.outro("All set! Run  opencode  to start coding.")
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
  prompts.outro("All set! Run  opencode  to start coding.")
}
