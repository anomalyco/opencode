import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { Schema } from "effect"
import { ServerConnection } from "@/runtime/server/registry"
import { Persistence } from "@/runtime/persistence/schema"
import { currentRoute, initialLayout, layoutPersistence, layoutSchema } from "./layout"
import { createSessionKeyReader, ensureSessionKey, pruneSessionKeys } from "./helpers"

test("settings has its own layout route", () => {
  expect(currentRoute("/settings", "")).toEqual({ type: "settings" })
})

describe("layout persistence", () => {
  const schema = Persistence.withInitial(layoutPersistence, initialLayout(ServerConnection.Key.make("local")))
  const decode = Schema.decodeUnknownSync(schema)

  test("starts without a server and preserves a saved selection", () => {
    const restore = Schema.decodeUnknownSync(Persistence.withInitial(layoutPersistence, initialLayout()))
    expect(restore({}).home.selection.server).toBeUndefined()
    expect(Schema.is(layoutSchema)(initialLayout())).toBe(true)
    expect(restore({ home: { selection: { server: "https://remote.example" } } }).home.selection.server).toBe(
      ServerConnection.Key.make("https://remote.example"),
    )
  })

  test("uses supplied initial preferences after legacy migration", () => {
    const initial = initialLayout(ServerConnection.Key.make("remote"))
    initial.sidebar.width = 420
    initial.fileTree.width = 300
    initial.review.panelOpened = true
    const restore = Schema.decodeUnknownSync(Persistence.withInitial(layoutPersistence, initial))
    expect(restore({})).toEqual(initial)
    expect(restore({ sidebar: { width: "bad" } }).sidebar.width).toBe(420)
    expect(restore({ fileTree: { width: 260 } }).fileTree.width).toBe(200)
    expect(restore({ fileTree: {} }).fileTree.width).toBe(300)
    expect(restore({ review: {}, fileTree: { opened: false } }).review.panelOpened).toBe(false)
    expect(() => Schema.decodeUnknownSync(layoutSchema)({})).toThrow()
  })

  test("restores shipped defaults for missing and invalid fields", () => {
    const defaults = decode({})
    expect(defaults).toEqual({
      sidebar: { opened: false, width: 344, workspaces: {}, workspacesDefault: false },
      terminal: { height: 280, opened: false },
      review: { diffStyle: "split", panelOpened: false },
      fileTree: { opened: false, width: 200, tab: "changes" },
      session: { width: 600 },
      mobileSidebar: { opened: false },
      sessionTabs: {},
      sessionView: {},
      home: { selection: { server: ServerConnection.Key.make("local") } },
    })
    expect(
      decode({
        sidebar: { width: "bad" },
        terminal: null,
        session: { width: undefined },
        review: { diffStyle: "bad" },
      }),
    ).toEqual(defaults)
  })

  test("migrates old sidebar and panel settings and writes current fields", () => {
    const value = decode({ sidebar: { workspaces: true }, review: {}, fileTree: { opened: true, width: 260 } })
    expect(value.sidebar).toEqual({ opened: false, width: 344, workspaces: {}, workspacesDefault: true })
    expect(value.review).toEqual({ diffStyle: "split", panelOpened: true })
    expect(value.fileTree).toEqual({ opened: true, width: 200, tab: "changes" })
    expect(Schema.encodeSync(schema)(value)).toEqual(value)
    expect(decode(Schema.encodeSync(schema)(value))).toEqual(value)
    expect(decode({ fileTree: { opened: true } }).review.panelOpened).toBe(false)
  })

  test("preserves current panel preferences", () => {
    const value = decode({
      review: { diffStyle: "unified", panelOpened: false },
      fileTree: { opened: true, width: 260, tab: "all" },
    })
    expect(value.review).toEqual({ diffStyle: "unified", panelOpened: false })
    expect(value.fileTree).toEqual({ opened: true, width: 260, tab: "all" })
  })

  test("distinguishes an invalid panel field from an invalid review section", () => {
    const fileTree = { opened: true, tab: "all" }
    expect(decode({ review: { panelOpened: "bad" }, fileTree }).review.panelOpened).toBe(true)
    expect(decode({ review: null, fileTree }).review.panelOpened).toBe(false)
  })

  test("preserves whole-record and whole-entry recovery for strict fields", () => {
    const key = "local\u0000L3Byb2plY3Q/session"
    const scroll = { good: { x: 1, y: 2 }, bad: { x: "bad", y: 3 } }
    expect(
      decode({
        sidebar: { workspaces: { good: true, bad: "bad" } },
        sessionView: { [key]: { scroll, reviewMode: "git" } },
      }),
    ).toMatchObject({
      sidebar: { workspaces: {} },
      sessionView: { [key]: { scroll: {}, reviewMode: "git" } },
    })
    expect(
      decode({ sessionView: { [key]: { scroll: { good: { x: 1, y: 2 } }, reviewMode: "bad" } } }).sessionView,
    ).toEqual({ [key]: { scroll: {} } })
  })

  test("keeps scoped state and salvages valid tab entries", () => {
    const key = "local\u0000L3Byb2plY3Q/session"
    const value = decode({
      sessionTabs: { old: { all: ["old"] }, [key]: { all: ["a", null, "a", "b"], active: 12 } },
      sessionView: { old: { scroll: {} }, [key]: { scroll: {}, reviewOpen: ["a", null, "b"] } },
    })
    expect(value.sessionTabs).toEqual({ [key]: { all: ["a", "b"], active: undefined } })
    expect(value.sessionView).toEqual({ [key]: { scroll: {}, reviewOpen: ["a", "b"] } })
  })
})

describe("layout session-key helpers", () => {
  test("couples touch and scroll seed in order", () => {
    const calls: string[] = []
    const result = ensureSessionKey(
      "dir/a",
      (key) => calls.push(`touch:${key}`),
      (key) => calls.push(`seed:${key}`),
    )

    expect(result).toBe("dir/a")
    expect(calls).toEqual(["touch:dir/a", "seed:dir/a"])
  })

  test("reads dynamic accessor keys lazily", () => {
    const seen: string[] = []

    createRoot((dispose) => {
      const [key, setKey] = createSignal("dir/one")
      const read = createSessionKeyReader(key, (value) => seen.push(value))

      expect(read()).toBe("dir/one")
      setKey("dir/two")
      expect(read()).toBe("dir/two")

      dispose()
    })

    expect(seen).toEqual(["dir/one", "dir/two"])
  })
})

describe("pruneSessionKeys", () => {
  test("keeps active key and drops lowest-used keys", () => {
    const drop = pruneSessionKeys({
      keep: "k4",
      max: 3,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
        ["k3", 3],
        ["k4", 4],
      ]),
      view: ["k1", "k2", "k4"],
      tabs: ["k1", "k3", "k4"],
    })

    expect(drop).toEqual(["k1"])
    expect(drop.includes("k4")).toBe(false)
  })

  test("does not prune without keep key", () => {
    const drop = pruneSessionKeys({
      keep: undefined,
      max: 1,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
      ]),
      view: ["k1"],
      tabs: ["k2"],
    })

    expect(drop).toEqual([])
  })
})
