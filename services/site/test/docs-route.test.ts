import { describe, expect, test } from "bun:test"
import { latestDocs, v1Docs } from "../src/docs/config"
import { docsHostRedirect, docsRoute } from "../src/docs/route"

// Slugs as `virtual:docs-pages` lists them (src/docs/vite.ts): content paths, plus the API reference.
const slugs = {
  latest: ["index", "config", "cli", "cli/keybinds", "console/api/inference", "console/go", "console/models", "api"],
  v1: [
    "index",
    "config",
    "ide",
    "policies",
    "ja",
    "ja/config",
    "ja/ide",
    "ja/policies",
    "zh-cn/config",
    "pt-br",
    "nb/config",
  ],
}
const route = (path: string, accept = "text/html") => docsRoute(new URL(path, "https://opencode.ai"), accept, slugs)

describe("docs routes", () => {
  test("serve V2 pages at /docs, with or without the trailing slash", () => {
    for (const path of ["/docs", "/docs/", "/docs/index"])
      expect(route(path)).toEqual({ type: "page", set: latestDocs, slug: "index", markdown: false, twin: true })
    expect(route("/docs/cli/keybinds/")).toEqual({
      type: "page",
      set: latestDocs,
      slug: "cli/keybinds",
      markdown: false,
      twin: true,
    })
    expect(route("/docs/cli/keybinds")).toEqual({
      type: "page",
      set: latestDocs,
      slug: "cli/keybinds",
      markdown: false,
      twin: true,
    })
  })

  test("serve a page's Markdown twin at its .md URL and to clients that ask for Markdown", () => {
    expect(route("/docs/config.md")).toEqual({
      type: "page",
      set: latestDocs,
      slug: "config",
      markdown: true,
      twin: true,
    })
    expect(route("/docs/config/", "text/markdown")).toEqual({
      type: "page",
      set: latestDocs,
      slug: "config",
      markdown: true,
      twin: true,
    })
    for (const path of ["/docs.md", "/docs/index.md"])
      expect(route(path)).toEqual({ type: "page", set: latestDocs, slug: "index", markdown: true, twin: true })
  })

  test("serve the API reference as a file without a twin, at its one URL", () => {
    expect(route("/docs/api")).toEqual({ type: "page", set: latestDocs, slug: "api", markdown: false, twin: false })
    expect(route("/docs/api/")).toEqual({ type: "redirect", location: "/docs/api", status: 307 })
    expect(route("/docs/api.md")).toEqual({ type: "missing" })
  })

  test("send paths without a V2 page to the same path on the V1 docs, temporarily", () => {
    for (const path of ["/docs/ja/", "/docs/ja/agents/", "/docs/zh-cn/config", "/docs/ide/", "/docs/sdk.md"])
      expect(route(path)).toEqual({ type: "redirect", location: `/v1/docs${path.slice("/docs".length)}`, status: 302 })
    expect(route("/docs/ide/?ref=app")).toEqual({ type: "redirect", location: "/v1/docs/ide/?ref=app", status: 302 })
  })

  test("move pages that moved", () => {
    expect(route("/docs/console/inference/")).toEqual({
      type: "redirect",
      location: "/docs/console/api/inference/",
      status: 301,
    })
    expect(route("/docs/go")).toEqual({ type: "redirect", location: "/docs/console/go/", status: 301 })
    expect(route("/docs/zen/")).toEqual({ type: "redirect", location: "/docs/console/models/", status: 301 })
  })

  test("leave the docs' own files to the assets, never to the V1 docs", () => {
    for (const path of ["/docs/_build/old.css", "/docs/pagefind/pagefind.js", "/docs/assets/x.png", "/docs/llms.txt"])
      expect(route(path)).toEqual({ type: "file", set: latestDocs, path: path.slice("/docs".length) })
  })

  test("ignore everything outside the docs", () => {
    for (const path of ["/", "/docsx", "/v2/docs/config/", "/v1/docsx", "/ja/docs/", "/ja/v1/docs/ide/"])
      expect(route(path)).toBeUndefined()
  })
})

describe("V1 docs routes", () => {
  const page = (slug: string, markdown = false) => ({ type: "page" as const, set: v1Docs, slug, markdown, twin: true })
  const moved = (path: string, location: string, status = 301) =>
    expect(route(path)).toEqual({ type: "redirect", location, status })

  test("serve V1 pages at /v1/docs, in English and in their languages, with their Markdown twins", () => {
    for (const path of ["/v1/docs", "/v1/docs/"]) expect(route(path)).toEqual(page("index"))
    expect(route("/v1/docs/ide/")).toEqual(page("ide"))
    expect(route("/v1/docs/ja/")).toEqual(page("ja"))
    expect(route("/v1/docs/ja/config")).toEqual(page("ja/config"))
    expect(route("/v1/docs/ja/policies/")).toEqual(page("ja/policies"))
    expect(route("/v1/docs.md")).toEqual(page("index", true))
    expect(route("/v1/docs/ja.md")).toEqual(page("ja", true))
    expect(route("/v1/docs/config/", "text/markdown")).toEqual(page("config", true))
    expect(route("/v1/docs/llms.txt")).toEqual({ type: "file", set: v1Docs, path: "/llms.txt" })
  })

  test("send the V1 app's other names for its languages to theirs, permanently", () => {
    moved("/v1/docs/zh/config/", "/v1/docs/zh-cn/config/")
    moved("/v1/docs/ZH-CN/config", "/v1/docs/zh-cn/config/")
    moved("/v1/docs/br/", "/v1/docs/pt-br/")
    moved("/v1/docs/no/config.md", "/v1/docs/nb/config.md")
    moved("/v1/docs/en/ide/?ref=app", "/v1/docs/ide/?ref=app")
    moved("/v1/docs/uk/", "/v1/docs/")
  })

  test("send Go and Zen, share links and the schemas where they live", () => {
    moved("/v1/docs/go", "/docs/console/go/")
    moved("/v1/docs/ja/zen/", "/docs/console/models/")
    moved("/v1/docs/s/abc123", "https://opncd.ai/share/abc123")
    moved("/v1/docs/config.json", "/config.json")
  })

  test("answer a missing V1 page with a 404, never another redirect", () => {
    for (const path of ["/v1/docs/nope/", "/v1/docs/ja/nope", "/v1/docs/api"])
      expect(route(path)).toEqual({ type: "missing" })
  })

  test("send docs.opencode.ai's addresses to the same path on the V1 docs", () => {
    const host = (url: string) => docsHostRedirect(new URL(url))
    expect(host("https://docs.opencode.ai/")).toBe("https://opencode.ai/v1/docs/")
    expect(host("https://docs.opencode.ai/docs")).toBe("https://opencode.ai/v1/docs/")
    expect(host("https://docs.opencode.ai/docs/ide/?x=1")).toBe("https://opencode.ai/v1/docs/ide/?x=1")
    expect(host("https://docs.opencode.ai/s/abc")).toBe("https://opencode.ai/v1/docs/s/abc")
    expect(host("https://docs.dev.opencode.ai/docs/ja/")).toBe("https://dev.opencode.ai/v1/docs/ja/")
    expect(host("https://opencode.ai/docs/")).toBeUndefined()
  })
})
