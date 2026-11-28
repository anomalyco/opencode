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
const page = (slug: string, markdown = false, locale: "en" | "zh" | "ar" | "ja" = "en") => ({
  type: "page" as const,
  set: latestDocs,
  slug,
  locale,
  markdown,
  twin: slug !== "api",
})

describe("docs routes", () => {
  test("serve V2 pages at /docs, with or without the trailing slash", () => {
    for (const path of ["/docs", "/docs/", "/docs/index"]) expect(route(path)).toEqual(page("index"))
    expect(route("/docs/cli/keybinds/")).toEqual(page("cli/keybinds"))
    expect(route("/docs/cli/keybinds")).toEqual(page("cli/keybinds"))
  })

  test("serve a page's Markdown twin at its .md URL and to clients that ask for Markdown", () => {
    expect(route("/docs/config.md")).toEqual(page("config", true))
    expect(route("/docs/config/", "text/markdown")).toEqual(page("config", true))
    for (const path of ["/docs.md", "/docs/index.md"]) expect(route(path)).toEqual(page("index", true))
  })

  test("serve the API reference as a file without a twin, at its one URL", () => {
    expect(route("/docs/api")).toEqual(page("api"))
    expect(route("/docs/api/")).toEqual({ type: "redirect", location: "/docs/api", status: 307 })
    expect(route("/docs/api.md")).toEqual({ type: "missing" })
  })

  test("serve the latest docs' other languages under the site's prefix", () => {
    for (const path of ["/zh/docs", "/zh/docs/", "/zh/docs/index"])
      expect(route(path)).toEqual(page("index", false, "zh"))
    expect(route("/zh/docs/config/")).toEqual(page("config", false, "zh"))
    expect(route("/ar/docs/")).toEqual(page("index", false, "ar"))
    expect(route("/zh/docs/config.md")).toEqual(page("config", true, "zh"))
    expect(route("/zh/docs/config/", "text/markdown")).toEqual(page("config", true, "zh"))
    expect(route("/zh/docs/api/")).toEqual({ type: "redirect", location: "/zh/docs/api", status: 307 })
  })

  test("send English's prefixed address to the unprefixed one", () => {
    for (const path of ["/en/docs/", "/en/docs/config/", "/en/docs/config.md"])
      expect(route(path)).toEqual({ type: "redirect", location: path.slice("/en".length), status: 301 })
  })

  test("leave the V1 docs unprefixed", () => {
    for (const path of ["/zh/v1/docs/ide/", "/ja/v1/docs/"]) expect(route(path)).toBeUndefined()
  })

  test("send paths without a V2 page to the same path on the V1 docs, temporarily", () => {
    for (const path of ["/docs/ja/", "/docs/ja/agents/", "/docs/zh-cn/config", "/docs/ide/", "/docs/lsp.md"])
      expect(route(path)).toEqual({ type: "redirect", location: `/v1/docs${path.slice("/docs".length)}`, status: 302 })
    expect(route("/docs/ide/?ref=app")).toEqual({ type: "redirect", location: "/v1/docs/ide/?ref=app", status: 302 })
  })

  test("send a missing page in a language to the V1 docs in that language", () => {
    expect(route("/zh/docs/ide")).toEqual({ type: "redirect", location: "/v1/docs/zh-cn/ide", status: 302 })
    expect(route("/zht/docs/ide/")).toEqual({ type: "redirect", location: "/v1/docs/zh-tw/ide/", status: 302 })
    expect(route("/uk/docs/ide")).toEqual({ type: "redirect", location: "/v1/docs/ide", status: 302 })
    expect(route("/zh/docs/nope.md")).toEqual({ type: "redirect", location: "/v1/docs/zh-cn/nope.md", status: 302 })
  })

  test("move pages that moved, in the page's language too", () => {
    expect(route("/docs/console/inference/")).toEqual({
      type: "redirect",
      location: "/docs/console/api/inference/",
      status: 301,
    })
    expect(route("/docs/go")).toEqual({ type: "redirect", location: "/docs/console/go/", status: 301 })
    expect(route("/docs/zen/")).toEqual({ type: "redirect", location: "/docs/console/models/", status: 301 })
    expect(route("/docs/rules/")).toEqual({ type: "redirect", location: "/docs/instructions/", status: 301 })
    expect(route("/docs/sdk")).toEqual({ type: "redirect", location: "/docs/build/sdk/", status: 301 })
    expect(route("/docs/server/")).toEqual({ type: "redirect", location: "/docs/api", status: 301 })
    expect(route("/zh/docs/go")).toEqual({ type: "redirect", location: "/zh/docs/console/go/", status: 301 })
  })

  test("leave the docs' own files to the assets, never to the V1 docs", () => {
    for (const path of ["/docs/_build/old.css", "/docs/pagefind/pagefind.js", "/docs/assets/x.png", "/docs/llms.txt"])
      expect(route(path)).toEqual({ type: "file", set: latestDocs, path: path.slice("/docs".length) })
    expect(route("/zh/docs/pagefind/pagefind.js")).toEqual({
      type: "file",
      set: latestDocs,
      path: "/pagefind/pagefind.js",
    })
  })

  test("ignore everything outside the docs", () => {
    for (const path of ["/", "/docsx", "/v2/docs/config/", "/v1/docsx", "/ja/v1/docs/ide/"])
      expect(route(path)).toBeUndefined()
  })
})

describe("V1 docs routes", () => {
  const v1 = (slug: string, markdown = false) => ({
    type: "page" as const,
    set: v1Docs,
    slug,
    locale: "en" as const,
    markdown,
    twin: true,
  })
  const moved = (path: string, location: string, status = 301) =>
    expect(route(path)).toEqual({ type: "redirect", location, status })

  test("serve V1 pages at /v1/docs, in English and in their languages, with their Markdown twins", () => {
    for (const path of ["/v1/docs", "/v1/docs/"]) expect(route(path)).toEqual(v1("index"))
    expect(route("/v1/docs/ide/")).toEqual(v1("ide"))
    expect(route("/v1/docs/ja/")).toEqual(v1("ja"))
    expect(route("/v1/docs/ja/config")).toEqual(v1("ja/config"))
    expect(route("/v1/docs/ja/policies/")).toEqual(v1("ja/policies"))
    expect(route("/v1/docs.md")).toEqual(v1("index", true))
    expect(route("/v1/docs/ja.md")).toEqual(v1("ja", true))
    expect(route("/v1/docs/config/", "text/markdown")).toEqual(v1("config", true))
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

  test("send docs.opencode.ai's addresses to the same path under /docs", () => {
    const host = (url: string) => docsHostRedirect(new URL(url))
    expect(host("https://docs.opencode.ai/")).toBe("https://opencode.ai/docs/")
    expect(host("https://docs.opencode.ai/docs")).toBe("https://opencode.ai/docs/")
    expect(host("https://docs.opencode.ai/docs/ide/?x=1")).toBe("https://opencode.ai/docs/ide/?x=1")
    expect(host("https://docs.opencode.ai/s/abc")).toBe("https://opencode.ai/docs/s/abc")
    expect(host("https://docs.dev.opencode.ai/docs/ja/")).toBe("https://dev.opencode.ai/docs/ja/")
    expect(host("https://opencode.ai/docs/")).toBeUndefined()
  })
})
