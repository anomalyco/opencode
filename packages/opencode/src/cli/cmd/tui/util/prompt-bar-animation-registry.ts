import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Glob } from "@/util/glob"
import { Log } from "@/util/log"
import { pathToFileURL } from "node:url"
import type { PromptBarAnimationInput, PromptBarAnimationPlugin } from "./prompt-bar-animation-plugin"
import { resolvePromptBarOverlay } from "./prompt-bar-visual"

export const DEFAULT_PROMPT_BAR_ANIMATION_PLUGIN = "legacy-cycle"
const log = Log.create({ service: "tui.prompt-bar-animation.registry" })

const stateStaticPlugin: PromptBarAnimationPlugin = {
  id: "state-static",
  label: "State static",
  interval_ms: 0,
  resolve(input) {
    if (input.state !== "idle") {
      switch (input.state) {
        case "error":
          return input.theme.error
        case "warning":
          return input.theme.warning
        case "tool_running":
          return input.theme.info
        case "streaming":
          return input.theme.primary
        case "tool_result":
          return input.theme.success
        case "assistant_final":
          return input.theme.secondary
        default:
          return undefined
      }
    }

    if (input.hasContent) return input.theme.secondary
    return undefined
  },
}

const THEME_WAVE_PALETTE = ["accent", "info", "primary", "success", "warning", "secondary"] as const

const themeWavePlugin: PromptBarAnimationPlugin = {
  id: "theme-wave",
  label: "Theme wave",
  interval_ms: 220,
  resolve(input) {
    if (input.state !== "idle") return legacyCyclePlugin.resolve(input)
    if (input.hasContent) return input.theme.accent
    if (!input.idleCycleEnabled) return undefined
    const key = THEME_WAVE_PALETTE[input.idleCycleIndex % THEME_WAVE_PALETTE.length]
    return input.theme[key]
  },
}

const legacyCyclePlugin: PromptBarAnimationPlugin = {
  id: DEFAULT_PROMPT_BAR_ANIMATION_PLUGIN,
  label: "Legacy cycle",
  interval_ms: 1000,
  resolve(input) {
    return resolvePromptBarOverlay(input)
  },
}

const registry = new Map<string, PromptBarAnimationPlugin>([
  [legacyCyclePlugin.id, legacyCyclePlugin],
  [themeWavePlugin.id, themeWavePlugin],
  [stateStaticPlugin.id, stateStaticPlugin],
])
const seen = new Set<string>()
let loading: Promise<void> | undefined

function isPlugin(value: unknown): value is PromptBarAnimationPlugin {
  if (!value || typeof value !== "object") return false
  if (!("id" in value) || typeof value.id !== "string" || value.id.length === 0) return false
  if (!("label" in value) || typeof value.label !== "string") return false
  if (!("interval_ms" in value) || typeof value.interval_ms !== "number") return false
  if (!Number.isFinite(value.interval_ms) || value.interval_ms < 0) return false
  if (!("resolve" in value) || typeof value.resolve !== "function") return false
  return true
}

function applyModule(mod: Record<string, unknown>, source: string) {
  const dedupe = new Set<PromptBarAnimationPlugin>()
  for (const value of Object.values(mod)) {
    if (!isPlugin(value)) continue
    if (dedupe.has(value)) continue
    dedupe.add(value)
    registerPromptBarAnimationPlugin(value)
    log.info("loaded prompt bar animation plugin", {
      source,
      plugin: value.id,
    })
  }
}

async function dirs() {
  return [
    Global.Path.config,
    ...(await Array.fromAsync(
      Filesystem.up({
        targets: [".opencode"],
        start: process.cwd(),
      }),
    )),
  ]
}

export async function loadPromptBarAnimationPlugins(input?: { directories?: string[] }) {
  if (loading) return loading
  loading = (async () => {
    const source = input?.directories ?? (await dirs())
    const directories = source.length <= 1 ? source : [source[0], ...source.slice(1).toReversed()]
    for (const dir of directories) {
      const files = await Glob.scan("prompt-bar-animations/*.{ts,js,mjs,cjs}", {
        cwd: dir,
        absolute: true,
        dot: true,
        symlink: true,
      }).catch(() => [] as string[])

      for (const file of files) {
        if (seen.has(file)) continue
        seen.add(file)
        await import(pathToFileURL(file).href)
          .then((mod) => {
            applyModule(mod as Record<string, unknown>, file)
          })
          .catch((error) => {
            log.warn("failed to load prompt bar animation plugin file", {
              file,
              error,
            })
          })
      }
    }
  })().finally(() => {
    loading = undefined
  })
  return loading
}

export function registerPromptBarAnimationPlugin(plugin: PromptBarAnimationPlugin) {
  registry.set(plugin.id, plugin)
}

export function listPromptBarAnimationPlugins() {
  return [...registry.values()]
}

export function resolvePromptBarAnimationPlugin(plugin?: string) {
  if (plugin) {
    const selected = registry.get(plugin)
    if (selected) return selected
  }
  return legacyCyclePlugin
}

export function resolvePromptBarAnimationBackground(input: {
  plugin: PromptBarAnimationPlugin
  fallback: PromptBarAnimationPlugin
  data: PromptBarAnimationInput
}) {
  try {
    return input.plugin.resolve(input.data)
  } catch {
    return input.fallback.resolve(input.data)
  }
}
