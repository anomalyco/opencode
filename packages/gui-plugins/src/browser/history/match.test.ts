import { expect, test } from "bun:test"
import { markMatches, parseQuery } from "./match"
import { MAX_TITLE_LENGTH, MAX_URL_LENGTH, pageKey, pageTitle } from "./page"

test.each([
  // One row per page: the scheme, `www.` and a trailing slash do not make another page.
  ["http://example.com", "example.com"],
  ["https://www.example.com/", "example.com"],
  ["https://EXAMPLE.com/Docs/", "example.com/Docs"],
  ["https://example.com/docs?page=2#top", "example.com/docs?page=2#top"],
  ["http://localhost:3000/", "localhost:3000"],
  // Never kept: not a web page, credentials in the address, or too long.
  ["file:///home/me/notes.html", undefined],
  ["chrome://settings/", undefined],
  ["about:blank", undefined],
  ["javascript:alert(1)", undefined],
  ["workspace://ses_1/index.html", undefined],
  ["https://me:secret@example.com/", undefined],
  ["https://me@example.com/", undefined],
  ["not an address", undefined],
  [`https://example.com/${"a".repeat(MAX_URL_LENGTH - "https://example.com/".length)}`, `example.com/${"a".repeat(MAX_URL_LENGTH - "https://example.com/".length)}`],
  [`https://example.com/${"a".repeat(MAX_URL_LENGTH)}`, undefined],
])("the page of %p is %p", (url, key) => {
  expect(pageKey(url)).toBe(key)
})

test("a title is trimmed and cut without splitting a character", () => {
  expect(pageTitle("  Docs \n")).toBe("Docs")
  const cut = pageTitle(`${"a".repeat(MAX_TITLE_LENGTH - 1)}😀 tail`)
  expect(cut).toBe("a".repeat(MAX_TITLE_LENGTH - 1))
})

test.each([
  ["rune", ["rune"]],
  ["  Anom   RUNE ", ["anom", "rune"]],
  // People paste whole addresses: the scheme and `www.` are not what they search for.
  ["https://www.GitHub.com/anomalyco", ["github.com/anomalyco"]],
  ["https://", undefined],
  ["   ", undefined],
])("the words of %p are %p", (text, words) => {
  expect(parseQuery(text)?.words).toEqual(words)
})

test("the matched parts of every word are marked once, in the text's own case", () => {
  expect(markMatches("anomalyco/Rune-desktop", parseQuery("rune anom"))).toEqual([
    { text: "anom", match: true },
    { text: "alyco/", match: false },
    { text: "Rune", match: true },
    { text: "-desktop", match: false },
  ])
  // Words that match overlapping text mark it once.
  expect(markMatches("github", parseQuery("git thu"))).toEqual([
    { text: "githu", match: true },
    { text: "b", match: false },
  ])
  expect(markMatches("github", undefined)).toEqual([{ text: "github", match: false }])
})
