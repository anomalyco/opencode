import { describe, expect, test } from "bun:test"
import { splitStreamingMarkdown } from "../../../src/cli/cmd/tui/routes/session/streaming-markdown"

describe("splitStreamingMarkdown", () => {
  test("keeps settled markdown intact when no trailing code fence remains", () => {
    const text = "Intro\n\n```ts\nconst x = 1\n```\n\nDone"
    expect(splitStreamingMarkdown(text)).toEqual({ head: text })
  })

  test("keeps a trailing closed fence isolated from settled head markdown", () => {
    expect(splitStreamingMarkdown("Intro\n\n```ts\nconst x = 1\n```\n")).toEqual({
      head: "Intro\n\n",
      tail: { content: "const x = 1\n", filetype: "typescript" },
    })
  })

  test("splits the trailing open fence from the settled head", () => {
    expect(splitStreamingMarkdown("Intro\n\n```python\nprint('hi')")).toEqual({
      head: "Intro\n\n",
      tail: { content: "print('hi')", filetype: "python" },
    })
  })

  test("supports fences without a language hint", () => {
    expect(splitStreamingMarkdown("```\nplain text")).toEqual({
      head: "",
      tail: { content: "plain text", filetype: "none" },
    })
  })

  test("normalizes common fence aliases for syntax highlighting", () => {
    expect(splitStreamingMarkdown("```bash\necho hi")).toEqual({
      head: "",
      tail: { content: "echo hi", filetype: "shellscript" },
    })
  })

  test("falls back to plain markdown when the trailing fence is not the last block", () => {
    const text = "```ts\nconst x = 1\n```\n\nDone"
    expect(splitStreamingMarkdown(text)).toEqual({ head: text })
  })
})
