import { expect, test } from "bun:test"
import type { PromptInput } from "@opencode-ai/schema"
import {
  expandPromptInputPastedText,
  realignPromptInputMentions,
  realignPromptMentions,
} from "../../src/prompt/mention"

test("realigns reordered, duplicate, deleted, and prefix-related mentions", () => {
  const mentions = [
    { start: 0, end: 4, text: "@one" },
    { start: 5, end: 10, text: "@same" },
    { start: 11, end: 15, text: "@two" },
    { start: 16, end: 21, text: "@same" },
    { start: 22, end: 27, text: "@gone" },
  ]
  const before = structuredClone(mentions)
  expect(realignPromptMentions("@two @same @one @same", mentions)).toEqual([
    { start: 11, end: 15, text: "@one" },
    { start: 5, end: 10, text: "@same" },
    { start: 0, end: 4, text: "@two" },
    { start: 16, end: 21, text: "@same" },
    undefined,
  ])
  expect(mentions).toEqual(before)
  expect(
    realignPromptMentions("@foobar @foo", [
      { start: 0, end: 4, text: "@foo" },
      { start: 5, end: 12, text: "@foobar" },
    ]),
  ).toEqual([
    { start: 8, end: 12, text: "@foo" },
    { start: 0, end: 7, text: "@foobar" },
  ])
  expect(
    realignPromptMentions("@foobar @foobar", [
      { start: 0, end: 4, text: "@foo" },
      { start: 13, end: 20, text: "@foobar" },
    ]),
  ).toEqual([undefined, { start: 8, end: 15, text: "@foobar" }])
  expect(
    realignPromptMentions("@same @same", [
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
  const output = realignPromptInputMentions("@agent then @file", input)
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

test("shifts mention hints when pasted placeholders expand", () => {
  const input = {
    text: "[Pasted text #1] @same @same",
    files: [{ uri: "file:///same", mention: { start: 23, end: 28, text: "@same" } }],
  } satisfies PromptInput.Prompt
  const expanded = expandPromptInputPastedText(input, [
    { text: "a much longer pasted value", source: { start: 0, end: 16 } },
  ])
  expect(expanded.files?.[0]?.mention).toEqual({ start: 33, end: 38, text: "@same" })
  expect(realignPromptInputMentions(expanded.text, expanded).files?.[0]?.mention).toEqual({
    start: 33,
    end: 38,
    text: "@same",
  })
})
