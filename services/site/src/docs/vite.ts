import { readdirSync } from "node:fs"
import path from "node:path"
import { transformAsync } from "@babel/core"
import { compile } from "@mdx-js/mdx"
import solid from "babel-preset-solid"
import remarkGfm from "remark-gfm"
import remarkSmartypants from "remark-smartypants"
import { VFile } from "vfile"
import type { Plugin } from "vite"
import { parse } from "yaml"
import { docsSets, latestDocs, type DocsSet } from "./config"
import { frontmatterSchema } from "./frontmatter"
import { docsSlug } from "./lib/navigation"
import recmaSolid from "./recma-solid"
import rehypeHeadings from "./rehype-headings"
import rehypeShiki from "./rehype-shiki"
import rehypeTableScroll from "./rehype-table-scroll"
import remarkDocsLinks from "./remark-links"
import remarkSlots from "./remark-slots"

const repository = path.join(import.meta.dirname, "../../../..")
const pages = "virtual:docs-pages"

/**
 * The docs in the site's Vite build: compiles each set's MDX into server-only Solid modules (for
 * script/build.ts and the development server) and provides `virtual:docs-pages`, the page slugs of
 * each set. The docs' stylesheet and script are built by script/build.ts, under /docs/_build.
 */
export function docs(): Plugin {
  return {
    name: "opencode-docs",
    enforce: "pre",
    resolveId: (id) => (id === pages ? `\0${pages}` : undefined),
    load(id) {
      if (id !== `\0${pages}`) return
      const slugs = docsSets.map((set) => [
        set.id,
        [
          ...readdirSync(path.join(repository, set.content), { recursive: true, encoding: "utf8" })
            .filter((file) => file.endsWith(".mdx"))
            .map((file) => docsSlug(file.replaceAll("\\", "/"))),
          // The latest docs' API reference (render.tsx).
          ...(set.id === "latest" ? ["api"] : []),
        ].toSorted(),
      ])
      return `export const docsSlugs = ${JSON.stringify(Object.fromEntries(slugs))}`
    },
    async transform(source, id) {
      if (!id.endsWith(".mdx")) return
      const set = docsSets.find((set) => id.startsWith(path.join(repository, set.content) + path.sep)) ?? latestDocs
      const code = await compileMdx(source, id, set)
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

// MDX as Astro's MDX integration compiled it (GitHub-flavoured Markdown, smart punctuation, Shiki,
// heading ids), with the docs' own plugins, which wrap code in the site's CodeFrame and headings in
// HeadingLink. The module also exports the page's frontmatter, its headings and its Markdown twin (`# Title` and the source, as the docs have always served it).
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
    remarkPlugins: [remarkGfm, remarkSmartypants, [remarkDocsLinks, { base: set.base }], remarkSlots],
    rehypePlugins: [rehypeShiki, rehypeTableScroll, rehypeHeadings],
    recmaPlugins: [recmaSolid],
  })
  return [
    String(compiled.value).replaceAll("import.meta.env.BASE_URL", JSON.stringify(set.base)),
    `export const frontmatter = ${JSON.stringify(parsed.data)}`,
    `export const headings = ${JSON.stringify(compiled.data.headings ?? [])}`,
    `export const markdown = ${JSON.stringify(`# ${parsed.data.title}\n\n${body.trim()}`)}`,
  ].join("\n")
}
