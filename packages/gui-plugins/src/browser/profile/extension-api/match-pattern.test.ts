import { expect, test } from "bun:test"
import { globMatch, matchesHost } from "./match-pattern"

test.each([
  { patterns: ["<all_urls>"], url: "https://example.com/a", expected: true },
  { patterns: ["<all_urls>"], url: "chrome-extension://abc/page.html", expected: false },
  { patterns: ["*://*/*"], url: "http://localhost:3000/x?y=1", expected: true },
  { patterns: ["*://*/*"], url: "file:///C:/repo/index.html", expected: false },
  { patterns: ["https://*.github.com/*"], url: "https://github.com/", expected: true },
  { patterns: ["https://*.github.com/*"], url: "https://api.github.com/repos", expected: true },
  { patterns: ["https://*.github.com/*"], url: "https://evilgithub.com/", expected: false },
  { patterns: ["https://example.com/docs/*"], url: "https://example.com/blog", expected: false },
  { patterns: ["not a pattern"], url: "https://example.com/", expected: false },
  { patterns: ["http://localhost:3000/*"], url: "http://localhost:3000/app", expected: true },
  { patterns: ["http://localhost:3000/*"], url: "http://localhost:4000/app", expected: false },
  { patterns: ["http://localhost/*"], url: "http://localhost:4000/app", expected: true },
])("$patterns matches $url: $expected", (row) => {
  expect(matchesHost(row.patterns, row.url)).toBe(row.expected)
})

test("a glob from an extension matches in bounded time, whatever its stars", () => {
  expect(globMatch("Ex*", "Example")).toBe(true)
  expect(globMatch("*am*e", "Example")).toBe(true)
  expect(globMatch("a.b", "axb")).toBe(false)
  expect(globMatch("", "")).toBe(true)
  // Exponential for a backtracking regex; here a few million steps at most.
  expect(globMatch(`${"*a".repeat(40)}*b`, "a".repeat(5000))).toBe(false)
})
