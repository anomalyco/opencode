import { expect, test } from "bun:test"
import { measureEditText } from "@opentui/core"
import type { PromptInput } from "@opencode/schema"
import {
  expandPromptInputPastedText,
  realignPromptInputMentions,
  realignPromptMentions,
} from "../../src/prompt/mention"

const realign = (content: string, mentions: Parameters<typeof realignPromptMentions>[1]) =>
  realignPromptMentions(content, mentions, "unicode")

test("realigns reordered, duplicate, deleted, and prefix-related mentions", () => {
  const mentions = [
    { start: 0, end: 4, text: "@one" },
    { start: 5, end: 10, text: "@same" },
    { start: 11, end: 15, text: "@two" },
    { start: 16, end: 21, text: "@same" },
    { start: 22, end: 27, text: "@gone" },
  ]
  const before = structuredClone(mentions)
  expect(realign("@two @same @one @same", mentions)).toEqual([
    { start: 11, end: 15, text: "@one" },
    { start: 5, end: 10, text: "@same" },
    { start: 0, end: 4, text: "@two" },
    { start: 16, end: 21, text: "@same" },
    undefined,
  ])
  expect(mentions).toEqual(before)
  expect(
    realign("@foobar @foo", [
      { start: 0, end: 4, text: "@foo" },
      { start: 5, end: 12, text: "@foobar" },
    ]),
  ).toEqual([
    { start: 8, end: 12, text: "@foo" },
    { start: 0, end: 7, text: "@foobar" },
  ])
  expect(
    realign("@foobar @foobar", [
      { start: 0, end: 4, text: "@foo" },
      { start: 13, end: 20, text: "@foobar" },
    ]),
  ).toEqual([undefined, { start: 8, end: 15, text: "@foobar" }])
  expect(
    realign("@same @same", [
      { start: 100, end: 105, text: "@same" },
      { start: 4, end: 9, text: "@same" },
    ]),
  ).toEqual([
    { start: 6, end: 11, text: "@same" },
    { start: 0, end: 5, text: "@same" },
  ])
})

test("realigns mixed prompt attachments without mutation", () => {
  const input = {
    text: "@file @gone @agent",
    files: [
      { uri: "file:///file", mention: { start: 0, end: 5, text: "@file" } },
      { uri: "data:image/png;base64,YWJj", name: "image.png" },
      { uri: "file:///gone", mention: { start: 6, end: 11, text: "@gone" } },
    ],
    agents: [{ name: "agent", mention: { start: 12, end: 18, text: "@agent" } }],
  } satisfies PromptInput.Prompt
  const before = structuredClone(input)
  const output = realignPromptInputMentions("@agent then @file", input, "unicode")
  expect(output).toEqual({
    text: "@agent then @file",
    files: [
      { uri: "file:///file", mention: { start: 12, end: 17, text: "@file" } },
      { uri: "data:image/png;base64,YWJj", name: "image.png", mention: undefined },
    ],
    agents: [{ name: "agent", mention: { start: 0, end: 6, text: "@agent" } }],
  })
  expect(input).toEqual(before)
  expect(output.files).not.toBe(input.files)
  expect(output.agents).not.toBe(input.agents)
})

test.each(["wcwidth", "unicode"] as const)("shifts mention hints past pasted text under %s", (widthMethod) => {
  const measure = (text: string) => measureEditText(text, { widthMethod })
  const input = {
    text: "[Pasted text #1] @same @same",
    files: [{ uri: "file:///same", mention: { start: 23, end: 28, text: "@same" } }],
  } satisfies PromptInput.Prompt
  const expanded = expandPromptInputPastedText(
    input,
    [{ text: "a\tmuch 中文👨‍👩‍👧 longer\fpasted\r\nvalue", source: { start: 0, end: 16 } }],
    widthMethod,
  )
  const mention = {
    start: measure(expanded.text.slice(0, -5)),
    end: measure(expanded.text),
    text: "@same",
  }
  expect(expanded.files?.[0]?.mention).toEqual(mention)
  expect(realignPromptInputMentions(expanded.text, expanded, widthMethod).files?.[0]?.mention).toEqual(mention)
})
