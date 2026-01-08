import { Global } from "@/global"
import { createSignal, type Accessor, type Setter } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import path from "path"

/**
 * Schema for all known KV store keys with their value types.
 * This provides type safety for persisted UI settings.
 */
export interface KVSchema {
  /** Sidebar visibility mode */
  sidebar: "show" | "hide" | "auto"

  /** Whether to show assistant thinking process */
  thinking_visibility: boolean

  /** Whether to show message timestamps */
  timestamps: "show" | "hide"

  /** Whether to show tool input/output details */
  tool_details_visibility: boolean

  /** Whether to show assistant metadata */
  assistant_metadata_visibility: boolean

  /** Whether to show the session scrollbar */
  scrollbar_visible: boolean

  /** Whether to enable animations */
  animations_enabled: boolean

  /** Whether to update the terminal window title */
  terminal_title_enabled: boolean

  /** Whether to hide tips on home screen */
  tips_hidden: boolean

  /** Whether user has dismissed the getting started panel */
  dismissed_getting_started: boolean

  /** Whether user has seen the OpenRouter warning */
  openrouter_warning: boolean

  /** Theme mode (dark or light) */
  theme_mode: "dark" | "light"

  /** Active theme name */
  theme: string
}

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [kvStore, setKvStore] = createStore<Record<string, any>>()
    const file = Bun.file(path.join(Global.Path.state, "kv.json"))

    file
      .json()
      .then((x) => {
        setKvStore(x)
      })
      .catch(() => {})
      .finally(() => {
        setReady(true)
      })

    const result = {
      get ready() {
        return ready()
      },

      /**
       * Creates a persisted signal that automatically syncs with the KV store.
       * Returns a standard SolidJS signal tuple [accessor, setter].
       *
       * @example
       * const [showThinking, setShowThinking] = kv.signal("thinking_visibility", true)
       * setShowThinking(prev => !prev)  // Automatically persists to kv.json
       */
      signal<K extends keyof KVSchema>(
        key: K,
        defaultValue: KVSchema[K],
      ): [Accessor<KVSchema[K]>, (next: KVSchema[K] | ((prev: KVSchema[K]) => KVSchema[K])) => void] {
        const initial = (kvStore[key] ?? defaultValue) as KVSchema[K]
        const [value, setValue] = createSignal<KVSchema[K]>(initial)

        const setter = (next: KVSchema[K] | ((prev: KVSchema[K]) => KVSchema[K])) => {
          const newValue = typeof next === "function" ? (next as (prev: KVSchema[K]) => KVSchema[K])(value()) : next
          setKvStore(key, newValue)
          Bun.write(file, JSON.stringify(kvStore, null, 2))
          setValue(() => newValue)
        }

        return [value, setter]
      },

      get(key: string, defaultValue?: any): any {
        return kvStore[key] ?? defaultValue
      },

      set(key: string, value: any): void {
        setKvStore(key, value)
        Bun.write(file, JSON.stringify(kvStore, null, 2))
      },
    }
    return result
  },
})
