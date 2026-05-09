import { beforeAll, describe, expect, mock, test } from "bun:test"

type ServerKey = Parameters<typeof import("./terminal").getTerminalServerScope>[1]

let getWorkspaceTerminalCacheKey: (dir: string, scope?: string) => string
let getTerminalServerScope: typeof import("./terminal").getTerminalServerScope
let getLegacyTerminalStorageKeys: (dir: string, legacySessionID?: string) => string[]
let migrateTerminalState: (value: unknown) => unknown

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
  }))
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))
  const mod = await import("./terminal")
  getWorkspaceTerminalCacheKey = mod.getWorkspaceTerminalCacheKey
  getTerminalServerScope = mod.getTerminalServerScope
  getLegacyTerminalStorageKeys = mod.getLegacyTerminalStorageKeys
  migrateTerminalState = mod.migrateTerminalState
})

describe("getWorkspaceTerminalCacheKey", () => {
  test("uses workspace-only directory cache key", () => {
    expect(getWorkspaceTerminalCacheKey("/repo")).toBe("/repo:__workspace__")
  })

  test("can include a server scope", () => {
    expect(getWorkspaceTerminalCacheKey("/repo", "wsl:Debian")).toBe("wsl:Debian:/repo:__workspace__")
  })
})

describe("getTerminalServerScope", () => {
  test("preserves local server keys", () => {
    expect(
      getTerminalServerScope(
        { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } },
        "sidecar" as ServerKey,
      ),
    ).toBeUndefined()
    expect(
      getTerminalServerScope(
        { type: "http", http: { url: "http://localhost:4096" } },
        "http://localhost:4096" as ServerKey,
      ),
    ).toBeUndefined()
    expect(
      getTerminalServerScope({ type: "http", http: { url: "http://[::1]:4096" } }, "http://[::1]:4096" as ServerKey),
    ).toBeUndefined()
  })

  test("scopes non-local server keys", () => {
    expect(
      getTerminalServerScope(
        { type: "sidecar", variant: "wsl", distro: "Debian", http: { url: "http://127.0.0.1:4096" } },
        "wsl:Debian" as ServerKey,
      ),
    ).toBe("wsl:Debian" as ServerKey)
    expect(
      getTerminalServerScope(
        { type: "http", http: { url: "https://example.com" } },
        "https://example.com" as ServerKey,
      ),
    ).toBe("https://example.com" as ServerKey)
  })
})

describe("getLegacyTerminalStorageKeys", () => {
  test("keeps workspace storage path when no legacy session id", () => {
    expect(getLegacyTerminalStorageKeys("/repo")).toEqual(["/repo/terminal.v1"])
  })

  test("includes legacy session path before workspace path", () => {
    expect(getLegacyTerminalStorageKeys("/repo", "session-123")).toEqual([
      "/repo/terminal/session-123.v1",
      "/repo/terminal.v1",
    ])
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
