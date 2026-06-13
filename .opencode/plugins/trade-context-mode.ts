import type { Hooks, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import path from "path"
import { pathToFileURL } from "url"

type TradeContextMode = "off" | "tools" | "shadow"

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const readMode = (): TradeContextMode => {
  const raw = process.env.OPENCODE_TRADE_CONTEXT_MODE?.trim().toLowerCase()
  if (raw === "tools" || raw === "shadow") return raw
  return "off"
}

const runHookSafely = async (
  mode: TradeContextMode,
  name: string,
  hook: () => Promise<void> | void,
) => {
  try {
    await hook()
  } catch (error) {
    if (mode === "off") return
    console.warn(`[trade-context-mode] ${name} failed`, error)
  }
}

const resolveDelegateSpec = (raw: string) => {
  const value = raw.trim()
  if (value.includes("://")) return value
  if (value.startsWith(".") || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
    return pathToFileURL(path.resolve(process.cwd(), value)).href
  }
  return value
}

const loadContextModeDelegate = async (
  input: PluginInput,
  options: PluginOptions | undefined,
): Promise<Hooks | undefined> => {
  const configured = process.env.OPENCODE_TRADE_CONTEXT_MODE_DELEGATE?.trim()
  const candidate = configured && resolveDelegateSpec(configured)
  if (!candidate) return undefined

  try {
    const module = await import(candidate)
    const factory = module.default
    if (typeof factory !== "function") return undefined
    const hooks = await factory(input, options)
    return hooks ?? undefined
  } catch (error) {
    console.warn(`[trade-context-mode] context-mode delegate import failed: ${candidate}`, error)
    return undefined
  }
}

const toolOnlyHooks = (hooks: Hooks) => {
  const tool = hooks.tool
  if (!isRecord(tool)) return {}

  const filtered = Object.fromEntries(
    Object.entries(tool).filter(
      ([name, value]) =>
        name.startsWith("ctx_") &&
        isRecord(value) &&
        typeof value.execute === "function",
    ),
  ) as Hooks["tool"]

  if (!filtered || Object.keys(filtered).length === 0) return {}
  return { tool: filtered }
}

const shadowHooks = (mode: TradeContextMode, hooks: Hooks | undefined) => {
  const fromDelegate = hooks?.["tool.execute.after"]
  if (typeof fromDelegate === "function") {
    const hook: NonNullable<Hooks["tool.execute.after"]> = async (input, output) => {
      await runHookSafely(mode, "tool.execute.after", () => fromDelegate(input, output))
    }
    return {
      "tool.execute.after": hook,
    }
  }

  return {
    "tool.execute.after": async () => {},
  }
}

export default (async (input, options) => {
  const mode = readMode()

  if (mode === "off") return {}

  if (mode === "tools") {
    const hooks = await loadContextModeDelegate(input, options)
    if (!hooks) return {}
    return toolOnlyHooks(hooks)
  }

  const hooks = await loadContextModeDelegate(input, options)
  return shadowHooks(mode, hooks)
}) satisfies Plugin
