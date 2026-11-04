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

test("a preview retains its child-session route when promoted", () => {
  const state = fixture()

  state.preview.open(first)
  state.preview.setRoute("ses_child", first.sessionId)
  state.preview.keep()
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
