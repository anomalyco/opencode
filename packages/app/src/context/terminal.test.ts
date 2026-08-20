import { beforeAll, describe, expect, mock, test } from "bun:test"
import { ServerScope } from "@/utils/server-scope"
import { base64Encode } from "@opencode-ai/util/encode"
import { Persist } from "@/utils/persist"
import type { Platform } from "./platform"

let getWorkspaceTerminalCacheKey: typeof import("./terminal").getWorkspaceTerminalCacheKey
let clearWorkspaceTerminals: typeof import("./terminal").clearWorkspaceTerminals
let migrateTerminalState: (value: unknown) => unknown

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
    useLocation: () => ({}),
    useSearchParams: () => [{}, () => undefined],
  }))
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))
  const mod = await import("./terminal")
  getWorkspaceTerminalCacheKey = mod.getWorkspaceTerminalCacheKey
  clearWorkspaceTerminals = mod.clearWorkspaceTerminals
  migrateTerminalState = mod.migrateTerminalState
})

describe("getWorkspaceTerminalCacheKey", () => {
  test("uses workspace-only directory cache key", () => {
    expect(String(getWorkspaceTerminalCacheKey("/repo"))).toBe("local\u0000/repo\u0000__workspace__")
  })

  test("can include a server scope", () => {
    expect(String(getWorkspaceTerminalCacheKey("/repo", "ssh:debian" as ServerScope))).toBe(
      "ssh:debian\u0000/repo\u0000__workspace__",
    )
  })

  test("clears the current workspace terminal store", () => {
    const removed: { storage?: string; key: string }[] = []
    const platform: Platform = {
      platform: "desktop",
      windowID: "window",
      openExternal: () => undefined,
      restart: async () => undefined,
      notify: async () => undefined,
      openDirectoryPickerDialog: async () => null,
      storage: (storage) => ({
        getItem: () => null,
        setItem: () => undefined,
        removeItem: (key) => void removed.push({ storage, key }),
      }),
    }

    clearWorkspaceTerminals("C:/repo", platform)

    const target = Persist.workspace(base64Encode("C:/repo"), "terminal")
    expect(removed).toEqual([{ storage: target.storage, key: target.key }])
  })
})

describe("migrateTerminalState", () => {
  test("drops invalid terminals and restores a valid active terminal", () => {
    expect(
      migrateTerminalState({
        active: "missing",
        all: [
          null,
          { id: "one", title: "Terminal 2" },
          { id: "one", title: "duplicate", titleNumber: 9 },
          { id: "two", title: "logs", titleNumber: 4, rows: 24, cols: 80 },
          { title: "no-id" },
        ],
      }),
    ).toEqual({
      active: "one",
      all: [
        { id: "one", title: "Terminal 2", titleNumber: 2 },
        { id: "two", title: "logs", titleNumber: 4, rows: 24, cols: 80 },
      ],
    })
  })

  test("keeps a valid active id", () => {
    expect(
      migrateTerminalState({
        active: "two",
        all: [
          { id: "one", title: "Terminal 1" },
          { id: "two", title: "shell", titleNumber: 7 },
        ],
      }),
    ).toEqual({
      active: "two",
      all: [
        { id: "one", title: "Terminal 1", titleNumber: 1 },
        { id: "two", title: "shell", titleNumber: 7 },
      ],
    })
  })
})
