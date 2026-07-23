import { expect, test } from "bun:test"
import { shouldResetCodeTokens } from "./markdown-code-state"

const previous = {
  language: "ts",
  generation: 1,
  stableCount: 3,
  unstable: [],
  raw: "```ts\nconst x = 1\n```",
}

test("resets tokens for a non-prefix replacement with the same generation and token count", () => {
  expect(
    shouldResetCodeTokens(previous, {
      language: "ts",
      generation: 1,
      stableCount: 3,
      raw: "```ts\nlet y = 2\n```",
    }),
  ).toBe(true)
})

test("retains tokens for an append-only streaming update", () => {
  expect(
    shouldResetCodeTokens(previous, {
      language: "ts",
      generation: 1,
      stableCount: 4,
      raw: `${previous.raw}\nmore`,
    }),
  ).toBe(false)
})
