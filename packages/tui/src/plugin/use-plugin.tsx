import type { Page, Slot, SlotName } from "@opencode-ai/plugin/tui/context"
import { createContext, useContext } from "solid-js"

export type RegisteredPlugin = {
  readonly id: string
  readonly source: "builtin" | "external"
  readonly active: boolean
}

export type PluginState =
  | { readonly target: string; readonly id: string; readonly status: "active" | "inactive" }
  | { readonly target: string; readonly status: "unsupported" }
  | { readonly target: string; readonly status: "failed"; readonly error: string }

type Value = {
  readonly ready: () => boolean
  readonly list: () => ReadonlyArray<PluginState>
  readonly registered: () => ReadonlyArray<RegisteredPlugin>
  readonly route: (id: string, name: string) => Page["render"] | undefined
  readonly slot: <Name extends SlotName>(
    name: Name,
  ) => ReadonlyArray<{ readonly id: string; readonly render: Slot<Name> }>
  readonly activate: (id: string) => Promise<boolean>
  readonly deactivate: (id: string) => Promise<boolean>
}

export const PluginContext = createContext<Value>()

export function usePlugin() {
  const value = useContext(PluginContext)
  if (!value) throw new Error("PluginProvider is missing")
  return value
}
