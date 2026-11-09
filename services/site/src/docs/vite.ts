import { readdirSync } from "node:fs"
import path from "node:path"
import { transformAsync } from "@babel/core"
import { compile } from "@mdx-js/mdx"
import solid from "babel-preset-solid"
import remarkDirective from "remark-directive"
import remarkGfm from "remark-gfm"
import remarkSmartypants from "remark-smartypants"
import { VFile } from "vfile"
import type { Plugin } from "vite"
import { parse } from "yaml"
import { docsSets, latestDocs, v1Docs, type DocsSet } from "./config"
import { frontmatterSchema } from "./frontmatter"
import { docsSlug } from "./lib/navigation"
import { asideTitles, v1Page } from "./lib/v1-navigation"
import recmaSolid from "./recma-solid"
import rehypeHeadings from "./rehype-headings"
import rehypeShiki from "./rehype-shiki"
import rehypeTableScroll from "./rehype-table-scroll"
import remarkDocsLinks from "./remark-links"
import remarkSlots from "./remark-slots"
import remarkStarlight, { remarkStarlightLinks } from "./remark-starlight"

const repository = path.join(import.meta.dirname, "../../../..")
const pages = "virtual:docs-pages"
// The V1 docs' MDX imports their app's config (packages/web/config.mjs) for a few URLs, as production had them.
const v1Config = "\0docs-v1-config"
const v1ConfigValues = {
  url: "https://opencode.ai",
  console: "https://opencode.ai/auth",
  email: "help@anoma.ly",
  github: "https://github.com/anomalyco/opencode",
  discord: "https://opencode.ai/discord",
}

/**
 * The docs in the site's Vite build: compiles each set's MDX into server-only Solid modules (for
 * script/build.ts and the development server) and provides `virtual:docs-pages`, the page slugs of
 * each set. The docs' stylesheet and script are built by script/build.ts, under /docs/_build.
 */
export function docs(): Plugin {
  return {
    name: "opencode-docs",
    enforce: "pre",
    resolveId(id, importer) {
      if (id === pages) return `\0${pages}`
      if (id.endsWith("/config.mjs") && importer && setOf(importer)?.id === "v1") return v1Config
    },
    load(id) {
      if (id === v1Config) return `export default ${JSON.stringify(v1ConfigValues)}`
      if (id !== `\0${pages}`) return
      const slugs = docsSets.map((set) => [set.id, slugsOf(set)])
      return `export const docsSlugs = ${JSON.stringify(Object.fromEntries(slugs))}`
    },
    async transform(source, id) {
      if (!id.endsWith(".mdx")) return
      const code = await compileMdx(source, id, setOf(id) ?? latestDocs)
      const result = await transformAsync(code, {
        filename: id,
        presets: [
          [solid, { generate: this.environment.config.consumer === "server" ? "ssr" : "dom", hydratable: false }],
        ],
        parserOpts: { plugins: ["jsx"] },
        configFile: false,
        babelrc: false,
      })
      return { code: result?.code ?? "", map: result?.map, moduleType: "js" }
    },
  }
}

/** The docs set a file's MDX belongs to. */
function setOf(file: string) {
  return docsSets.find((set) => file.startsWith(path.join(repository, set.content) + path.sep))
}

/** A set's page slugs: its MDX files, and the latest docs' API reference (render.tsx). */
function slugsOf(set: DocsSet) {
  return [
    ...readdirSync(path.join(repository, set.content), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".mdx"))
      .map((file) => docsSlug(file.replaceAll("\\", "/"))),
    ...(set.id === "latest" ? ["api"] : []),
  ].toSorted()
}

// MDX as Astro's MDX integration compiled it (GitHub-flavoured Markdown, smart punctuation, Shiki,
// heading ids), with the docs' own plugins, which wrap code in the site's CodeFrame and headings in
// HeadingLink. The module also exports the page's frontmatter, its headings and its Markdown twin (`# Title` and the source, as the docs have always served it).
// The V1 docs are Starlight's MDX (remark-starlight.ts), and their twins leave out its imports and
// say which version they are.
async function compileMdx(source: string, id: string, set: DocsSet) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)
  const parsed = frontmatterSchema.safeParse(match ? parse(match[1]) : {})
  if (!parsed.success) throw new Error(`${id}: invalid frontmatter\n${parsed.error.message}`)
  const body = match ? source.slice(match[0].length) : source
  // Blank lines in place of the frontmatter keep compile errors' line numbers right.
  const file = new VFile({ path: id, value: (match ? "\n".repeat(match[0].split("\n").length - 1) : "") + body })
  const compiled = await compile(file, {
    jsx: true,
    format: "mdx",
    elementAttributeNameCase: "html",
    stylePropertyNameCase: "css",
    remarkPlugins:
      set.id === "v1"
        ? v1Plugins(id)
        : [remarkGfm, remarkSmartypants, [remarkDocsLinks, { base: set.base }], remarkSlots],
    rehypePlugins: [rehypeShiki, rehypeTableScroll, rehypeHeadings],
    recmaPlugins: [recmaSolid],
  })
  return [
    String(compiled.value).replaceAll("import.meta.env.BASE_URL", JSON.stringify(set.base)),
    `export const frontmatter = ${JSON.stringify(parsed.data)}`,
    `export const headings = ${JSON.stringify(compiled.data.headings ?? [])}`,
    `export const markdown = ${JSON.stringify(`# ${parsed.data.title}\n\n${set.id === "v1" ? v1Markdown(body) : body.trim()}`)}`,
  ].join("\n")
}

function v1Plugins(id: string) {
  const slug = docsSlug(path.relative(path.join(repository, v1Docs.content), id).replaceAll("\\", "/"))
  return [
    remarkGfm,
    remarkSmartypants,
    remarkDirective,
    [remarkStarlight, { asides: asideTitles[v1Page(slug).locale.path] }],
    [remarkStarlightLinks, { slug, slugs: slugsOf(v1Docs) }],
  ] satisfies NonNullable<Parameters<typeof compile>[1]>["remarkPlugins"]
}

/** A V1 page's Markdown without its MDX imports and exports, after a line on which version it is. */
function v1Markdown(body: string) {
  let fenced = false
  const lines = body.split("\n").filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    return fenced || !/^(import|export) /.test(line)
  })
  return `> These are the docs for OpenCode V1. The latest docs, for OpenCode V2, are at https://opencode.ai/docs/llms.txt.\n\n${lines.join("\n").trim()}`
}
