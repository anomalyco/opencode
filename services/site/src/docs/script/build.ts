// Builds the docs into the site's built assets, after the site's `vite build` (script/build.ts):
// the docs' stylesheet, script and fonts, every page as HTML, every content page's Markdown twin,
// llms.txt and the sitemap, then the Pagefind search index. Then it checks every link between them,
// that the pages load nothing from outside /docs, and that no page takes the name of one of the docs'
// files (config.ts `files`).
//
// The pages render in a small server build of their own (render.tsx), outside the site's Worker
// bundle, which only serves the files (middleware.ts). The mode picks the restyle or the legacy pages
// (config.ts `restyled`). On its own (CI, after `bun run generate`):
//
//   bun src/docs/script/build.ts [--mode dev|production] [--out <dir>]
import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { build } from "vite"
import solid from "vite-plugin-solid"
import { cssVariantsForProduction, devOnlyCss } from "../../../script/css-variants-plugin"
import { foldSettingsForProduction } from "../../../script/fold-settings"
import { config } from "../../config"
import { base, files, restyled } from "../config"
import { docsHref, docsMarkdownHref } from "../lib/navigation"
import type { docsSlugs, renderDocsMarkdown, renderDocsPage, renderLlmsTxt, renderSitemap } from "../render"
import { docs } from "../vite"

const args = parseArgs({ options: { mode: { type: "string", default: "production" }, out: { type: "string" } } })
const mode = args.values.mode
if (mode !== "dev" && mode !== "production") throw new Error(`Unknown --mode ${mode}; use dev or production`)
const root = path.resolve(import.meta.dir, "../../..")
const output = path.resolve(root, args.values.out ?? ".output/public")
const cache = path.join(root, "node_modules/.cache/docs")
const restyle = restyled(mode)
const alias = { "~": path.join(root, "src") }
// The restyle's stylesheet and script, or the legacy ones.
const inputs = restyle
  ? { stylesheet: "src/docs/styles/docs.css", script: "src/docs/client.ts" }
  : { stylesheet: "src/docs/legacy/styles/global.css", script: "src/docs/legacy/client.ts" }
// llms.txt and the sitemap list opencode.ai's URLs in every mode, as the pages' canonical links do:
// search engines must not take dev.opencode.ai's for the real ones (src/lib/noindex.ts).
const site = new URL(config.baseUrl)

await rm(cache, { recursive: true, force: true })

// The stylesheet, script and fonts, hashed under /docs/_build (immutable in public/_headers).
await build({
  configFile: false,
  root,
  base,
  publicDir: false,
  logLevel: "warn",
  resolve: { alias },
  // The site's production CSS: the stylesheets for development tools empty, and only the settings
  // values production renders (the root's data-* attributes, DocsLayout.tsx).
  plugins: restyle ? [devOnlyCss(), cssVariantsForProduction()] : [],
  build: {
    outDir: path.join(cache, "client"),
    assetsDir: "_build",
    manifest: true,
    // The site's target (vite.config.ts): keeps light-dark() native; script/check-css-output.ts fails otherwise.
    cssTarget: ["chrome123", "edge123", "firefox120", "safari17.5"],
    rolldownOptions: { input: [inputs.script, inputs.stylesheet] },
  },
})
await cp(path.join(cache, "client/_build"), path.join(output, base, "_build"), { recursive: true })
const manifest: Record<string, { file: string }> = await Bun.file(path.join(cache, "client/.vite/manifest.json")).json()
const assets = {
  stylesheet: base + manifest[inputs.stylesheet].file,
  script: base + manifest[inputs.script].file,
}
if (restyle) await checkBudget()

