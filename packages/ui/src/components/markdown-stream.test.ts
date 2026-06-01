import { describe, expect, test } from "bun:test"
import { stream } from "./markdown-stream"

describe("markdown stream", () => {
  test("heals incomplete emphasis while streaming", () => {
    expect(stream("hello **world", true)).toEqual([{ raw: "hello **world", src: "hello **world**", mode: "live" }])
    expect(stream("say `code", true)).toEqual([{ raw: "say `code", src: "say `code`", mode: "live" }])
  })

  test("keeps incomplete links non-clickable until they finish", () => {
    expect(stream("see [docs](https://example.com/gu", true)).toEqual([
      { raw: "see [docs](https://example.com/gu", src: "see docs", mode: "live" },
    ])
  })

  test("splits an unfinished trailing code fence from stable content", () => {
    expect(stream("before\n\n```ts\nconst x = 1", true)).toEqual([
      { raw: "before\n\n", src: "before\n\n", mode: "live" },
      { raw: "```ts\nconst x = 1", src: "```ts\nconst x = 1", mode: "live" },
    ])
  })

  test("heals incomplete backticks in trailing code fence tail", () => {
    expect(stream("summary\n\n```sh\nrm -rf `", true)).toEqual([
      { raw: "summary\n\n", src: "summary\n\n", mode: "live" },
      { raw: "```sh\nrm -rf `", src: "```sh\nrm -rf ``", mode: "live" },
    ])
  })

  test("handles backtick-heavy content that ends without trailing newline", () => {
    const input = "run `git status` and `git"
    const result = stream(input, true)
    expect(result[0].raw).toBe(input)
    expect(result[0].src).toContain("git status")
  })

  test("keeps reference-style markdown as one block", () => {
    expect(stream("[docs][1]\n\n[1]: https://example.com", true)).toEqual([
      {
        raw: "[docs][1]\n\n[1]: https://example.com",
        src: "[docs][1]\n\n[1]: https://example.com",
        mode: "live",
      },
    ])
  })
})
