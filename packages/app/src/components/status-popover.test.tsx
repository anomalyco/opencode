import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"

let StatusPopover: typeof import("./status-popover").StatusPopover

beforeAll(async () => {
  ;(globalThis as typeof globalThis & {
    React?: { createElement: (...args: unknown[]) => unknown; Fragment: symbol }
  }).React = {
    createElement: (...args) => ({ args }),
    Fragment: Symbol.for("react.fragment"),
  }

  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => {},
  }))
  mock.module("@/context/sync", () => ({
    useSync: () => ({
      data: {
        mcp: {},
        lsp: [],
        config: {
          plugin: ["pennylane"],
        },
      },
      set: () => {},
    }),
  }))
  mock.module("@/context/sdk", () => ({
    useSDK: () => ({
      client: {
        plugin: {
          pennylane: {
            health: async () => ({ data: { healthy: true } }),
          },
        },
        mcp: {
          disconnect: async () => {},
          connect: async () => {},
          status: async () => ({ data: {} }),
        },
      },
    }),
  }))
  mock.module("@/context/server", () => ({
    normalizeServerUrl: (value: string) => value,
    useServer: () => ({
      url: "http://localhost:4096",
      list: ["http://localhost:4096"],
      healthy: () => true,
      setActive: () => {},
    }),
  }))
  mock.module("@/context/platform", () => ({
    usePlatform: () => ({
      fetch: globalThis.fetch,
      getDefaultServerUrl: () => "http://localhost:4096",
    }),
  }))
  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))
  mock.module("@opencode-ai/ui/context/dialog", () => ({
    useDialog: () => ({
      show: () => {},
    }),
  }))
  mock.module("@opencode-ai/ui/popover", () => ({
    Popover: (props: { children?: unknown }) => props.children,
  }))
  mock.module("@opencode-ai/ui/tabs", () => ({
    Tabs: Object.assign((props: { children?: unknown }) => props.children, {
      List: (props: { children?: unknown }) => props.children,
      Trigger: (props: { children?: unknown }) => props.children,
      Content: (props: { children?: unknown }) => props.children,
    }),
  }))
  mock.module("@opencode-ai/ui/button", () => ({
    Button: (props: { children?: unknown }) => props.children,
  }))
  mock.module("@opencode-ai/ui/switch", () => ({
    Switch: () => null,
  }))
  mock.module("@opencode-ai/ui/icon", () => ({
    Icon: () => null,
  }))
  mock.module("@/components/server/server-row", () => ({
    ServerRow: (props: { children?: unknown }) => props.children,
  }))
  mock.module("./dialog-select-server", () => ({
    DialogSelectServer: () => null,
  }))
  mock.module("@opencode-ai/ui/toast", () => ({
    showToast: () => {},
  }))
  mock.module("@/utils/server-health", () => ({
    checkServerHealth: async () => ({ healthy: true }),
  }))

  const mod = await import("./status-popover")
  StatusPopover = mod.StatusPopover
})

describe("StatusPopover", () => {
  test("does not read plugins before initialization", () => {
    expect(() =>
      createRoot((dispose) => {
        try {
          StatusPopover({})
        } finally {
          dispose()
        }
      }),
    ).not.toThrow()
  })
})
