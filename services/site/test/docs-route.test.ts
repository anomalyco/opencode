import { describe, expect, test } from "bun:test"
import { docsRoute } from "../src/docs/route"

// Slugs as `virtual:docs-pages` lists them (src/docs/vite.ts): content paths, plus the API reference.
const slugs = ["index", "config", "cli", "cli/keybinds", "console/api/inference", "console/go", "console/models", "api"]
const route = (path: string, accept = "text/html") => docsRoute(new URL(path, "https://opencode.ai"), accept, slugs)

describe("docs routes", () => {
  test("serve V2 pages at /docs, with or without the trailing slash", () => {
    for (const path of ["/docs", "/docs/", "/docs/index"])
      expect(route(path)).toEqual({ type: "page", slug: "index", markdown: false, twin: true })
    expect(route("/docs/cli/keybinds/")).toEqual({ type: "page", slug: "cli/keybinds", markdown: false, twin: true })
    expect(route("/docs/cli/keybinds")).toEqual({ type: "page", slug: "cli/keybinds", markdown: false, twin: true })
  })

  test("serve a page's Markdown twin at its .md URL and to clients that ask for Markdown", () => {
    expect(route("/docs/config.md")).toEqual({ type: "page", slug: "config", markdown: true, twin: true })
    expect(route("/docs/config/", "text/markdown")).toEqual({ type: "page", slug: "config", markdown: true, twin: true })
    for (const path of ["/docs.md", "/docs/index.md"])
      expect(route(path)).toEqual({ type: "page", slug: "index", markdown: true, twin: true })
  })

  test("serve the API reference as a file without a twin, at its one URL", () => {
    expect(route("/docs/api")).toEqual({ type: "page", slug: "api", markdown: false, twin: false })
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
      expect(route(path)).toEqual({ type: "file", path: path.slice("/docs".length) })
  })

  test("ignore everything outside /docs", () => {
    for (const path of ["/", "/docsx", "/v2/docs/config/", "/v1/docs/ide/", "/ja/docs/"]) expect(route(path)).toBeUndefined()
  })
})
