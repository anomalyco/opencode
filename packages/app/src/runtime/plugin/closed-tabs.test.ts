import { expect, test } from "bun:test"
import type { MountedSession, Panel, PanelProps, PanelTab, SessionRef, SessionScreen } from "@opencode/plugin/gui"
import { CLOSED_TABS_LIMIT, closedEntry, createClosedTabs } from "./closed-tabs"

// SAFETY: the in-memory store reads only `key`; the rest of a session reference is never touched.
const session = (key: string) => ({ key }) as SessionRef

// SAFETY: `closedEntry` reads only the tab's fields; the session and screen pass through untouched.
const props = (tab: Partial<PanelTab>): PanelProps => ({
  tab: { id: "main", title: "Tab", ...tab },
  session: {} as MountedSession,
  screen: {} as SessionScreen,
})

const panel = (fields: Partial<Panel>): Panel => ({
  id: "main",
  region: "side",
  list: () => [],
  render: () => null,
  ...fields,
})

test("keeps a session's closed tabs newest first, once each, up to the limit", () => {
  const closed = createClosedTabs()
  const a = session("a")

  for (const index of Array.from({ length: CLOSED_TABS_LIMIT + 2 }, (_, value) => value))
    closed.push(a, { key: `file://${index}.ts`, title: `${index}.ts` })
  closed.push(a, { key: "file://5.ts", title: "5.ts" })
  closed.push(session("b"), { key: "review:main", title: "Review" })

  const keys = closed.list(a).map((entry) => entry.key)

  expect(keys).toHaveLength(CLOSED_TABS_LIMIT)
  expect(keys.slice(0, 3)).toEqual([
    "file://5.ts",
    `file://${CLOSED_TABS_LIMIT + 1}.ts`,
    `file://${CLOSED_TABS_LIMIT}.ts`,
  ])
  expect(keys.filter((key) => key === "file://5.ts")).toHaveLength(1)
  expect(closed.list(session("b")).map((entry) => entry.key)).toEqual(["review:main"])
})

test("takes the newest closed tab, or the one asked for", () => {
  const closed = createClosedTabs()
  const a = session("a")

  closed.push(a, { key: "file://one.ts", title: "one.ts" })
  closed.push(a, { key: "browser:tab", title: "Docs", data: "https://example.com" })
  closed.push(a, { key: "context:main", title: "Context" })

  expect(closed.take(a, "browser:tab")?.data).toBe("https://example.com")
  expect(closed.take(a)?.key).toBe("context:main")
  expect(closed.list(a).map((entry) => entry.key)).toEqual(["file://one.ts"])
  expect(closed.take(a, "missing")).toBeUndefined()
})

test("lists a closing tab by its panel's word, its title by default, and never a transient one unasked", () => {
  const mobile = { title: "Context", order: 0, kind: "menu", icon: "status" } as const

  expect(closedEntry("context:main", panel({ mobile }), props({ title: "Context" }))).toEqual({
    key: "context:main",
    title: "Context",
    icon: "status",
    file: undefined,
    detail: undefined,
    data: undefined,
  })
  expect(closedEntry("file://a.ts", panel({}), props({ title: "a.ts", file: "a.ts" }))?.file).toBe("a.ts")

  const browser = panel({ closed: () => ({ icon: "globe", detail: "example.com", data: "https://example.com" }) })

  expect(closedEntry("browser:t", browser, props({ title: "Docs" }))).toMatchObject({
    title: "Docs",
    icon: "globe",
    detail: "example.com",
    data: "https://example.com",
  })
  expect(closedEntry("browser:t", panel({ closed: () => false }), props({}))).toBeUndefined()
  expect(closedEntry("terminal:1", panel({ transient: true }), props({}))).toBeUndefined()
  expect(closedEntry("file:open", panel({}), props({ transient: true }))).toBeUndefined()
})
