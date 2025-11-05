import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useUIExtensions } from "./ui-extensions"
import { Keybind } from "@/util/keybind"
import { pipe, mapValues } from "remeda"
import type { KeybindsConfig } from "@opencode-ai/sdk"
import type { ParsedKey, Renderable } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const sync = useSync()
    const uiExtensions = useUIExtensions()
    const keybinds = createMemo(() => {
      return pipe(
        sync.data.config.keybinds ?? {},
        mapValues((value) => Keybind.parse(value)),
      )
    })
    const pluginKeybinds = createMemo(() => {
      const ext = uiExtensions.extensions()
      return ext?.keybinds ?? []
    })
    const [store, setStore] = createStore({
      leader: false,
    })
    const renderer = useRenderer()

    let focus: Renderable | null
    let timeout: NodeJS.Timeout
    function leader(active: boolean) {
      if (active) {
        setStore("leader", true)
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
        if (focus && !renderer.currentFocusedRenderable) {
          focus.focus()
        }
        setStore("leader", false)
      }
    }

    useKeyboard(async (evt) => {
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

      // Check plugin keybinds
      const matched = result.matchPluginKeybind(evt)
      if (matched) {
        evt.preventDefault()
        // Plugin keybind matched - command will be handled by command system
        // The command ID from the keybind definition is already available
        leader(false)
      }
    })

    const result = {
      get all() {
        return keybinds()
      },
      get leader() {
        return store.leader
      },
      get pluginKeybinds() {
        return pluginKeybinds()
      },
      parse(evt: ParsedKey): Keybind.Info {
        if (evt.name === "\x1F")
          return {
            ctrl: true,
            name: "_",
            shift: false,
            leader: false,
            meta: false,
          }
        return {
          ctrl: evt.ctrl,
          name: evt.name,
          shift: evt.shift,
          leader: store.leader,
          meta: evt.meta,
        }
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
      matchPluginKeybind(evt: ParsedKey) {
        const parsed: Keybind.Info = result.parse(evt)
        for (const keybind of pluginKeybinds()) {
          const keybindInfo = Keybind.parse(keybind.keys)
          for (const key of keybindInfo) {
            if (Keybind.match(key, parsed)) {
              return keybind
            }
          }
        }
        return null
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
