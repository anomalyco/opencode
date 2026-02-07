import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { Keybind } from "@/util/keybind"
import { pipe, mapValues } from "remeda"
import type { KeybindsConfig } from "@opencode-ai/sdk/v2"
import type { ParsedKey, Renderable } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"

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
    const [store, setStore] = createStore({
      leader: false,
      mods: {
        ctrl: false,
        meta: false,
        shift: false,
        super: false,
      },
    })
    const renderer = useRenderer()

    let focus: Renderable | null
    let timeout: NodeJS.Timeout
    function leader(active: boolean, evt?: ParsedKey) {
      if (active) {
        setStore("leader", true)
        const parsed = evt ? Keybind.fromParsedKey(evt) : undefined
        setStore("mods", {
          ctrl: !!parsed?.ctrl,
          meta: !!parsed?.meta,
          shift: !!parsed?.shift,
          super: !!parsed?.super,
        })
        focus = renderer.currentFocusedRenderable
        focus?.blur()
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => {
          if (!store.leader) return
          leader(false)
          if (!focus || focus.isDestroyed) return
          focus.focus()
        }, 2000)
        return
      }

      if (!active) {
        if (focus && !renderer.currentFocusedRenderable) {
          focus.focus()
        }
        setStore("leader", false)
        setStore("mods", {
          ctrl: false,
          meta: false,
          shift: false,
          super: false,
        })
      }
    }

    useKeyboard(async (evt) => {
      if (!store.leader && result.match("leader", evt)) {
        leader(true, evt)
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
      parse(evt: ParsedKey): Keybind.Info {
        return Keybind.fromParsedKey(evt, store.leader)
      },
      match(key: keyof KeybindsConfig, evt: ParsedKey) {
        const keybind = keybinds()[key]
        if (!keybind) return false
        const parsed: Keybind.Info = result.parse(evt)
        for (const binding of keybind) {
          if (Keybind.match(binding, parsed)) return true
        }

        // If we're in leader mode, users often keep holding the leader modifiers
        // (e.g. holding Ctrl for `ctrl+x` and then pressing the next key).
        // Fall back to matching with the leader modifiers stripped.
        if (!store.leader) return false

        const stripped: Keybind.Info = {
          ...parsed,
          ctrl: store.mods.ctrl ? false : parsed.ctrl,
          meta: store.mods.meta ? false : parsed.meta,
          shift: store.mods.shift ? false : parsed.shift,
          super: store.mods.super ? false : parsed.super,
        }
        for (const binding of keybind) {
          if (Keybind.match(binding, stripped)) return true
        }

        return false
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
