import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ServerConnection } from "@/runtime/server/registry"
import { Persistence } from "@/runtime/persistence/schema"
import { currentRoute, initialLayout, layoutPersistence, layoutSchema } from "./layout"
import { createSignal } from "solid-js"
import { createSessionKeyReader, ensureSessionKey, pruneSessionKeys } from "./helpers"

test.each(["settings", "connect"] as const)("%s has its own layout route", (type) => {
  expect(currentRoute(`/${type}`, "")).toEqual({ type })
})

describe("layout persistence", () => {
  const schema = Persistence.withInitial(layoutPersistence, initialLayout(ServerConnection.Key.make("local")))
  const decode = Schema.decodeUnknownSync(schema)

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
      review: { panelOpened: false },
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
        review: { panelOpened: "bad" },
      }),
    ).toEqual(defaults)
  })

  test("migrates old sidebar and panel settings and writes current fields", () => {
    const value = decode({ sidebar: { workspaces: true }, review: {}, fileTree: { opened: true, width: 260 } })
    expect(value.sidebar).toEqual({ opened: false, width: 344, workspaces: {}, workspacesDefault: true })
    expect(value.review).toEqual({ panelOpened: true })
    expect(value.fileTree).toEqual({ opened: true, width: 200, tab: "changes" })
    expect(Schema.encodeSync(schema)(value)).toEqual(value)
    expect(decode(Schema.encodeSync(schema)(value))).toEqual(value)
    expect(decode({ fileTree: { opened: true } }).review.panelOpened).toBe(false)
    const current = decode({ review: { panelOpened: false }, fileTree: { opened: true, width: 260, tab: "all" } })
    expect(current.review).toEqual({ panelOpened: false })
    expect(current.fileTree).toEqual({ opened: true, width: 260, tab: "all" })
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
        sessionView: { [key]: { scroll, pendingMessage: "message" } },
      }),
    ).toMatchObject({
      sidebar: { workspaces: {} },
      sessionView: { [key]: { scroll: {}, pendingMessage: "message" } },
    })
    expect(
      decode({ sessionView: { [key]: { scroll: { good: { x: 1, y: 2 } }, pendingMessage: 5 } } }).sessionView,
    ).toEqual({ [key]: { scroll: {} } })
  })

  test("keeps scoped state and salvages valid tab entries", () => {
    const key = "local\u0000L3Byb2plY3Q/session"
    const value = decode({
      sessionTabs: { old: { all: ["old"] }, [key]: { all: ["a", null, "a", "b", "btw"], active: "btw" } },
      sessionView: { old: { scroll: {} }, [key]: { scroll: {} } },
    })
    // Transient tabs leave once the side region stops listing them, not during migration.
    expect(value.sessionTabs).toEqual({ [key]: { all: ["a", "b", "btw"], active: "btw" } })
    expect(value.sessionView).toEqual({ [key]: { scroll: {} } })
  })
})

test("session keys touch before seeding scroll state and follow a changing accessor on each read", () => {
  const calls: string[] = []
  expect(
    ensureSessionKey(
      "dir/a",
      (key) => calls.push(`touch:${key}`),
      (key) => calls.push(`seed:${key}`),
    ),
  ).toBe("dir/a")
  expect(calls).toEqual(["touch:dir/a", "seed:dir/a"])

  const seen: string[] = []
  const [key, setKey] = createSignal("dir/one")
  const read = createSessionKeyReader(key, (value) => seen.push(value))
  expect(seen).toEqual([])
  expect(read()).toBe("dir/one")
  setKey("dir/two")
  expect(read()).toBe("dir/two")
  expect(seen).toEqual(["dir/one", "dir/two"])
})

test("pruneSessionKeys keeps the active key, drops the lowest-used keys, and never prunes without an active key", () => {
  const used = new Map([
    ["k1", 1],
    ["k2", 2],
    ["k3", 3],
    ["k4", 4],
  ])
  const input = { max: 3, used, view: ["k1", "k2", "k4"], tabs: ["k1", "k3", "k4"] }
  expect(pruneSessionKeys({ ...input, keep: "k4" })).toEqual(["k1"])
  expect(pruneSessionKeys({ ...input, keep: undefined, max: 1 })).toEqual([])
})