await build({
  configFile: false,
  root,
  // Files the pages link from the server render (the fonts they preload) are emitted under
  // /docs/_build too, with the client build's names.
  base,
  logLevel: "warn",
  resolve: { alias },
  // Pages never hydrate, so no hydration markers. The site's components read their settings as
  // production does (script/fold-settings.ts).
  plugins: [foldSettingsForProduction(), docs({ restyle }), solid({ ssr: true, solid: { hydratable: false } })],
  build: {
    ssr: "src/docs/render.tsx",
    outDir: path.join(cache, "render"),
    assetsDir: "_build",
    ssrEmitAssets: true,
    minify: false,
  },
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
// The files the server render emitted that pages link (the fonts they preload and declare), beside the
// client build's; the render's own code stays in the cache.
const emitted = new Set<string>()
await Promise.all([
  ...render.docsSlugs.map(async (slug) => {
    const html = await render.renderDocsPage(slug, assets)
    if (html === undefined) throw new Error(`docs: ${slug} did not render`)
    for (const match of html.matchAll(/\/docs\/_build\/([^"')\s]+)/g)) emitted.add(match[1])
    await write(`${docsHref(slug).replace(/\/?$/, "/")}index.html`, html)
    const markdown = await render.renderDocsMarkdown(slug)
    if (markdown !== undefined) await write(docsMarkdownHref(slug), markdown)
  }),
  write(`${base}llms.txt`, render.renderLlmsTxt(site)),
  write(`${base}sitemap.xml`, render.renderSitemap(site)),
  // The logos, favicon and generated files the pages link (the site build has copied them already).
  cp(path.join(root, "public", base), path.join(output, base), { recursive: true }),
])

await Promise.all(
  [...emitted].map(async (file) => {
    const source = Bun.file(path.join(cache, "render/_build", file))
    if (await source.exists()) await Bun.write(path.join(output, base, "_build", file), source)
  }),
)

const pagefind = path.join(output, base)
await mkdir(pagefind, { recursive: true })
// The restyle's phone Contents bar repeats the page's headings, and code headers and screen reader
// text ("Copy", "Copied", "Opens in a new tab") aren't content, so they stay out of the index.
const exclude = restyle
  ? [
      "--exclude-selectors",
      "[data-component=contents-menu], [data-slot=code-head], [data-component=code-tabs] [data-slot=copy], [data-slot=sr-only]",
    ]
  : []
await Bun.$`${path.join(root, "node_modules/.bin/pagefind")} --site ${pagefind} ${exclude}`.quiet()
checkFileNames()
await checkAssetPrefix()
await Bun.$`bun ${path.join(import.meta.dir, "validate-links.ts")} ${output}`
console.log(`docs: built ${render.docsSlugs.length} pages (${mode}${restyle ? ", restyle" : ""})`)

/**
 * Fails when the restyle's first JavaScript or stylesheet outgrows its budget (gzipped): every docs
 * page loads both, and nothing else is render-blocking.
 */
async function checkBudget() {
  const budgets = { [inputs.script]: 6.5 * 1024, [inputs.stylesheet]: 28 * 1024 }
  const files = await Array.fromAsync(new Bun.Glob("_build/*.js").scan({ cwd: path.join(cache, "client") }))
  if (files.length !== 1) throw new Error(`docs: the script split into ${files.length} files: ${files.join(", ")}`)
  for (const [input, budget] of Object.entries(budgets)) {
    const file = manifest[input].file
    const size = Bun.gzipSync(await Bun.file(path.join(cache, "client", file)).bytes(), { level: 9 }).length
    console.log(`docs: ${file} ${(size / 1024).toFixed(1)} kB gzipped (budget ${(budget / 1024).toFixed(1)} kB)`)
    if (size > budget) throw new Error(`docs: ${file} is ${size} bytes gzipped, over its ${budget} byte budget`)
  }
}

/** Fails when a page's first path segment is the name of one of the docs' files, which it would hide. */
function checkFileNames() {
  const taken = render.docsSlugs.filter((slug) => files.includes(slug.split("/")[0]))
  if (taken.length) throw new Error(`docs: these pages use a name reserved for the docs' files: ${taken.join(", ")}`)
}

/** Fails when a docs page, or a stylesheet it links, loads a file from outside /docs. */
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
