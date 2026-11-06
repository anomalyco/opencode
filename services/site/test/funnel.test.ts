import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import type { Element, Root } from "hast"
// SolidStart's own file router, as in sitemap.test.ts: every page route the app serves.
import { DEFAULT_EXTENSIONS } from "../node_modules/@solidjs/start/dist/config/constants.js"
import { SolidStartServerFileRouter } from "../node_modules/@solidjs/start/dist/config/fs-router.js"
import { docsHref, docsSections } from "~/docs/lib/navigation"
import rehypeShiki from "~/docs/rehype-shiki"
import { downloadOf, surfaceOf, targetOf } from "~/lib/funnel-config"
import { LOCALES, route, strip } from "~/lib/language"

const router = new SolidStartServerFileRouter({
  dir: fileURLToPath(new URL("../src/routes", import.meta.url)),
  extensions: DEFAULT_EXTENSIONS,
})
const manifest: { path: string; page?: boolean }[] = await router.getRoutes()
const routes = manifest.filter((item) => item.page).map((item) => item.path)
// A sample address for each route, its parameters filled in.
const sample = (path: string) =>
  path
    .replace("*404", "no-such-page")
    .replace(":tag", "v1.14.40")
    .replace(/(.)\/$/, "$1")

// The surface each page route reports as. A new page fails here until it's given one, so a report never
// lumps it in with "www-other" by accident.
const surfaces: Record<string, string | undefined> = {
  "/": "www-home",
  "/brand": "www-brand",
  "/changelog": "www-changelog",
  "/changelog/v1.14.40": "www-changelog",
  "/desktop": "www-desktop",
  "/devices": undefined,
  "/extensions/browse": "www-extensions",
  "/font": "www-font",
  "/ide": "www-ide",
  "/legal": "www-legal",
  "/legal/privacy-policy": "www-legal",
  "/legal/terms-of-service": "www-legal",
  "/mini": "www-mini",
  "/mobile": "www-mobile",
  "/no-such-page": "www-other",
  "/press": "www-press",
  "/product": "www-product",
  "/sdk": "www-sdk",
  "/terminal": "www-terminal",
  "/video-editor": undefined,
}

describe("funnel config", () => {
  test("names every page route's surface", () => {
    expect(Object.fromEntries(routes.map(sample).map((path) => [path, surfaceOf(path)]))).toEqual(surfaces)
  })

  test("reports a page the same in every language, by its path without the locale", () => {
    for (const locale of LOCALES)
      for (const path of routes.map(sample)) expect(surfaceOf(strip(route(locale, path)))).toBe(surfaces[path])
    expect(strip("/ja/desktop")).toBe("/desktop")
    expect(targetOf(strip("/zh/extensions/browse"))).toBe("browse")
  })

  test("reports every docs page as www-docs, targeting its section", () => {
    const slugs = docsSections.flatMap((section) =>
      section.groups.flatMap((group) => group.items.map((item) => item.slug)),
    )
    expect(slugs.length).toBeGreaterThan(20)
    for (const slug of slugs) {
      const path = docsHref(slug)
      expect(surfaceOf(strip(path))).toBe("www-docs")
      expect(targetOf(path)).toBe(slug === "index" ? "" : slug.split("/")[0])
    }
    expect([surfaceOf("/docs/"), targetOf("/docs/cli/keybinds/")]).toEqual(["www-docs", "cli"])
  })

  test("leaves the development tools out", () => {
    for (const path of ["/dev", "/dev/components", "/dev/404", "/devices", "/video-editor"])
      expect(surfaceOf(strip(`/ja${path}`))).toBeUndefined()
  })

  test("targets a release, an extension or a legal document, as a slug the API accepts", () => {
    expect(targetOf("/changelog/v1.14.40")).toBe("v1.14.40")
    expect(targetOf("/changelog")).toBe("")
    expect(targetOf("/legal/privacy-policy")).toBe("privacy-policy")
    expect(targetOf("/")).toBe("")
    expect(targetOf("/product")).toBe("")
    expect(targetOf("/no-such-page")).toBe("")
    expect(targetOf("/changelog/v1%20<b>")).toBe("v1-20-b-")
  })

  test("names downloads by what they are", () => {
    expect(
      downloadOf(new URL("https://opencode.ai/update/api/latest/desktop/opencode/opencode-desktop-mac-arm64.dmg")),
    ).toEqual({
      target: "desktop",
      properties: { file: "opencode-desktop-mac-arm64.dmg", channel: "latest", os_match: expect.any(Boolean) },
    })
    expect(downloadOf(new URL("https://opencode.ai/update/api/beta/cli/opencode/opencode-linux-x64.tar.gz"))).toEqual({
      target: "cli",
      properties: { file: "opencode-linux-x64.tar.gz", channel: "beta", os_match: expect.any(Boolean) },
    })
    expect(downloadOf(new URL("https://testflight.apple.com/join/M9eFEE1q"))).toEqual({
      target: "mobile",
      properties: { file: "testflight.apple.com" },
    })
    expect(downloadOf(new URL("https://marketplace.visualstudio.com/items?itemName=sst-dev.opencode"))?.target).toBe(
      "ide",
    )
    expect(downloadOf(new URL("https://open-vsx.org/extension/sst-dev/opencode"))?.target).toBe("ide")
    expect(downloadOf(new URL("https://github.com/anomalyco/opencode/releases"))).toBeUndefined()
    expect(downloadOf(new URL("https://example.com/update/api/latest/desktop/opencode/x.dmg"))).toBeUndefined()
  })
})

