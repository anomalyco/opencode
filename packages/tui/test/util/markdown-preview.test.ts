import { expect, test } from "bun:test"
import { markdownPreview } from "../../src/util/markdown-preview"

test("strips common Markdown presentation syntax from previews", () => {
  expect(markdownPreview("The capture shows **Reset** and a _short-lived_ **override**.")).toBe(
    "The capture shows Reset and a short-lived override.",
  )
  expect(markdownPreview("Use [`sessionRename`](https://example.com) with ~~old~~ new behavior.")).toBe(
    "Use sessionRename with old new behavior.",
  )
  expect(markdownPreview("![diagram](image.png) Review [the result][result].")).toBe("diagram Review the result.")
})

test("flattens block syntax and code without losing its content", () => {
  expect(markdownPreview("# Result\n\n- First item\n- Second `item`\n> Finished")).toBe(
    "Result First item Second item Finished",
  )
  expect(markdownPreview("```ts\nconst answer = 42\n```")).toBe("const answer = 42")
})

test("preserves literal asterisks, globs, and escaped punctuation", () => {
  expect(markdownPreview("Search **/*.ts, calculate 2 * 3, and keep \\*literal\\*. ")).toBe(
    "Search **/*.ts, calculate 2 * 3, and keep *literal*.",
  )
})
