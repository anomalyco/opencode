// Builds the docs into the site's built assets, after the site's `vite build` (script/build.ts):
// the docs' stylesheet, script and fonts, every page as HTML, every content page's Markdown twin,
// llms.txt and the sitemap, then the Pagefind search index. Then it checks every link between them,
// that the pages load nothing from outside /docs, and that no page takes the name of one of the docs'
// files (config.ts `files`).
//
// The pages render in a small server build of their own (render.tsx), outside the site's Worker
// bundle, which only serves the files (middleware.ts). Every deploy builds the same docs. On its own
// (CI, after `bun run generate`):
//
//   bun src/docs/script/build.ts [--out <dir>]
import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { build } from "vite"
import solid from "vite-plugin-solid"
import { cssVariantsForProduction, devOnlyCss } from "../../../script/css-variants-plugin"
import { foldSettingsForProduction } from "../../../script/fold-settings"
import { config } from "../../config"
import { docsSets, latestDocs, v1Docs } from "../config"
import { docsHref, docsMarkdownHref } from "../lib/navigation"
import type {
  docsSlugs,
  renderDocsMarkdown,
  renderDocsPage,
  renderLlmsTxt,
  renderSitemap,
  v1EnglishSection,
} from "../render"
import { docs } from "../vite"

const args = parseArgs({ options: { out: { type: "string" } } })
const root = path.resolve(import.meta.dir, "../../..")
const output = path.resolve(root, args.values.out ?? ".output/public")
const cache = path.join(root, "node_modules/.cache/docs")
const alias = { "~": path.join(root, "src") }
const inputs = { stylesheet: "src/docs/styles/docs.css", script: "src/docs/client.ts" }
// llms.txt and the sitemap list opencode.ai's URLs on dev.opencode.ai too, as the pages' canonical links do:
// search engines must not take dev.opencode.ai's for the real ones (src/lib/noindex.ts).
const site = new URL(config.baseUrl)
// Every set's pages load the latest docs' stylesheet, script and fonts.
const base = latestDocs.base

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
  plugins: [devOnlyCss(), cssVariantsForProduction()],
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
const manifest: Record<string, { file: string; dynamicImports?: string[] }> = await Bun.file(
  path.join(cache, "client/.vite/manifest.json"),
).json()
const assets = {
  stylesheet: base + manifest[inputs.stylesheet].file,
  script: base + manifest[inputs.script].file,
}
await checkBudget()

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
  plugins: [foldSettingsForProduction(), docs(), solid({ ssr: true, solid: { hydratable: false } })],
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
  v1EnglishSection: typeof v1EnglishSection
}

