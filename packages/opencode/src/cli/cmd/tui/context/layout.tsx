import path from "path"
import { createEffect, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useSync } from "@tui/context/sync"
import { createSimpleContext } from "./helper"
import { useKV } from "./kv"
import { Global } from "@/global"
import { Filesystem } from "@/util"
import { parse as parseJsonc } from "jsonc-parser"
import defaultLayoutText from "./layout/default.jsonc" with { type: "text" }
import denseLayoutText from "./layout/dense.jsonc" with { type: "text" }

export type LayoutConfig = {
  messageSeparation: number
  userMessagePaddingTop: number
  userMessagePaddingBottom: number
  assistantMessagePaddingTop: number
  assistantMessagePaddingBottom: number
  containerPaddingTop: number
  containerPaddingBottom: number
  containerGap: number
  toolMarginTop: number
  agentInfoMarginTop: number
  containerPaddingLeft: number
  containerPaddingRight: number
  messagePaddingLeft: number
  textIndent: number
  toolIndent: number
  showHeader: boolean
  showFooter: boolean
  forceSidebarHidden: boolean
  showInputAgentInfo: boolean
  showInputBorder: boolean
  inputAgentInfoPaddingTop: number
  inputBoxPaddingTop: number
  inputBoxPaddingBottom: number
  inputAreaRightContent: "keybinds" | "status"
}

type LayoutInfo = {
  name: string
  description?: string
  config: LayoutConfig
}

const DEFAULT_LAYOUT_CONFIG: LayoutConfig = (parseJsonc(defaultLayoutText) as LayoutInfo).config

const BUILTIN_LAYOUTS: Record<string, LayoutConfig> = {
  default: DEFAULT_LAYOUT_CONFIG,
  dense: (parseJsonc(denseLayoutText) as LayoutInfo).config,
}

const CUSTOM_LAYOUT_GLOB = new Bun.Glob("layout/*.{json,jsonc}")

// Validate and merge layout config with defaults
function validateAndMergeLayout(config: Partial<LayoutConfig>, name: string, source: string): LayoutConfig {
  const result = { ...DEFAULT_LAYOUT_CONFIG }
  const knownFields = new Set(Object.keys(DEFAULT_LAYOUT_CONFIG))
  const warnings: string[] = []

  // Check for unknown fields
  for (const key of Object.keys(config)) {
    if (!knownFields.has(key)) {
      warnings.push(`Unknown field '${key}' (will be ignored)`)
    }
  }

  // Merge known fields with type validation
  for (const key of knownFields) {
    const value = config[key as keyof LayoutConfig]
    const defaultValue = DEFAULT_LAYOUT_CONFIG[key as keyof LayoutConfig]
    const expectedType = typeof defaultValue

    if (value === undefined) {
      warnings.push(`Missing field '${key}' (using default: ${defaultValue})`)
      continue
    }

    if (typeof value !== expectedType) {
      warnings.push(
        `Invalid type for '${key}': expected ${expectedType}, got ${typeof value} (using default: ${defaultValue})`,
      )
      continue
    }

    ;(result as any)[key] = value
  }

  if (warnings.length > 0) {
    console.warn(`Layout '${name}' from ${source}:`)
    warnings.forEach((w) => console.warn(`  - ${w}`))
  }

  return result
}

async function getCustomLayouts() {
  const directories = [
    Global.Path.config,
    ...(await Array.fromAsync(
      Filesystem.up({
        targets: [".opencode"],
        start: process.cwd(),
      }),
    )),
  ]

  const result: Record<string, LayoutConfig> = {}
  for (const dir of directories) {
    for await (const item of CUSTOM_LAYOUT_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      try {
        const name = path.basename(item).replace(/\.(json|jsonc)$/, "")
        const text = await Bun.file(item).text()
        const data = parseJsonc(text) as LayoutInfo

        if (!data?.config) {
          console.warn(`Layout '${name}' from ${item}: missing 'config' object`)
          continue
        }

        result[name] = validateAndMergeLayout(data.config, name, item)
      } catch (err) {
        console.error(`Failed to load layout from ${item}:`, err)
      }
    }
  }
  return result
}

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const sync = useSync()
    const kv = useKV()
    const [store, setStore] = createStore({
      layouts: BUILTIN_LAYOUTS,
      active: kv.get("layout_mode", ((sync.data.config as any).tui as any)?.layout ?? "default") as string,
      ready: false,
    })

    createEffect(async () => {
      const custom = await getCustomLayouts()
      setStore(
        produce((draft) => {
          Object.assign(draft.layouts, custom)
          draft.ready = true
        }),
      )
    })

    const current = createMemo(() => {
      return store.layouts[store.active] ?? store.layouts.default
    })

    return {
      get current() {
        return current()
      },
      all() {
        return store.layouts
      },
      get selected() {
        return store.active
      },
      set(name: string) {
        setStore("active", name)
        kv.set("layout_mode", name)
      },
      get ready() {
        return store.ready
      },
      async reload() {
        const custom = await getCustomLayouts()
        setStore(
          produce((draft) => {
            // Reset to built-ins, then merge custom
            draft.layouts = { ...BUILTIN_LAYOUTS }
            Object.assign(draft.layouts, custom)
          }),
        )
      },
    }
  },
})
