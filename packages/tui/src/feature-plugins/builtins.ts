import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { PluginRuntime } from "../plugin/runtime"
import Notifications from "./system/notifications"
import PluginManager from "./system/plugins"
import WhichKey from "./system/which-key"

export type BuiltinTuiPlugin = Omit<TuiPluginModule, "id"> & {
  id: string
  tui: TuiPlugin
  enabled?: boolean
}

export function createBuiltinPlugins(): BuiltinTuiPlugin[] {
  return [Notifications, PluginManager, WhichKey]
}

export async function loadBuiltinPlugins(api: TuiPluginApi, runtime: PluginRuntime) {
  const slots = runtime.setupSlots(api)
  const dispose: Array<() => void> = []

  for (const plugin of createBuiltinPlugins()) {
    if (plugin.enabled === false) continue
    const scoped = Object.assign(Object.create(api), {
      slots: {
        register(input: Parameters<typeof slots.register>[0]) {
          dispose.push(slots.register({ ...input, id: plugin.id }))
          return plugin.id
        },
      },
    }) as TuiPluginApi
    const now = Date.now()
    await plugin.tui(scoped, undefined, {
      id: plugin.id,
      source: "internal",
      spec: plugin.id,
      target: plugin.id,
      first_time: now,
      last_time: now,
      time_changed: now,
      load_count: 1,
      fingerprint: plugin.id,
      state: "first",
    })
  }

  return () => {
    for (const fn of dispose.reverse()) fn()
    slots.dispose()
  }
}
