import { expect, test } from "bun:test"
import { addressParts, externalAction, externalPage, pageHandoff, resolveAddress } from "./address"
import { completion, filled } from "./history/page"
import { suggestPages } from "./history/suggest"
import { remember } from "./history/visits"
import { normalizeURL, refusal } from "./policy"

test("typed file paths never become a host or a search query, regardless of the desktop OS", () => {
  const policy = { fileRoots: ["/work/repo"], home: "/work" }

  for (const input of ["C:\\Users\\fixture\\x", "C:/Users/fixture/x", "\\\\server\\share\\x", "/other/x", "~/other/x", "../other/x", "file:/other/x"])
    expect(refusal(resolveAddress(input), policy)).toBe("browser.address.workspace")

  for (const input of ["./index.html", "~/repo/index.html", "/work/repo/index.html", "file:/work/repo/index.html"])
    expect(normalizeURL(resolveAddress(input), policy)).toBe("file:///work/repo/index.html")

  for (const [input, destination] of [["localhost:3000", "http://localhost:3000"], ["example.com/path", "https://example.com/path"], ["c.com", "https://c.com"], ["//example.com", "https://example.com"], ["find cats/dogs", "https://www.google.com/search?q=find%20cats%2Fdogs"]])
    expect(normalizeURL(resolveAddress(input), policy)).toBe(destination)
})

test("the address field navigates to what reads as an address and searches for anything else", () => {
  const search = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`

  expect(
    [
      "",
      "https://example.com/a b",
      "about:blank",
      "localhost:3000",
      "localhost",
      "[::1]:5173/app",
      "127.0.0.1:8080",
      "dev-box:4096/health",
      "developer.mozilla.org/en-US/docs",
      "mdn",
      "css grid gap",
      "localhost 3000",
      "ABOUT:BLANK",
      "file:///C:/repo/index.html",
      // A typed scheme is an address even where main refuses it, which then says why.
      "file://server/share/x.html",
      "ftp://example.com",
      "about:config",
      // Text that is no URL searches: no host, a space in it, or a host main would not open as a web page.
      "https://",
      "http:// foo",
      "about: the movie",
      "user@example.com",
      ":8080",
      "error: cannot find module",
    ].map(resolveAddress),
  ).toEqual([
    "about:blank",
    "https://example.com/a b",
    "about:blank",
    "localhost:3000",
    "localhost",
    "[::1]:5173/app",
    "127.0.0.1:8080",
    "dev-box:4096/health",
    "developer.mozilla.org/en-US/docs",
    search("mdn"),
    search("css grid gap"),
    search("localhost 3000"),
    "about:blank",
    "file:///C:/repo/index.html",
    "file://server/share/x.html",
    "ftp://example.com",
    "about:config",
    search("https://"),
    search("http:// foo"),
    search("about: the movie"),
    search("user@example.com"),
    search(":8080"),
    search("error: cannot find module"),
  ])
})

test("the field draws the whole URL, split around its host, in exactly the input's characters", () => {
  const urls = [
    "https://developer.mozilla.org/en-US/docs/Web?q=1#top",
    "http://localhost:5173/",
    "https://alpha.example",
    "file:///C:/repo/out/index.html",
    "HTTPS://Example.COM/%7Euser",
  ]

  expect(urls.map(addressParts)).toEqual([
    { scheme: "https://", host: "developer.mozilla.org", rest: "/en-US/docs/Web?q=1#top" },
    { scheme: "http://", host: "localhost:5173", rest: "/" },
    { scheme: "https://", host: "alpha.example", rest: "" },
    { scheme: "file://", host: "", rest: "/C:/repo/out/index.html" },
    { scheme: "HTTPS://", host: "Example.COM", rest: "/%7Euser" },
  ])
  expect(urls.map((url) => Object.values(addressParts(url)).join(""))).toEqual(urls)
})

test("the window's list keeps one newest-first visit per URL and, alone, suggests its matches newest first", () => {
  const visits = ["https://docs.example/mdn-guide", "https://developer.mozilla.org/", "https://www.mdn.dev/"].reduce(
    (list, url) => remember(list, { url, title: url.includes("mozilla") ? "MDN Web Docs" : "Other" }),
    remember([], { url: "https://developer.mozilla.org/", title: "Old title" }),
  )

  expect(visits.map((visit) => [visit.url, visit.title])).toEqual([
    ["https://www.mdn.dev/", "Other"],
    ["https://developer.mozilla.org/", "MDN Web Docs"],
    ["https://docs.example/mdn-guide", "Other"],
  ])
  // A leading www. and the scheme are not typed, so mdn completes www.mdn.dev; the others have it as a word of the
  // title or a part of the path.
  expect(suggestPages("MDN", visits, [], 5).map((visit) => [visit.url, visit.completion])).toEqual([
    ["https://www.mdn.dev/", ".dev"],
    ["https://developer.mozilla.org/", undefined],
    ["https://docs.example/mdn-guide", undefined],
  ])
  // A word found only inside a longer one comes after every word start, however new its page.
  expect(suggestPages("ozilla", visits, [], 5).map((visit) => visit.url)).toEqual(["https://developer.mozilla.org/"])
  expect(suggestPages("d", visits, [], 5).map((visit) => visit.url)).toEqual([
    "https://www.mdn.dev/",
    "https://developer.mozilla.org/",
    "https://docs.example/mdn-guide",
  ])
  expect(suggestPages("  ", visits, [], 5)).toEqual([])
  expect(
    Array.from({ length: 40 }, (_, index) => `https://example.com/${index}`).reduce(
      (list, url) => remember(list, { url, title: "" }),
      visits,
    ),
  ).toHaveLength(30)
})

