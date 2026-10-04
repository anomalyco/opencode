import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { RGBA } from "@opentui/core"
import { createTuiResolvedConfig } from "./tui-runtime"

type Opts = {
  client?: TuiPluginApi["client"]
  keymap?: TuiPluginApi["keymap"]
  attention?: Partial<TuiPluginApi["attention"]>
  event?: TuiPluginApi["event"]
  state?: { session?: Partial<TuiPluginApi["state"]["session"]> }
}

export function createTuiPluginApi(opts: Opts = {}) {
  const values = new Map<string, unknown>()
  const color = RGBA.fromInts(200, 200, 200)
  const dialog = { clear() {}, replace() {}, setSize() {}, size: "medium" as const, depth: 0, open: false }
  return {
    attention: { notify: async () => ({ ok: false, notification: false, sound: false }), ...opts.attention },
    client: opts.client,
    event: opts.event,
    keymap: opts.keymap,
    kv: {
      get(name: string, fallback?: unknown) {
        return values.has(name) ? values.get(name) : fallback
      },
      set(name: string, value: unknown) {
        values.set(name, value)
      },
      ready: true,
    },
    state: { session: { get: () => undefined, ...opts.state?.session } },
    theme: { current: new Proxy({}, { get: () => color }) },
    tuiConfig: createTuiResolvedConfig(),
    ui: { dialog },
  } as unknown as TuiPluginApi
}
