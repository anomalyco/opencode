import { expect, test } from "bun:test"
import { matchesHost } from "./match-pattern"

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
])("$patterns matches $url: $expected", (row) => {
  expect(matchesHost(row.patterns, row.url)).toBe(row.expected)
})
