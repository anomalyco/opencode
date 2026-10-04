import { describe, expect, test } from "bun:test"
import { createRoot, getOwner, onCleanup } from "solid-js"
import { createTabMemory } from "./memory"
import { nextTabAfterClose, pushClosedTab, removeClosedTabs, takeClosedTab, type ClosedTab } from "./closed"
import { findSessionTab, sessionIDHasOpenTab, tabHref, tabKey, type SessionTab, type Tab } from "./tabs"
import { Schema } from "effect"
import { TabStorage } from "./schema"
import { ServerConnection } from "@/runtime/server/registry"
import { Persistence } from "@/runtime/persistence/schema"

const server = ServerConnection.Key.make("local\nhttp://localhost:4096")

const decodeTabs = Schema.decodeUnknownSync(Persistence.withInitial(TabStorage.Tabs, []))

function sessionTab(sessionId: string): SessionTab {
  return { type: "session", server, sessionId }
}

describe("tab migration", () => {
  test("round trips draft MCP choices without changing older drafts", () => {
    const legacy: Tab = { type: "draft", draftID: "legacy-draft", server, directory: "/project" }

    const draft: Tab = {
      ...legacy,
      draftID: "mcp-draft",
      worktree: "create",
      mcp: { target: "new-worktree", states: { first: true, second: false } },
    }

    const restored = decodeTabs([legacy, draft])
    expect(restored).toEqual([legacy, draft])
    expect(decodeTabs(Schema.encodeSync(TabStorage.Tabs)(restored))).toEqual([legacy, draft])
  })

  const dropped: { name: string; stored: unknown; expected: Tab[] }[] = [
    {
      name: "null and malformed tabs",
      stored: [null, sessionTab("a"), { type: "session", server }, { type: "unknown", server }, "invalid"],
      expected: [sessionTab("a")],
    },
    { name: "tabs without a server", stored: [{ type: "session", sessionId: "a" }], expected: [] },
    { name: "null top-level data", stored: null, expected: [] },
    { name: "object top-level data", stored: {}, expected: [] },
  ]

  test.each(dropped)("drops $name", ({ stored, expected }) => {
    expect(decodeTabs(stored)).toEqual(expected)
  })

  test("preserves the active child route and drops an invalid one", () => {
    expect(decodeTabs([{ ...sessionTab("root"), routeSessionId: "child", routeParentId: "parent" }])).toEqual([
      { ...sessionTab("root"), routeSessionId: "child", routeParentId: "parent" },
    ])
    expect(decodeTabs([{ ...sessionTab("parent"), routeSessionId: 1 }])).toEqual([sessionTab("parent")])
    expect(decodeTabs([{ ...sessionTab("parent"), routeSessionId: "child", routeParentId: 1 }])).toEqual([
      { ...sessionTab("parent"), routeSessionId: "child" },
    ])
  })

  test("encodes only canonical tabs and preserves drafts", () => {
    const draft: Tab = { type: "draft", server, draftID: "draft", directory: "/project", branch: "main" }

    const tabs = decodeTabs([
      { ...sessionTab("root"), routeSessionId: "root", routeParentId: "stale", legacy: true },
      draft,
    ])

    expect(tabs).toEqual([sessionTab("root"), draft])
    expect(Schema.encodeSync(TabStorage.Tabs)(tabs)).toEqual(tabs)
    expect(decodeTabs(Schema.encodeSync(TabStorage.Tabs)(tabs))).toEqual(tabs)
  })

  test("salvages valid closed session tabs", () => {
    expect(
      Schema.decodeUnknownSync(Persistence.withInitial(TabStorage.Closed, []))([
        { tab: sessionTab("a"), index: 1 },
        { tab: sessionTab("b"), index: -1 },
        { tab: { type: "draft", server, draftID: "d", directory: "/project" }, index: 0 },
        null,
      ]),
    ).toEqual([{ tab: sessionTab("a"), index: 1 }])
  })

  test("validates auxiliary tab state", () => {
    expect(
      Schema.decodeUnknownSync(Persistence.withInitial(TabStorage.Recent, { key: undefined }))({ key: 1 }),
    ).toEqual({ key: undefined })
    expect(Schema.decodeUnknownSync(TabStorage.Infos)({})).toEqual({})
    expect(Schema.decodeUnknownSync(TabStorage.Regions)({})).toEqual({})
    expect(Schema.decodeUnknownSync(TabStorage.Infos)({ tab: { title: "Title", directory: "/project" } })).toEqual({
      tab: { title: "Title", directory: "/project" },
    })
    const regions = Schema.decodeUnknownSync(TabStorage.Regions)({ tab: { terminal: true, terminalHeight: 300 } })
    expect(regions).toEqual({ tab: { dock: true, dockHeight: 300 } })
    expect(Schema.encodeSync(TabStorage.Regions)(regions)).toEqual({ tab: { terminal: true, terminalHeight: 300 } })
    expect(() => Schema.decodeUnknownSync(TabStorage.Regions)({ tab: { terminal: "yes" } })).toThrow()
  })
})

