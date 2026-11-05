// Prerenders the docs into the site's built assets (.output/public), after the site's `vite build`
// (script/build.ts): every page as HTML, every content page's Markdown twin, llms.txt and the
// sitemap, then the Pagefind search index, then checks every link between them.
//
// The pages render in a small server build of their own (render.tsx), outside the site's Worker
// bundle, which only serves the files (middleware.ts).
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { build } from "vite"
import solid from "vite-plugin-solid"
import { config } from "../../config"
import { base } from "../config"
import { docsHref, docsMarkdownHref } from "../lib/navigation"
import type { docsSlugs, renderDocsMarkdown, renderDocsPage, renderLlmsTxt, renderSitemap } from "../render"
import { docs } from "../vite"

const root = path.resolve(import.meta.dir, "../../..")
const output = path.join(root, ".output/public")
const renderer = path.join(root, "node_modules/.cache/docs-render")

await rm(renderer, { recursive: true, force: true })
await build({
  configFile: false,
  root,
  logLevel: "warn",
  // Pages never hydrate, so no hydration markers.
  plugins: [docs(), solid({ ssr: true, solid: { hydratable: false } })],
  build: { ssr: "src/docs/render.tsx", outDir: renderer, minify: false },
  ssr: { noExternal: true },
})
const render = (await import(path.join(renderer, "render.js"))) as {
  docsSlugs: typeof docsSlugs
  renderDocsPage: typeof renderDocsPage
  renderDocsMarkdown: typeof renderDocsMarkdown
  renderLlmsTxt: typeof renderLlmsTxt
  renderSitemap: typeof renderSitemap
}

// The client build's files for the docs' stylesheet and script (vite.ts adds them to it).
const manifest: Record<string, { file: string }> = await Bun.file(path.join(output, ".vite/manifest.json")).json()
const file = (id: string) => {
  const entry = manifest[id]
  if (!entry) throw new Error(`docs: ${id} is missing from the client build`)
  return `/${entry.file}`
}
const assets = { stylesheet: file("src/docs/styles/global.css"), script: file("src/docs/client.ts") }

const site = new URL(config.baseUrl)
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
])

const pagefind = path.join(output, `${base}docs`)
await mkdir(pagefind, { recursive: true })
await Bun.$`${path.join(root, "node_modules/.bin/pagefind")} --site ${pagefind}`.quiet()
await Bun.$`bun ${path.join(import.meta.dir, "validate-links.ts")} ${output}`
console.log(`docs: prerendered ${render.docsSlugs.length} pages`)