describe("funnel markup", () => {
  test("docs code blocks are copy regions, named by their language", async () => {
    const code: Element = {
      type: "element",
      tagName: "code",
      properties: { className: ["language-bash"] },
      children: [{ type: "text", value: "npm i -g opencode" }],
    }
    const tree: Root = {
      type: "root",
      children: [{ type: "element", tagName: "pre", properties: {}, children: [code] }],
    }
    await rehypeShiki()(tree)
    const pre = tree.children[0] as Element
    expect(pre.tagName).toBe("pre")
    expect(pre.properties).toMatchObject({ dataFunnelCopy: "snippet", dataFunnelMethod: "bash" })
  })

  // The components only render on the server, through Vite's Solid compiler, so their markup is read from source.
  const source = (path: string) => Bun.file(new URL(`../src/${path}`, import.meta.url)).text()

  test("install rows, copy buttons and tabs carry their funnel names", async () => {
    const marks: Record<string, RegExp[]> = {
      "component/site/download-sections.tsx": [
        /<li data-slot="copy-row" data-funnel-copy=\{props\.copies\} data-funnel-method=\{props\.item\.id\} data-funnel="copy">/,
        /copies="terminal"/,
        /copies="desktop"/,
        /copies=\{props\.slug\}/,
      ],
      "component/site/products.tsx": [
        /data-funnel-copy="terminal"\s+data-funnel-method=\{item\.id\}\s+onClick=\{\(\) => copy\(item\)\}/,
        /data-funnel=\{`install-tab:\$\{item\.id\}`\}/,
        /data-funnel-copy="terminal"\s+data-funnel-method=\{installs\[selected\(\)\]\.id\}/,
      ],
      "component/site/code-frame.tsx": [/data-funnel-copy="snippet"/],
      "component/site/markdown-view.tsx": [/data-funnel-copy="page-markdown"/],
      "component/site/legal.tsx": [/data-funnel-copy="page-markdown"/],
      "component/site/site.tsx": [/data-funnel=\{markdown\(\) \? "markdown-view:off" : "markdown-view:on"\}/],
      "component/site/arcade3d/not-found-page.tsx": [/data-funnel-surface="www-404"/],
      "docs/components/CodeBlock.tsx": [/class="docs-code-block" data-funnel-copy="snippet"/],
      "docs/components/CodeTabs.tsx": [/data-funnel=\{`code-tab:\$\{tab\.label\}`\}/],
      "docs/components/PlanTabs.tsx": [/data-funnel=\{`plan-tab:\$\{plan\.id\}`\}/],
      "docs/layouts/DocsLayout.tsx": [/data-copy-markdown\s+data-funnel-copy="page-markdown"/],
    }
    for (const [path, patterns] of Object.entries(marks)) {
      const text = await source(path)
      for (const pattern of patterns) expect({ path, found: pattern.test(text) }).toEqual({ path, found: true })
    }
  })

  test("the site's and the docs' first JavaScript start the tracker through the stub", async () => {
    const start = 'Funnel.start(() => import("~/lib/funnel-config").then((module) => module.funnelConfig()))'
    expect(await source("entry-client.tsx")).toContain(start)
    expect(await source("docs/client.ts")).toContain(
      'Funnel.start(async () => ({ surfaceOf, targetOf, localeOf: () => "en", base: "", downloadOf }))',
    )
    // The stub imports nothing, so the config and the tracker stay out of every page's first JavaScript.
    expect(await source("lib/funnel.ts")).not.toMatch(/^import /m)
  })
})