const write = (href: string, body: string) => Bun.write(path.join(output, href), body)
// The files the server render emitted that pages link (the fonts they preload and declare), beside the
// client build's; the render's own code stays in the cache.
const emitted = new Set<string>()
await Promise.all([
  ...docsSets.flatMap((set) =>
    render.docsSlugs[set.id].map(async (slug) => {
      const html = await render.renderDocsPage(set, slug, assets)
      if (html === undefined) throw new Error(`docs: ${set.base}${slug} did not render`)
      for (const match of html.matchAll(/\/docs\/_build\/([^"')\s]+)/g)) emitted.add(match[1])
      await write(`${docsHref(slug, set).replace(/\/?$/, "/")}index.html`, html)
      const markdown = await render.renderDocsMarkdown(set, slug)
      if (markdown !== undefined) await write(docsMarkdownHref(slug, set), markdown)
    }),
  ),
  write(`${base}llms.txt`, render.renderLlmsTxt(site)),
  write(`${v1Docs.base}llms.txt`, render.renderLlmsTxt(site, v1Docs, [await render.v1EnglishSection()])),
  // Only the latest docs are in the sitemap: the V1 docs are noindex.
  write(`${base}sitemap.xml`, render.renderSitemap(site)),
  // The logos, images, favicon and generated files the pages link (the site build has copied them already).
  ...docsSets.map((set) => cp(path.join(root, "public", set.base), path.join(output, set.base), { recursive: true })),
])

await Promise.all(
  [...emitted].map(async (file) => {
    const source = Bun.file(path.join(cache, "render/_build", file))
    if (await source.exists()) await Bun.write(path.join(output, base, "_build", file), source)
  }),
)

// One search index per set, so each searches only its own pages. The phone Contents bar repeats the
// page's headings, and code headers and screen reader text ("Copy", "Copied", "Opens in a new tab")
// aren't content, so they stay out of the index.
const exclude =
  "[data-component=contents-menu], [data-slot=code-head], [data-component=code-tabs] [data-slot=copy], [data-slot=sr-only]"
for (const set of docsSets) {
  const pagefind = path.join(output, set.base)
  await mkdir(pagefind, { recursive: true })
  await Bun.$`${path.join(root, "node_modules/.bin/pagefind")} --site ${pagefind} --exclude-selectors ${exclude}`.quiet()
}
checkFileNames()
await checkAssetPrefix()
await Bun.$`bun ${path.join(import.meta.dir, "validate-links.ts")} ${output}`
console.log(`docs: built ${Object.values(render.docsSlugs).flat().length} pages`)

/**
 * Fails when the docs' first JavaScript or stylesheet outgrows its budget (gzipped): every docs
 * page loads both, and nothing else is render-blocking.
 */
async function checkBudget() {
  // The shared nav menus (packages/nav-menus) are the script's one file of its own, loaded on first use (nav-intent.ts).
  // The stylesheet carries the phone bars (the sticky section row and the Contents bar under it), about 0.3 kB,
  // the V1 docs' notice and type for their languages, about 1 kB, and the fonts' faces (src/style/fonts.css), about 1.3 kB.
  const budgets = { [inputs.script]: 8 * 1024, [inputs.stylesheet]: 30 * 1024 }
  const files = await Array.fromAsync(new Bun.Glob("_build/*.js").scan({ cwd: path.join(cache, "client") }))
  const lazy = manifest[inputs.script].dynamicImports?.length ?? 0
  if (files.length !== 1 + lazy)
    throw new Error(`docs: the script split into ${files.length} files: ${files.join(", ")}`)
  for (const [input, budget] of Object.entries(budgets)) {
    const file = manifest[input].file
    const size = Bun.gzipSync(await Bun.file(path.join(cache, "client", file)).bytes(), { level: 9 }).length
    console.log(`docs: ${file} ${(size / 1024).toFixed(1)} kB gzipped (budget ${(budget / 1024).toFixed(1)} kB)`)
    if (size > budget) throw new Error(`docs: ${file} is ${size} bytes gzipped, over its ${budget} byte budget`)
  }
}

/** Fails when a page's first path segment is the name of one of its set's files, which it would hide. */
function checkFileNames() {
  const taken = docsSets.flatMap((set) =>
    render.docsSlugs[set.id].filter((slug) => set.files.includes(slug.split("/")[0])).map((slug) => set.base + slug),
  )
  if (taken.length) throw new Error(`docs: these pages use a name reserved for the docs' files: ${taken.join(", ")}`)
}

/** Fails when a docs page, or a stylesheet it links, loads a file from outside the docs' sets. */
async function checkAssetPrefix() {
  const origin = "https://opencode.local"
  const pages = (
    await Promise.all(
      docsSets.map((set) => Array.fromAsync(new Bun.Glob(`${set.base.slice(1)}**/*.html`).scan({ cwd: output }))),
    )
  ).flat()
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
  const outside = [...found].filter(([url]) => !docsSets.some((set) => url.startsWith(origin + set.base)))
  if (!outside.length) return
  throw new Error(
    `docs: these files load from outside the docs:\n${outside.map(([url, from]) => `  ${url.replace(origin, "")} (from ${from})`).join("\n")}`,
  )
}
