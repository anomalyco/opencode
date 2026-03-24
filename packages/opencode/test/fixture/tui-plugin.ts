import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { CliRenderer } from "@opentui/core"
import { createPluginKeybind } from "../../src/cli/cmd/tui/context/plugin-keybinds"
import type { HostPluginApi } from "../../src/cli/cmd/tui/plugin/slots"

type Count = {
  event_add: number
  event_drop: number
  route_add: number
  route_drop: number
  command_add: number
  command_drop: number
}

type Opts = {
  client?: HostPluginApi["client"]
  renderer?: HostPluginApi["renderer"]
  count?: Count
  keybind?: Partial<HostPluginApi["keybind"]>
  tuiConfig?: HostPluginApi["tuiConfig"]
  app?: Partial<HostPluginApi["app"]>
  state?: {
    ready?: HostPluginApi["state"]["ready"]
    config?: HostPluginApi["state"]["config"]
    provider?: HostPluginApi["state"]["provider"]
    session?: Partial<HostPluginApi["state"]["session"]>
    lsp?: HostPluginApi["state"]["lsp"]
    mcp?: HostPluginApi["state"]["mcp"]
  }
  theme?: {
    selected?: string
    has?: HostPluginApi["theme"]["has"]
    set?: HostPluginApi["theme"]["set"]
    install?: HostPluginApi["theme"]["install"]
    mode?: HostPluginApi["theme"]["mode"]
    ready?: boolean
    current?: HostPluginApi["theme"]["current"]
  }
}

export function createTuiPluginApi(opts: Opts = {}): HostPluginApi {
  const kv: Record<string, unknown> = {}
  const count = opts.count
  let depth = 0
  let size: "medium" | "large" = "medium"
  const has = opts.theme?.has ?? (() => false)
  let selected = opts.theme?.selected ?? "opencode"
  const key = {
    match: opts.keybind?.match ?? (() => false),
    print: opts.keybind?.print ?? ((name: string) => name),
  }
  const set =
    opts.theme?.set ??
    ((name: string) => {
      if (!has(name)) return false
      selected = name
      return true
    })
  const renderer: CliRenderer = opts.renderer ?? {
    ...Object.create(null),
    once(this: CliRenderer) {
      return this
    },
  }

  function kvGet(name: string): unknown
  function kvGet<Value>(name: string, fallback: Value): Value
  function kvGet(name: string, fallback?: unknown) {
    const value = kv[name]
    if (value === undefined) return fallback
    return value
  }

  return {
    app: {
      get version() {
        return opts.app?.version ?? "0.0.0-test"
      },
      get directory() {
        return opts.app?.directory ?? "~"
      },
    },
    client:
      opts.client ??
      createOpencodeClient({
        baseUrl: "http://localhost:4096",
      }),
    event: {
      on: () => {
        if (count) count.event_add += 1
        return () => {
          if (!count) return
          count.event_drop += 1
        }
      },
    },
    renderer,
    command: {
      register: () => {
        if (count) count.command_add += 1
        return () => {
          if (!count) return
          count.command_drop += 1
        }
      },
      trigger: () => {},
    },
    route: {
      register: () => {
        if (count) count.route_add += 1
        return () => {
          if (!count) return
          count.route_drop += 1
        }
      },
      navigate: () => {},
      get current() {
        return { name: "home" }
      },
    },
    ui: {
      Dialog: () => null,
      DialogAlert: () => null,
      DialogConfirm: () => null,
      DialogPrompt: () => null,
      DialogSelect: () => null,
      toast: () => {},
      dialog: {
        replace: () => {
          depth = 1
        },
        clear: () => {
          depth = 0
          size = "medium"
        },
        setSize: (next) => {
          size = next
        },
        get size() {
          return size
        },
        get depth() {
          return depth
        },
        get open() {
          return depth > 0
        },
      },
    },
    keybind: {
      ...key,
      create:
        opts.keybind?.create ??
        ((defaults, over) => {
          return createPluginKeybind(key, defaults, over)
        }),
    },
    tuiConfig: opts.tuiConfig ?? {},
    kv: {
      get: kvGet,
      set(name, value) {
        kv[name] = value
      },
      get ready() {
        return true
      },
    },
    state: {
      get ready() {
        return opts.state?.ready ?? true
      },
      get config() {
        return opts.state?.config ?? {}
      },
      get provider() {
        return opts.state?.provider ?? []
      },
      session: {
        diff: opts.state?.session?.diff ?? (() => []),
        todo: opts.state?.session?.todo ?? (() => []),
        messages: opts.state?.session?.messages ?? (() => []),
      },
      lsp: opts.state?.lsp ?? (() => []),
      mcp: opts.state?.mcp ?? (() => []),
    },
    theme: {
      get current() {
        return opts.theme?.current ?? {}
      },
      get selected() {
        return selected
      },
      has(name) {
        return has(name)
      },
      set(name) {
        return set(name)
      },
      async install(file) {
        if (opts.theme?.install) return opts.theme.install(file)
        throw new Error("base theme.install should not run")
      },
      mode() {
        if (opts.theme?.mode) return opts.theme.mode()
        return "dark"
      },
      get ready() {
        return opts.theme?.ready ?? true
      },
    },
  }
}