test("an address completes the typed text and fills the field as Chrome's address bar does", () => {
  const rune = "https://github.com/anomalyco/rune-desktop"

  // The text may leave out the scheme and a leading www., in any case; a text that is not the start completes nothing.
  const completions: readonly (readonly [text: string, url: string, rest: string | undefined])[] = [
    ["gith", "https://github.com/", "ub.com"],
    ["GitH", "https://github.com/", "ub.com"],
    ["https://gith", "https://github.com/", "ub.com"],
    ["md", "https://www.mdn.dev/", "n.dev"],
    ["www.md", "https://www.mdn.dev/", "n.dev"],
    ["github.com/anom", rune, "alyco/rune-desktop"],
    // The whole address, with or without the slash that ends a bare host.
    ["github.com", "https://github.com/", ""],
    ["github.com/", "https://github.com/", ""],
    ["hub", "https://github.com/", undefined],
    ["gith ", "https://github.com/", undefined],
    ["", "https://github.com/", undefined],
  ]

  expect(completions.map(([text, url]) => completion(text, url))).toEqual(completions.map(([, , rest]) => rest))
  // A row's address in the field: https stays, http and the slash after a bare host go.
  expect(["https://github.com/", rune, "http://localhost:3000/", "http://example.com/a/?b#c", "file:///C:/repo/index.html"].map(filled)).toEqual([
    "https://github.com",
    rune,
    "localhost:3000",
    "example.com/a/?b#c",
    "file:///C:/repo/index.html",
  ])
})

test("a local preview may be revealed by tab ID but never launched by URL", () => {
  for (const suffix of ["html", "exe", "bat", "cmd", "lnk", "ps1", "app"]) {
    expect(externalAction(`file:///repo/test.${suffix}`, true)).toBe("reveal")
    expect(externalAction(`file:///repo/test.${suffix}`, false)).toBeUndefined()
  }

  expect(externalAction("https://example.org", false)).toBe("browser")
  expect(externalAction("oc-preview://other/repo/x", true)).toBeUndefined()
})

test("only a main-reported HTTP(S) failure can be handed off without a matching committed document", () => {
  const web = "https://localhost:4000/"
  const file = "file:///work/report.html"
  const preview = "oc-preview://grant/work/report.html"
  expect(pageHandoff("chrome-error://chromewebdata/", "about:blank", web, true, true)).toEqual({ kind: "web", url: web })
  expect(pageHandoff(web, web, "https://other.invalid/", false, true)).toBeUndefined()
  expect(pageHandoff(preview, file, file, true, true)).toBeUndefined()
  expect(pageHandoff(preview, file, file, false, true)).toEqual({ kind: "preview", url: file })
  expect(pageHandoff(file, file, file, false, true)).toBeUndefined()
})

test.each([
  ["https://example.org/page", false, true],
  ["http://localhost:4000", true, true],
  ["http://localhost:4000", false, false],
  ["http://localhost.:4000", false, false],
  ["http://foo.localhost.:4000", false, false],
  ["http://0.0.0.0:4000", false, false],
  ["http://[::]:4000", false, false],
  ["http://[::ffff:127.0.0.1]:4000", false, false],
  ["http://[::ffff:126.0.0.1]:4000", false, true],
  ["file:///work/report.HTM#view", true, true],
  ["file:///work/report.html.exe", true, false],
  ["file:///work/report.html", false, false],
  ["workspace://session/report.html", true, false],
  ["artifact://item/report.html", true, false],
  ["oc-preview://unknown/report.html", true, false],
  ["mailto:hello@example.org", true, false],
] as const)("the current page %s on this machine %s offers a hand-off: %s", (url, local, open) => {
  expect(externalPage(url, local)).toBe(open)
})
