import { createMemo, createEffect } from "solid-js"
import { useSync } from "@tui/context/sync"
import { Keybind } from "@/util/keybind"
import { pipe, mapValues } from "remeda"
import type { KeybindsConfig } from "@opencode-ai/sdk/v2"
import type { ParsedKey, Renderable } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { Config } from "@/config/config"

type KeybindHint = {
  key: string
  desc: string
  count: number
}

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const sync = useSync()
    const keybinds = createMemo(() => {
      return pipe(
        sync.data.config.keybinds ?? {},
        mapValues((value) => Keybind.parse(value)),
      )
    })
    const hintConfig = createMemo(() => (sync.data.config as Config.Info).tui?.keybind_hint)
    const hintEnabled = createMemo(() => hintConfig()?.enabled ?? true)
    const hintDelay = createMemo(() => Math.max(0, hintConfig()?.delay_ms ?? 200))
    const descriptions = createMemo(() => {
      const result: Partial<Record<keyof KeybindsConfig, string>> = {}
      const fields = Config.Keybinds.shape
      for (const [key, value] of Object.entries(fields)) {
        const desc = (value as { description?: string }).description
        if (!desc) continue
        result[key as keyof KeybindsConfig] = desc
      }
      return result
    })
    const [store, setStore] = createStore({
      leader: false,
      keybindHint: false,
    })
    const keybindHints = createMemo(() => {
      if (!store.keybindHint || !hintEnabled()) return [] as KeybindHint[]
      const lookup = descriptions()
      const direct: KeybindHint[] = []
      const grouped = new Map<string, KeybindHint>()
      const keys = sync.data.config.keybinds ?? {}
      for (const [key, raw] of Object.entries(keys)) {
        if (typeof raw !== "string" || raw === "none") continue
        const desc = lookup[key as keyof KeybindsConfig]
        if (!desc) continue
        const combos = raw
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
        for (const combo of combos) {
          const steps = combo.split(/\s+/).filter(Boolean)
          const first = steps[0]
          if (!first) continue
          const info = Keybind.parse(first).at(0)
          if (!info?.leader) continue
          const name = Keybind.toString({ ...info, leader: false })
          if (!name) continue
          if (steps.length === 1) {
            direct.push({ key: name, desc, count: 1 })
            continue
          }
          const current = grouped.get(name)
          const count = (current?.count ?? 0) + 1
          grouped.set(name, { key: name, desc: current?.desc ?? desc, count })
        }
      }
      const directKeys = new Set(direct.map((item) => item.key))
      const groupedHints = Array.from(grouped.values()).filter((item) => !directKeys.has(item.key))
      const hints = [...direct, ...groupedHints]
      return hints.sort((a, b) => {
        if (a.count === b.count) return a.key.localeCompare(b.key)
        if (a.count > 1 && b.count === 1) return 1
        if (a.count === 1 && b.count > 1) return -1
        return a.key.localeCompare(b.key)
      })
    })
    const renderer = useRenderer()

    let focus: Renderable | null
    let timeout: NodeJS.Timeout
    const timers = {
      keybindHint: undefined as NodeJS.Timeout | undefined,
    }
    function clearKeybindHint() {
      if (timers.keybindHint) clearTimeout(timers.keybindHint)
      timers.keybindHint = undefined
      setStore("keybindHint", false)
    }

    createEffect(() => {
      if (hintEnabled()) return
      clearKeybindHint()
    })
    function scheduleKeybindHint() {
      if (!hintEnabled()) return
      if (timers.keybindHint) clearTimeout(timers.keybindHint)
      const delay = hintDelay()
      timers.keybindHint = setTimeout(() => {
        if (!store.leader) return
        setStore("keybindHint", true)
      }, delay)
    }
    function leader(active: boolean) {
      if (active) {
        setStore("leader", true)
        setStore("keybindHint", false)
        scheduleKeybindHint()
        focus = renderer.currentFocusedRenderable
        focus?.blur()
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => {
          if (!store.leader) return
          leader(false)
          if (focus) {
            focus.focus()
          }
        }, 2000)
        return
      }

      if (!active) {
        clearKeybindHint()
        if (focus && !renderer.currentFocusedRenderable) {
          focus.focus()
        }
        setStore("leader", false)
      }
    }

    useKeyboard(async (evt) => {
      if (store.leader) {
        clearKeybindHint()
      }
      if (!store.leader && result.match("leader", evt)) {
        leader(true)
        return
      }

      if (store.leader && evt.name) {
        setImmediate(() => {
          if (focus && renderer.currentFocusedRenderable === focus) {
            focus.focus()
          }
          leader(false)
        })
      }
    })

    const result = {
      get all() {
        return keybinds()
      },
      get leader() {
        return store.leader
      },
      get keybindHints() {
        return keybindHints()
      },
      parse(evt: ParsedKey): Keybind.Info {
        // Handle special case for Ctrl+Underscore (represented as \x1F)
        if (evt.name === "\x1F") {
          return Keybind.fromParsedKey({ ...evt, name: "_", ctrl: true }, store.leader)
        }
        return Keybind.fromParsedKey(evt, store.leader)
      },
      match(key: keyof KeybindsConfig, evt: ParsedKey) {
        const keybind = keybinds()[key]
        if (!keybind) return false
        const parsed: Keybind.Info = result.parse(evt)
        for (const key of keybind) {
          if (Keybind.match(key, parsed)) {
            return true
          }
        }
      },
      print(key: keyof KeybindsConfig) {
        const first = keybinds()[key]?.at(0)
        if (!first) return ""
        const result = Keybind.toString(first)
        return result.replace("<leader>", Keybind.toString(keybinds().leader![0]!))
      },
    }
    return result
  },
})
