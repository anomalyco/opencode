import { expect, test } from "bun:test"
import { ServerKey } from "@/runtime/server/persistence"
import type { SessionTab } from "./tabs"
import { createSessionPreview } from "./preview"

const first: SessionTab = { type: "session", server: ServerKey.make("server"), sessionId: "ses_first" }

const second: SessionTab = { ...first, sessionId: "ses_second" }

function fixture(open: SessionTab[] = []) {
  const tabs = [...open]

  const navigations: { tab: SessionTab; preview: boolean }[] = []

  const discarded: SessionTab[] = []

  const preview = createSessionPreview({
    tabs: () => tabs,
    onKeep: (tab) => {
      tabs.push(tab)

      return tab
    },
    onNavigate: (tab, preview) => navigations.push({ tab, preview }),
    onDiscard: (tab) => discarded.push(tab),
  })

  return { tabs, preview, navigations, discarded }
}

test("browsing a project session creates a preview, not an open tab", () => {
  const state = fixture()

  state.preview.open(first)
  expect(state.tabs).toEqual([])
  expect(state.preview.current()).toEqual(first)
  expect(state.navigations).toEqual([{ tab: first, preview: true }])
})

test("browsing another project session replaces the preview without accumulating tabs", () => {
  const state = fixture()

  state.preview.open(first)
  state.preview.open(second)
  expect(state.tabs).toEqual([])
  expect(state.preview.current()).toEqual(second)
  expect(state.discarded).toEqual([first])
})

test("opening an existing tab selects it instead of creating a preview or duplicate", () => {
  const state = fixture([first])

  state.preview.open(second)
  state.preview.open(first)
  expect(state.tabs).toEqual([first])
  expect(state.preview.current()).toBeUndefined()
  expect(state.navigations.at(-1)).toEqual({ tab: first, preview: false })
})

test("activity keeps the first preview as a tab without discarding its composer state", () => {
  const state = fixture()

  state.preview.open(first)
  state.preview.keep()
  state.preview.keep()
  expect(state.tabs).toEqual([first])
  expect(state.preview.current()).toBeUndefined()
  expect(state.discarded).toEqual([])
})

test("closing a preview leaves kept tabs unchanged", () => {
  const state = fixture([first])

  state.preview.open(second)
  state.preview.clear()
  expect(state.tabs).toEqual([first])
  expect(state.preview.current()).toBeUndefined()
  expect(state.discarded).toEqual([second])
})

test.each([false, true])("a preview retains its child-session route when promoted (captured: %s)", (captured) => {
  const state = fixture()

  const opened = state.preview.open(first)

  state.preview.setRoute("ses_child", first.sessionId)

  state.preview.keep(captured ? opened : undefined)

  expect(state.tabs).toEqual([{ ...first, routeSessionId: "ses_child", routeParentId: first.sessionId }])
})

test("a delayed submission keeps its own session without promoting the replacement preview", () => {
  const state = fixture()

  const submitted = state.preview.open(first)

  state.preview.open(second)
  state.preview.keep(submitted)
  expect(state.tabs).toEqual([first])
  expect(state.preview.current()).toEqual(second)
})

test("direct navigation to a kept tab clears the old preview", () => {
  const state = fixture([second])

  state.preview.open(first)
  state.preview.activate(second)
  expect(state.preview.current()).toBeUndefined()
  expect(state.discarded).toEqual([first])
  expect(state.tabs).toEqual([second])
})

test("releasing a preview returns it without disposing its state", () => {
  const state = fixture()

  const opened = state.preview.open(first)

  expect(state.preview.release()).toBe(opened)
  expect(state.preview.release()).toBeUndefined()
  expect(state.preview.current()).toBeUndefined()
  expect(state.discarded).toEqual([])
  expect(state.tabs).toEqual([])
})

test("reopening or activating the same session retains its preview and child route", () => {
  const state = fixture()

  state.preview.open(first)
  state.preview.setRoute("ses_child", first.sessionId)

  const routed = state.preview.current()

  if (!routed) throw new Error("Expected a routed preview")

  expect(state.preview.open(first)).toBe(routed)
  state.preview.activate(first)
  expect(state.preview.current()).toBe(routed)
  expect(state.discarded).toEqual([])
  expect(state.navigations.at(-1)).toEqual({ tab: routed, preview: true })
})

test("keeping an already-kept target is idempotent and leaves an unrelated preview active", () => {
  const state = fixture([first])

  const opened = state.preview.open(second)

  expect(state.preview.keep(first)).toBe(first)
  expect(state.preview.keep(first)).toBe(first)
  expect(state.tabs).toEqual([first])
  expect(state.preview.current()).toBe(opened)
  expect(state.discarded).toEqual([])
})
