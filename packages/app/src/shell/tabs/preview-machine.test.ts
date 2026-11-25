import { expect, test } from "bun:test"
import { ServerKey } from "@/runtime/server/persistence"
import type { SessionTab } from "./tabs"
import {
  currentPreview,
  INITIAL_PREVIEW_STATE,
  matchesPreview,
  transitionPreview,
  type PreviewEvent,
} from "./preview-machine"

const first: SessionTab = { type: "session", server: ServerKey.make("server"), sessionId: "ses_first" }

const second: SessionTab = { ...first, sessionId: "ses_second" }

test("replacing a preview then keeping the submitted session leaves the replacement active", () => {
  const opened = transitionPreview(INITIAL_PREVIEW_STATE, { type: "open", tab: first })

  const replaced = transitionPreview(opened, { type: "open", tab: second })

  expect(currentPreview(opened)).toBe(first)
  expect(currentPreview(replaced)).toBe(second)
  expect(transitionPreview(replaced, { type: "keep", tab: first })).toBe(replaced)
  expect(transitionPreview(replaced, { type: "keep", tab: second })).toBe(INITIAL_PREVIEW_STATE)
})

test("route changes are immutable, retain child routes on reopen, and clear when returning to the root", () => {
  const opened = transitionPreview(INITIAL_PREVIEW_STATE, { type: "open", tab: first })

  const routed = transitionPreview(opened, { type: "route", sessionId: "ses_child", parentId: first.sessionId })

  expect(currentPreview(opened)).toEqual(first)
  expect(currentPreview(routed)).toEqual({ ...first, routeSessionId: "ses_child", routeParentId: first.sessionId })
  expect(transitionPreview(routed, { type: "open", tab: first })).toBe(routed)
  expect(transitionPreview(routed, { type: "route", sessionId: "ses_child", parentId: first.sessionId })).toBe(routed)

  const root = transitionPreview(routed, { type: "route", sessionId: first.sessionId })

  expect(currentPreview(root)).toEqual({ ...first, routeSessionId: undefined, routeParentId: undefined })
  expect(transitionPreview(root, { type: "route", sessionId: first.sessionId })).toBe(root)
})

test("activation matches both server and session and ignores the child route", () => {
  const opened = transitionPreview(INITIAL_PREVIEW_STATE, { type: "open", tab: first })

  const routed = transitionPreview(opened, { type: "route", sessionId: "ses_child", parentId: first.sessionId })

  expect(matchesPreview(routed, first)).toBe(true)
  expect(transitionPreview(routed, { type: "activate", tab: first })).toBe(routed)

  const unrelated: SessionTab[] = [
    second,
    { ...first, server: ServerKey.make("other") },
    { ...first, sessionId: "ses_child" },
  ]

  for (const tab of unrelated) {
    expect(matchesPreview(routed, tab)).toBe(false)
    expect(transitionPreview(routed, { type: "activate", tab })).toBe(INITIAL_PREVIEW_STATE)
    expect(transitionPreview(routed, { type: "keep", tab })).toBe(routed)
  }

  expect(
    transitionPreview(routed, {
      type: "activate",
      tab: { type: "draft", server: first.server, draftID: "draft", directory: "/project" },
    }),
  ).toBe(INITIAL_PREVIEW_STATE)
})

test("release returns to the reusable idle state and inapplicable events preserve its identity", () => {
  const opened = transitionPreview(INITIAL_PREVIEW_STATE, { type: "open", tab: first })

  const idle = transitionPreview(opened, { type: "release" })

  const events: PreviewEvent[] = [
    { type: "release" },
    { type: "activate", tab: first },
    { type: "keep", tab: first },
    { type: "route", sessionId: "ses_child" },
  ]

  expect(idle).toBe(INITIAL_PREVIEW_STATE)
  expect(currentPreview(idle)).toBeUndefined()
  expect(matchesPreview(idle, first)).toBe(false)

  for (const event of events) expect(transitionPreview(idle, event)).toBe(idle)
  expect(currentPreview(transitionPreview(idle, { type: "open", tab: second }))).toBe(second)
})
