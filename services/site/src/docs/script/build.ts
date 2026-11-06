// Builds the docs into the site's built assets, after the site's `vite build` (script/build.ts):
// the docs' stylesheet, script and fonts, every page as HTML, every content page's Markdown twin,
// llms.txt and the sitemap, then the Pagefind search index. Then it checks every link between them,
// and that the pages load nothing from outside /v2 (production can route /v2 to this Worker before
// the rest of the domain, see cloudflare.config.ts).
//
// The pages render in a small server build of their own (render.tsx), outside the site's Worker
// bundle, which only serves the files (middleware.ts). On its own (CI, after `bun run generate`):
//
//   bun src/docs/script/build.ts [--mode dev|production] [--out <dir>]
import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { build } from "vite"
import solid from "vite-plugin-solid"
import { config } from "../../config"
import { base } from "../config"
import { docsHref, docsMarkdownHref } from "../lib/navigation"
import type { docsSlugs, renderDocsMarkdown, renderDocsPage, renderLlmsTxt, renderSitemap } from "../render"
import { docs } from "../vite"

const args = parseArgs({ options: { mode: { type: "string", default: "production" }, out: { type: "string" } } })
const mode = args.values.mode
if (mode !== "dev" && mode !== "production") throw new Error(`Unknown --mode ${mode}; use dev or production`)
const root = path.resolve(import.meta.dir, "../../..")
const output = path.resolve(root, args.values.out ?? ".output/public")
const cache = path.join(root, "node_modules/.cache/docs")
// llms.txt and the sitemap list the deployment's own URLs; pages keep production canonical links.
const site = new URL(mode === "dev" ? "https://dev.opencode.ai" : config.baseUrl)

await rm(cache, { recursive: true, force: true })

// The stylesheet, script and fonts, hashed under /v2/_build (immutable in public/_headers).
await build({
  configFile: false,
  root,
  base,
  publicDir: false,
  logLevel: "warn",
  build: {
    outDir: path.join(cache, "client"),
    assetsDir: "_build",
    manifest: true,
    rolldownOptions: { input: ["src/docs/client.ts", "src/docs/styles/global.css"] },
  },
})
await cp(path.join(cache, "client/_build"), path.join(output, base, "_build"), { recursive: true })
const manifest: Record<string, { file: string }> = await Bun.file(path.join(cache, "client/.vite/manifest.json")).json()
const assets = {
  stylesheet: base + manifest["src/docs/styles/global.css"].file,
  script: base + manifest["src/docs/client.ts"].file,
}

await build({
  configFile: false,
  root,
  logLevel: "warn",
  // Pages never hydrate, so no hydration markers.
  plugins: [docs(), solid({ ssr: true, solid: { hydratable: false } })],
  build: { ssr: "src/docs/render.tsx", outDir: path.join(cache, "render"), minify: false },
  ssr: { noExternal: true },
})
const render = (await import(path.join(cache, "render/render.js"))) as {
  docsSlugs: typeof docsSlugs
  renderDocsPage: typeof renderDocsPage
  renderDocsMarkdown: typeof renderDocsMarkdown
  renderLlmsTxt: typeof renderLlmsTxt
  renderSitemap: typeof renderSitemap
}

const write = (href: string, body: string) => Bun.write(path.join(output, href), body)
await Promise.all([
  ...render.docsSlugs.map(async (slug) => {
    const html = await render.renderDocsPage(slug, assets)
    if (html === undefined) throw new Error(`docs: ${slug} did not render`)
    await write(`${docsHref(slug).replace(/\/?$/, "/")}index.html`, html)
    const markdown = await render.renderDocsMarkdown(slug)
    if (markdown !== undefined) await write(docsMarkdownHref(slug), markdown)
  }),
  write(`${base}llms.txt`, render.renderLlmsTxt(site)),
  write(`${base}sitemap.xml`, render.renderSitemap(site)),
  // The logos, favicon and generated files the pages link (the site build has copied them already).
  cp(path.join(root, "public", base), path.join(output, base), { recursive: true }),
])

const pagefind = path.join(output, `${base}docs`)
await mkdir(pagefind, { recursive: true })
await Bun.$`${path.join(root, "node_modules/.bin/pagefind")} --site ${pagefind}`.quiet()
await checkAssetPrefix()
await Bun.$`bun ${path.join(import.meta.dir, "validate-links.ts")} ${output}`
console.log(`docs: built ${render.docsSlugs.length} pages (${mode})`)

/** Fails when a docs page, or a stylesheet it links, loads a file from outside /v2. */
async function checkAssetPrefix() {
  const origin = "https://opencode.local"
  const pages = await Array.fromAsync(new Bun.Glob(`${base.slice(1)}**/*.html`).scan({ cwd: output }))
  const found = new Map<string, string>()
  for (const page of pages) {
    const html = await Bun.file(path.join(output, page)).text()
    for (const tag of html.matchAll(/<(\w+)\b[^>]*>/g)) {
      const src = tag[0].match(/\ssrc="([^"]+)"/)?.[1]
      const href =
        tag[1] === "link" && !/\srel="canonical"/.test(tag[0]) ? tag[0].match(/\shref="([^"]+)"/)?.[1] : undefined
      for (const url of [src, href]) if (url) found.set(new URL(url, `${origin}/${page}`).href, page)
    }
  }
  for (const style of [...found.keys()].filter((url) => url.endsWith(".css") && url.startsWith(origin))) {
    const pathname = new URL(style).pathname
    const css = await Bun.file(path.join(output, pathname)).text()
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g))
      if (!match[1].startsWith("data:")) found.set(new URL(match[1], style).href, pathname)
  }
  const outside = [...found].filter(([url]) => !url.startsWith(origin + base))
  if (!outside.length) return
  throw new Error(
    `docs: these files load from outside ${base}:\n${outside.map(([url, from]) => `  ${url.replace(origin, "")} (from ${from})`).join("\n")}`,
  )
}
