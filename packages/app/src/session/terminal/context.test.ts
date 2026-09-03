import { beforeAll, describe, expect, mock, test } from "bun:test"
import { ServerScope } from "@/runtime/server/scope"
import { base64Encode } from "@opencode-ai/util/encode"
import { Persist } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import type { Platform } from "@/runtime/platform/platform"
import { Schema } from "effect"

let getWorkspaceTerminalCacheKey: typeof import("./context").getWorkspaceTerminalCacheKey
let clearWorkspaceTerminals: typeof import("./context").clearWorkspaceTerminals
let decodeTerminalState: (value: unknown) => unknown
let roundTripTerminalState: (value: unknown) => unknown

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
    useLocation: () => ({}),
    useSearchParams: () => [{}, () => undefined],
  }))
  const mod = await import("./context")
  getWorkspaceTerminalCacheKey = mod.getWorkspaceTerminalCacheKey
  clearWorkspaceTerminals = mod.clearWorkspaceTerminals
  const schema = Persistence.withInitial(mod.TerminalState, { all: [] })
  decodeTerminalState = Schema.decodeUnknownSync(schema)
  roundTripTerminalState = (value) =>
    Schema.decodeUnknownSync(schema)(Schema.encodeSync(schema)(Schema.decodeUnknownSync(schema)(value)))
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

describe("TerminalState", () => {
  test("drops invalid terminals and restores a valid active terminal", () => {
    expect(
      decodeTerminalState({
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
      decodeTerminalState({
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

  test("defaults missing and malformed fields without dropping usable terminals", () => {
    expect(decodeTerminalState({})).toEqual({ active: undefined, all: [] })
    expect(decodeTerminalState({ active: 2, all: "invalid" })).toEqual({ active: undefined, all: [] })
    expect(decodeTerminalState({ all: [null, {}, { id: "" }, { id: 2 }] })).toEqual({ active: undefined, all: [] })
    expect(
      decodeTerminalState({
        all: [
          {
            id: "one",
            title: "Terminal 3",
            titleNumber: Infinity,
            rows: "24",
            cols: 80,
            buffer: false,
            cursor: NaN,
            scrollY: 0,
          },
          { id: "two", title: null, titleNumber: -1, buffer: "saved", cursor: 0 },
        ],
      }),
    ).toEqual({
      active: "one",
      all: [
        { id: "one", title: "Terminal 3", titleNumber: 3, cols: 80, scrollY: 0 },
        { id: "two", title: "", titleNumber: 0, buffer: "saved", cursor: 0 },
      ],
    })
  })

  test("round trips normalized terminal state", () => {
    const value = {
      active: "two",
      all: [
        { id: "one", title: "Terminal 1", titleNumber: 1 },
        { id: "two", title: "logs", titleNumber: 4, rows: 24, cols: 80, buffer: "output", cursor: 12, scrollY: 3 },
      ],
    }
    expect(roundTripTerminalState(value)).toEqual(value)
  })
})
