import { expect, test } from "bun:test"
import {
  diffCodeTokens,
  projectHighlightedCode,
  shouldResetCodeTokens,
  type HighlightedCodeState,
  type RenderedCodeState,
} from "./markdown-code-state"

const previous: RenderedCodeState = {
  language: "ts",
  generation: 1,
  stableCount: 3,
  stable: [
    ["const", "color:#f00"],
    [" ", ""],
    ["x", "color:#0f0"],
  ],
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

test("projects highlighted prefix with an unstyled trailing suffix while worker catches up", () => {
  const highlighted: HighlightedCodeState = {
    requestedLanguage: "ts",
    language: "ts",
    source: "const x = 1\n",
    complete: false,
    generation: 1,
    stable: [
      ["const", "color:#f00"],
      [" ", ""],
      ["x", "color:#0f0"],
    ],
    unstable: [[" = 1\n", "color:#00f"]],
  }

  const interim = projectHighlightedCode(highlighted, "const x = 1\nconst y = 2\n", "ts")
  expect(interim).toEqual({
    language: "ts",
    generation: 1,
    stable: highlighted.stable,
    unstable: [
      [" = 1\n", "color:#00f"],
      ["const y = 2\n", ""],
    ],
  })

  const renderedBefore: RenderedCodeState = {
    language: "ts",
    generation: 1,
    stableCount: highlighted.stable.length,
    stable: highlighted.stable,
    unstable: highlighted.unstable,
    raw: "```ts\nconst x = 1\n",
  }

  const diffInterim = diffCodeTokens(renderedBefore, {
    ...interim,
    raw: "```ts\nconst x = 1\nconst y = 2\n",
  })
  expect(diffInterim).toEqual({
    keep: 4,
    append: [["const y = 2\n", ""]],
  })

  const renderedInterim: RenderedCodeState = {
    language: interim.language,
    generation: interim.generation,
    stableCount: interim.stable.length,
    stable: interim.stable,
    unstable: interim.unstable,
    raw: "```ts\nconst x = 1\nconst y = 2\n",
  }

  const diffCaughtUp = diffCodeTokens(renderedInterim, {
    language: "ts",
    generation: 1,
    stable: [
      ...highlighted.stable,
      [" = 1\n", "color:#00f"],
      ["const", "color:#f00"],
    ],
    unstable: [[" y = 2\n", "color:#0f0"]],
    raw: "```ts\nconst x = 1\nconst y = 2\n",
  })
  expect(diffCaughtUp).toEqual({
    keep: 4,
    append: [
      ["const", "color:#f00"],
      [" y = 2\n", "color:#0f0"],
    ],
  })
})

test("preserves matching token spans across completion generation bumps", () => {
  const streamed: RenderedCodeState = {
    language: "ts",
    generation: 1,
    stableCount: 2,
    stable: [
      ["const", "color:#f00"],
      [" ", ""],
    ],
    unstable: [
      ["x", "color:#0f0"],
      [" = 1\n", "color:#00f"],
    ],
    raw: "```ts\nconst x = 1\n",
  }

  const completed = diffCodeTokens(streamed, {
    language: "ts",
    generation: 2,
    stable: [
      ["const", "color:#f00"],
      [" ", ""],
      ["x", "color:#0f0"],
      [" = 1", "color:#00f"],
    ],
    unstable: [],
    raw: "```ts\nconst x = 1\n```",
  })
  expect(completed).toEqual({
    keep: 3,
    append: [[" = 1", "color:#00f"]],
  })
})