test("session tab identity stays rooted while its href follows the child route", () => {
  const parent = sessionTab("parent")
  const child = { ...parent, routeSessionId: "child" }

  expect(tabKey(child)).toBe(tabKey(parent))
  expect(tabHref(child)).toContain("/session/child")
})

test("finds open root and routed session tabs", () => {
  const tab = { ...sessionTab("root"), routeSessionId: "child" }
  const tabs = [tab]

  expect(findSessionTab(tabs, server, "root")).toBe(tab)
  expect(findSessionTab(tabs, server, "child")).toBe(tab)
  expect(findSessionTab(tabs, server, "closed")).toBeUndefined()
  expect(sessionIDHasOpenTab(tabs, server, "root")).toBe(true)
  expect(sessionIDHasOpenTab(tabs, server, "child")).toBe(true)
  expect(sessionIDHasOpenTab(tabs, server, "closed")).toBe(false)
  expect(sessionIDHasOpenTab(tabs, ServerConnection.Key.make("other"), "root")).toBe(false)
})

describe("tab memory", () => {
  test("keeps state until its tab is removed", () => {
    createRoot((dispose) => {
      const memory = createTabMemory(getOwner())
      let disposed = 0

      const first = memory.ensure("tab", "prompt", () => {
        onCleanup(() => disposed++)

        return { value: "prompt" }
      })

      expect(memory.ensure("tab", "prompt", () => ({ value: "other" }))).toBe(first)
      expect(memory.get<typeof first>("tab", "prompt")).toBe(first)
      expect(memory.get("missing", "prompt")).toBeUndefined()
      expect(memory.ensure("other", "prompt", () => ({ value: "other" }))).not.toBe(first)

      memory.remove("tab")
      expect(disposed).toBe(1)
      expect(memory.ensure("tab", "prompt", () => ({ value: "new" }))).not.toBe(first)
      dispose()
    })
  })
})

describe("closed tab stack", () => {
  test("records session tabs with their index and ignores draft tabs", () => {
    const draft: Tab = { type: "draft", draftID: "d1", server, directory: "/tmp" }

    expect(pushClosedTab([], sessionTab("a"), 2)).toEqual([{ tab: sessionTab("a"), index: 2 }])
    expect(pushClosedTab([], draft, 0)).toEqual([])
  })

  test("caps the stack size", () => {
    const stack = Array.from({ length: 30 }, (_, i) => i).reduce<ClosedTab[]>(
      (acc, i) => pushClosedTab(acc, sessionTab(`s${i}`), i),
      [],
    )

    expect(stack).toHaveLength(25)
    expect(stack[0]?.tab.sessionId).toBe("s5")
    expect(stack.at(-1)?.tab.sessionId).toBe("s29")
  })

  test("pops the most recently closed tab that is not already open", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]

    expect(takeClosedTab(stack, [])).toEqual({ entry: stack[1], stack: [stack[0]] })
    expect(takeClosedTab(stack, [sessionTab("b")])).toEqual({ entry: stack[0], stack: [] })
    expect(takeClosedTab(stack, [sessionTab("a"), sessionTab("b")])).toEqual({ entry: undefined, stack: [] })
    expect(takeClosedTab([], []).entry).toBeUndefined()
  })

  test("purges removed sessions", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]

    expect(removeClosedTabs(stack, server, ["a"])).toEqual([{ tab: sessionTab("b"), index: 1 }])
  })

  test("does not navigate when a background tab closes", () => {
    const tabs = [sessionTab("a"), sessionTab("b"), sessionTab("c")]

    expect(nextTabAfterClose(tabs, 1, false)).toBeUndefined()
    expect(nextTabAfterClose(tabs, 1, true)).toEqual(sessionTab("c"))
    expect(nextTabAfterClose([sessionTab("a")], 0, true)).toBeNull()
  })
})
