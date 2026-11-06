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
import { base } from "./config"
import { frontmatterSchema } from "./frontmatter"
import { docsSlug } from "./lib/navigation"
import recmaSolid from "./recma-solid"
import rehypeHeadings from "./rehype-headings"
import rehypeShiki from "./rehype-shiki"
import rehypeTableScroll from "./rehype-table-scroll"
import remarkDocsLinks from "./remark-links"
import remarkSlots from "./remark-slots"

const content = path.join(import.meta.dirname, "content")
const pages = "virtual:docs-pages"

/**
 * The docs in the site's Vite build: compiles content/*.mdx into server-only Solid modules (for
 * script/build.ts and the development server) and provides `virtual:docs-pages`, the list of page
 * slugs. The docs' stylesheet and script are built by script/build.ts, under /v2.
 */
export function docs(): Plugin {
  return {
    name: "opencode-docs",
    enforce: "pre",
    resolveId: (id) => (id === pages ? `\0${pages}` : undefined),
    load(id) {
      if (id !== `\0${pages}`) return
      const slugs = readdirSync(content, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".mdx"))
        .map((file) => docsSlug(file.replaceAll("\\", "/")))
      return `export const docsSlugs = ${JSON.stringify([...slugs, "api"].toSorted())}`
    },
    async transform(source, id) {
      if (!id.endsWith(".mdx")) return
      const code = await compileMdx(source, id)
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
// heading ids), with the docs' own plugins. The module also exports the page's frontmatter, its
// headings and its Markdown twin (`# Title` and the source, as the docs have always served it).
async function compileMdx(source: string, id: string) {
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
    remarkPlugins: [remarkGfm, remarkSmartypants, [remarkDocsLinks, { base }], remarkSlots],
    rehypePlugins: [rehypeShiki, rehypeTableScroll, rehypeHeadings],
    recmaPlugins: [recmaSolid],
  })
  return [
    String(compiled.value).replaceAll("import.meta.env.BASE_URL", JSON.stringify(base)),
    `export const frontmatter = ${JSON.stringify(parsed.data)}`,
    `export const headings = ${JSON.stringify(compiled.data.headings ?? [])}`,
    `export const markdown = ${JSON.stringify(`# ${parsed.data.title}\n\n${body.trim()}`)}`,
  ].join("\n")
}
