import { afterEach, expect, jest, test } from "bun:test"
import { noticeActions } from "./notice-actions"
import { navigationNotice } from "./refusal-notice"

afterEach(() => jest.useRealTimers())

test("Open belongs to one presentation and expires even if the timer has not run", async () => {
  jest.useFakeTimers()
  const tokens: string[] = []
  const launches: string[] = []
  const copies: string[] = []

  const actions = noticeActions((_, token) => tokens.push(token), {
    tab: async () => {},
    app: async (url) => { launches.push(url) },
    copy(url) { copies.push(url) },
  })

  const notice = navigationNotice("obsidian://open?file=fixture", {}, "conversation")
  actions.show(notice)
  actions.show(notice)
  await actions.answer(tokens[0], false)
  expect(launches).toEqual([])
  await actions.answer(tokens[1], false)
  await actions.answer(tokens[1], false)
  expect(launches).toEqual(["obsidian://open?file=fixture"])
  actions.show(notice)
  jest.advanceTimersByTime(60_000)
  await actions.answer(tokens[2], false)
  expect(tokens).toHaveLength(4)
  actions.show({ reason: "external", target: "zed:fixture", action: "open", source: "conversation" })
  await actions.answer(tokens[4], false)
  expect(launches).toEqual(["obsidian://open?file=fixture"])
  actions.show(notice)
  await actions.answer(tokens[5], false, true)
  await actions.answer(tokens[5], false)
  expect(copies).toEqual(["obsidian://open?file=fixture"])
  expect(launches).toEqual(["obsidian://open?file=fixture"])
})
