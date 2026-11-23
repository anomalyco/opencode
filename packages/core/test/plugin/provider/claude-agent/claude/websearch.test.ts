import { expect, test } from "bun:test"
import { ClaudeWebSearch } from "@opencode/core/plugin/provider/claude-agent/claude/websearch"

test("web search lists one copy of a page, in the first copy's place, under its shortest URL", () => {
  const urls = [
    "https://nodejs.org/es/blog/release/v26.0.0",
    "https://other.example/x",
    "https://nodejs.org/blog/release/v26.0.0",
    "https://nodejs.org/pt-br/blog/release/v26.0.0",
    "https://developer.chrome.com/docs/x?authuser=2",
    "https://developer.chrome.com/docs/x.md.txt",
    "https://developer.chrome.com/docs/x?hl=en",
    "https://developer.chrome.com/docs/y",
    "https://github.com/go/example",
    "https://github.com/js/example",
  ]
  const found = ClaudeWebSearch.results({
    type: "user",
    message: { role: "user", content: [] },
    parent_tool_use_id: null,
    tool_use_result: { results: [{ content: urls.map((url) => ({ title: url, url })) }] },
  })
  expect(found?.map((result) => result.url)).toEqual([
    "https://nodejs.org/blog/release/v26.0.0",
    "https://other.example/x",
    "https://developer.chrome.com/docs/x?hl=en",
    "https://developer.chrome.com/docs/y",
    "https://github.com/go/example",
    "https://github.com/js/example",
  ])
})
