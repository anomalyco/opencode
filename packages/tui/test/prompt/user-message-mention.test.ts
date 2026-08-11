import { expect, test } from "bun:test"
import { renderUserMessageMentions } from "../../src/prompt/user-message-mention"

test("renders valid file, agent, and skill mentions in order", () => {
  const result = renderUserMessageMentions("请检查 @src/app.ts 并使用 @build /effect", [
    { key: "file:0", type: "file", mention: { start: 7, end: 18, text: "@src/app.ts" } },
    { key: "agent:0", type: "agent", mention: { start: 26, end: 32, text: "@build" } },
    { key: "skill:0", type: "skill", mention: { start: 33, end: 40, text: "/effect" } },
  ])

  expect(result.segments).toEqual([
    { text: "请检查 " },
    { text: "@src/app.ts", type: "file" },
    { text: " 并使用 " },
    { text: "@build", type: "agent" },
    { text: " " },
    { text: "/effect", type: "skill" },
  ])
  expect([...result.inline]).toEqual(["file:0", "agent:0", "skill:0"])
})

test("falls back when ranges are stale, out of bounds, or overlapping", () => {
  const result = renderUserMessageMentions("看 @one 和 @two", [
    { key: "stale", type: "file", mention: { start: 3, end: 7, text: "@bad" } },
    { key: "overlap-a", type: "agent", mention: { start: 3, end: 7, text: "@one" } },
    { key: "overlap-b", type: "skill", mention: { start: 5, end: 8, text: "ne " } },
    { key: "out-of-bounds", type: "file", mention: { start: 100, end: 105, text: "@two" } },
  ])

  expect(result.segments).toEqual([{ text: "看 @one 和 @two" }])
  expect([...result.inline]).toEqual([])
})

test("uses terminal display width for Unicode ranges", () => {
  const text = "中文 @file"
  const result = renderUserMessageMentions(text, [
    { key: "file:0", type: "file", mention: { start: 5, end: 10, text: "@file" } },
  ])

  expect(result.segments).toEqual([{ text: "中文 " }, { text: "@file", type: "file" }])
})

test("falls back when a range splits a wide character", () => {
  const result = renderUserMessageMentions("中文", [
    { key: "file:0", type: "file", mention: { start: 0, end: 1, text: "中" } },
  ])

  expect(result.segments).toEqual([{ text: "中文" }])
  expect([...result.inline]).toEqual([])
})
