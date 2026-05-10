import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import type { CommandOption } from "@/context/command"
import { BROWSER_SLASH_DESCRIPTION } from "@/components/prompt-input/browser-command"

const registered: Array<{ key: string; options: CommandOption[] }> = []

beforeAll(() => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
  }))

  mock.module("@/context/command", () => ({
    useCommand: () => ({
      register: (key: string, options: () => CommandOption[]) => registered.push({ key, options: options() }),
    }),
  }))

  mock.module("@opencode-ai/ui/context/dialog", () => ({
    useDialog: () => ({ show: () => undefined }),
  }))

  mock.module("@opencode-ai/ui/toast", () => ({
    showToast: () => 0,
  }))

  mock.module("@/context/file", () => ({
    selectionFromLines: () => ({ startLine: 1, endLine: 1 }),
    useFile: () => ({
      tab: (tab: string) => tab,
      pathFromTab: () => undefined,
      selectedLines: () => undefined,
      get: () => undefined,
    }),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({ t: (key: string) => key }),
  }))

  mock.module("@/context/layout", () => ({
    useLayout: () => ({
      fileTree: { tab: () => "all", setTab: () => undefined, toggle: () => undefined },
      handoff: { setTabs: () => undefined },
    }),
  }))

  mock.module("@/context/local", () => ({
    useLocal: () => ({
      model: { current: () => ({ id: "model", provider: { id: "provider" } }), variant: { cycle: () => undefined } },
      agent: { move: () => undefined },
    }),
  }))

  mock.module("@/context/permission", () => ({
    usePermission: () => ({
      isAutoAccepting: () => false,
      isAutoAcceptingDirectory: () => false,
      toggleAutoAccept: () => undefined,
      toggleAutoAcceptDirectory: () => undefined,
    }),
  }))

  mock.module("@/context/platform", () => ({
    usePlatform: () => ({ platform: "desktop" }),
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => ({
      set: () => undefined,
      reset: () => undefined,
      context: { add: () => undefined },
    }),
  }))

  mock.module("@/context/sdk", () => ({
    useSDK: () => ({
      directory: "/repo/main",
      client: {
        session: {
          share: async () => ({ data: undefined }),
          unshare: async () => ({ data: undefined }),
          abort: async () => ({ data: undefined }),
          revert: async () => ({ data: undefined }),
          unrevert: async () => ({ data: undefined }),
          summarize: async () => ({ data: undefined }),
        },
      },
    }),
  }))

  mock.module("@/context/settings", () => ({
    useSettings: () => ({ general: { showFileTree: () => true } }),
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => ({
      data: { session_status: {}, message: {}, part: {}, config: {} },
      session: { get: () => ({ id: "session-1" }) },
    }),
  }))

  mock.module("@/context/terminal", () => ({
    useTerminal: () => ({ all: () => [], new: () => undefined }),
  }))

  mock.module("@/context/browser-store", () => ({
    useBrowserStore: () => ({ store: { activeId: null, instances: {} } }),
  }))

  mock.module("@/context/annotation-store", () => ({
    useAnnotationStore: () => ({ setPanelOpen: () => undefined }),
  }))

  mock.module("@/pages/session/session-layout", () => ({
    useSessionLayout: () => ({
      params: { id: "session-1", dir: "repo" },
      tabs: () => ({ active: () => undefined, all: () => [], close: () => undefined }),
      view: () => ({
        terminal: { open: () => undefined, toggle: () => undefined },
        browserPanel: { open: () => undefined },
        reviewPanel: { toggle: () => undefined },
      }),
    }),
  }))
})

describe("useSessionCommands browser registration", () => {
  test("registers /browser as a local session view command", async () => {
    registered.length = 0
    const mod = await import("./use-session-commands")

    createRoot((dispose) => {
      mod.useSessionCommands({
        navigateMessageByOffset: () => undefined,
        setActiveMessage: () => undefined,
        focusInput: () => undefined,
      })
      dispose()
    })

    const browser = registered.find((entry) => entry.key === "session")?.options.find((option) => option.id === "browser.open")

    expect(browser).toMatchObject({
      id: "browser.open",
      slash: "browser",
      title: "Browser",
      description: BROWSER_SLASH_DESCRIPTION,
      category: "command.category.view",
    })
  })
})
