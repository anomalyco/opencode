import type { Link, Parent, Root, RootContent } from "mdast"
import type { MdxJsxAttribute, MdxJsxFlowElement } from "mdast-util-mdx-jsx"
import { visit } from "unist-util-visit"
import { latestDocs, v1Docs } from "./config"
import { docsHref } from "./lib/navigation"
import { v1Page, v1Slug } from "./lib/v1-navigation"

// The V1 docs' Starlight syntax (vite.ts), as the site's docs components (document.tsx): asides
// (`:::tip[Title]`, remark-directive) as Callout, Tabs as Tabs (code tabs, or panels of prose), Steps
// as the steps list, and no Starlight import. Other directives, such as `:name` in a sentence,
// stay text, as Starlight left them.

type Esm = { data?: { estree?: { body: { type: string; source?: { value: unknown } }[] } } }
type Directive = Parent & {
  type: "containerDirective" | "leafDirective" | "textDirective"
  name: string
  attributes?: Record<string, string | null | undefined> | null
}

export default function remarkStarlight(options: { asides?: readonly string[] } = {}) {
  return (tree: Root) => {
    let tabs = 0
    visit(tree, (node, index, parent) => {
      if (!parent || index === undefined) return
      const type = node.type as string
      if (type === "mdxjsEsm") return esm(node as Esm, index, parent)
      if (type === "containerDirective") return aside(node as unknown as Directive, options.asides)
      if (type === "leafDirective" || type === "textDirective")
        return restore(node as unknown as Directive, index, parent)
      if (node.type !== "mdxJsxFlowElement") return
      if (node.name === "Steps") {
        // The list in it becomes the steps list (docs-variants.css steps-2).
        for (const child of node.children)
          if (child.type === "list") child.data = { ...child.data, hProperties: { dataComponent: "steps" } }
        parent.children.splice(index, 1, ...(node.children as RootContent[]))
        return index
      }
      if (node.name === "Tabs") tabbed(node, `tabs-${++tabs}`)
    })
  }
}

// `import { Tabs } from "@astrojs/starlight/components"` goes; the rest of the block stays.
function esm(node: Esm, index: number, parent: Parent) {
  const estree = node.data?.estree
  if (!estree) return
  estree.body = estree.body.filter(
    (statement) =>
      statement.type !== "ImportDeclaration" || statement.source?.value !== "@astrojs/starlight/components",
  )
  if (estree.body.length) return
  parent.children.splice(index, 1)
  return index
}

// An aside as the site's callout. Spanish pages also wrote :::consejo and :::nota.
function aside(node: Directive, asides: readonly string[] | undefined) {
  const label = (node.children[0]?.data as { directiveLabel?: boolean } | undefined)?.directiveLabel
    ? node.children.shift()
    : undefined
  const type = ({ tip: "tip", consejo: "tip", caution: "caution", danger: "danger" } as const)[node.name] ?? "note"
  const title = label ? text(label) : asides?.[["note", "tip", "caution"].indexOf(type)]
  Object.assign(node, {
    type: "mdxJsxFlowElement",
    name: "Callout",
    attributes: [attribute("type", type), ...(title ? [attribute("title", title)] : [])],
  })
}

// Any other directive back to the text it was written as.
function restore(node: Directive, index: number, parent: Parent) {
  const attributes = Object.entries(node.attributes ?? {}).map(([key, value]) => (value ? `${key}="${value}"` : key))
  const nodes = [
    { type: "text", value: `${node.type === "leafDirective" ? "::" : ":"}${node.name}` },
    ...(node.children.length ? [{ type: "text", value: "[" }, ...node.children, { type: "text", value: "]" }] : []),
    ...(attributes.length ? [{ type: "text", value: `{${attributes.join(" ")}}` }] : []),
  ] as RootContent[]
  parent.children.splice(
    index,
    1,
    ...(node.type === "leafDirective" ? [{ type: "paragraph", children: nodes } as RootContent] : nodes),
  )
  return index
}

// Tabs as components/Tabs.tsx: each tab's label, and its code when it is one code block, with a
// panel per tab (`<Slot name="0">`).
function tabbed(node: MdxJsxFlowElement, id: string) {
  const items = node.children.filter((child): child is MdxJsxFlowElement => child.type === "mdxJsxFlowElement")
  const tabs = items.map((item) => ({
    label: String(item.attributes.find((a) => "name" in a && a.name === "label")?.value ?? ""),
    code: item.children.length === 1 && item.children[0].type === "code" ? item.children[0].value : undefined,
  }))
  node.attributes = [attribute("id", id), attribute("tabs", JSON.stringify(tabs))]
  node.children = items.map((item, index) => ({
    ...item,
    name: "Slot",
    attributes: [attribute("name", String(index))],
  }))
}

/**
 * Starlight's links, as the V1 docs wrote them: pages under /docs/ (or relative, `./providers`), in
 * English. They go to the page in the reader's language, or in English for a page only it has. Their
 * anchors are English too, which render.tsx moves to the heading in the same place on that page.
 * Images under the app's assets are in /v1/docs/assets.
 */
export function remarkStarlightLinks(options: { slug: string; slugs: readonly string[] }) {
  const { locale } = v1Page(options.slug)
  // A Starlight page path (`providers`, `ja/agents`, or the intro's ``) as the reader's language's page.
  const page = (path: string) => {
    if (v1Docs.locales!.includes(path.split("/")[0])) return path
    const localized = v1Slug(locale, path || "index")
    return options.slugs.includes(localized) ? localized : path || "index"
  }
  const resolve = (url: string) => {
    const image = /^(?:\.\.\/)+assets\/(.+)$/.exec(url)
    if (image) return `${v1Docs.base}assets/${image[1]}`
    if (/^([a-z][\w+.-]*:|\/\/)/i.test(url) || url === "/" || (url.startsWith("/") && !/^\/docs(\/|#|$)/.test(url)))
      return url
    const [path, hash] = url.split("#")
    const relative = path
      .replace(/^\/docs(\/|$)/, "")
      .replace(/^\.\//, "")
      .replace(/\/$/, "")
    if (relative === "go" || relative === "zen")
      return docsHref(relative === "go" ? "console/go" : "console/models", latestDocs)
    if (path === "") return url
    return `${docsHref(page(relative), v1Docs)}${hash === undefined ? "" : `#${hash}`}`
  }
  return (tree: Root) =>
    visit(tree, ["link", "image"], (node) => void ((node as Link).url = resolve((node as Link).url)))
}

function text(node: unknown): string {
  const value = node as { value?: string; children?: unknown[] }
  return value.value ?? (value.children ?? []).map(text).join("")
}

function attribute(name: string, value: string): MdxJsxAttribute {
  return { type: "mdxJsxAttribute", name, value }
}
