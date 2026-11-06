import type { Element, ElementContent, Root, RootContent } from "hast"
import { toText } from "hast-util-to-text"
import { bundledLanguages, createHighlighter, isSpecialLang, type ShikiTransformer } from "shiki"

// Highlights fenced code the way the docs' Astro build did, so global.css applies unchanged: a
// `pre.astro-code` with GitHub light colours inline and the dark ones as --shiki-dark variables,
// `data-language`, and `overflow-x: auto`. A `title="…"` in the fence's meta wraps it in a figure
// with a caption.
const themes = { light: "github-light", dark: "github-dark" }
const highlighter = createHighlighter({ langs: ["plaintext"], themes: Object.values(themes) })

export default function rehypeShiki() {
  return async (tree: Root) => {
    const blocks = findCodeBlocks(tree)
    for (const block of blocks) block.parent.children[block.index] = await highlight(block.code)
  }
}

async function highlight(code: Element): Promise<ElementContent> {
  const shiki = await highlighter
  const className = code.properties.className
  const requested =
    (Array.isArray(className) ? className : [])
      .map((name) => /\blanguage-(\S+)/.exec(String(name))?.[1])
      .find((name) => name !== undefined) ?? "plaintext"
  // With the languages it embeds, so a Markdown block's YAML frontmatter or nested fences are
  // highlighted whatever page loaded them first.
  const grammar = await bundledLanguages[requested as keyof typeof bundledLanguages]?.()
  const embedded = grammar?.default.flatMap((item) => item.embeddedLangsLazy ?? []) ?? []
  const lang = await shiki
    .loadLanguage(...([requested, ...embedded] as Parameters<typeof shiki.loadLanguage>))
    .then(() => requested)
    .catch(() => {
      if (isSpecialLang(requested)) return requested
      console.warn(`[Shiki] The language "${requested}" doesn't exist, falling back to "plaintext".`)
      return "plaintext"
    })
  const meta = (code.data as { meta?: string } | undefined)?.meta
  const root = shiki.codeToHast(toText(code, { whitespace: "pre" }).replace(/(?:\r\n|\r|\n)$/, ""), {
    themes,
    lang,
    meta: meta ? { __raw: meta } : undefined,
    transformers: [astroCode(lang), title],
  })
  return root.children[0] as ElementContent
}

function astroCode(lang: string): ShikiTransformer {
  return {
    pre(node) {
      const join = (value: unknown) => (Array.isArray(value) ? value.join(" ") : value)
      node.properties.class = String(join(node.properties.class) ?? "").replace(/shiki/g, "astro-code")
      node.properties.dataLanguage = lang
      node.properties.style = `${join(node.properties.style) ?? ""}; overflow-x: auto;`
    },
    line(node) {
      if (lang !== "diff") return
      const span = node.children[0]
      const text = span?.type === "element" ? span.children[0] : undefined
      if (span?.type !== "element" || text?.type !== "text") return
      const start = text.value[0]
      if (start !== "+" && start !== "-") return
      text.value = text.value.slice(1)
      span.children.unshift({
        type: "element",
        tagName: "span",
        properties: { style: "user-select: none;" },
        children: [{ type: "text", value: start }],
      })
    },
  }
}

const title: ShikiTransformer = {
  name: "code-block-title",
  root(root) {
    const value = this.options.meta?.__raw?.match(/title="([^"]+)"/)?.[1]
    const pre = root.children[0]
    if (!value || pre?.type !== "element") return
    root.children = [
      {
        type: "element",
        tagName: "figure",
        properties: { className: ["astro-code-figure"] },
        children: [
          {
            type: "element",
            tagName: "figcaption",
            properties: { className: ["astro-code-title"] },
            children: [{ type: "text", value }],
          },
          pre,
        ],
      },
    ]
  },
}

type Parent = { children: (RootContent | ElementContent)[] }

// A `pre` holding only a `code` (Markdown's fenced code), except math, anywhere in the tree (MDX
// component children included).
function findCodeBlocks(node: Parent): { parent: Parent; index: number; code: Element }[] {
  return node.children.flatMap((child, index) => {
    if (!("children" in child)) return []
    const code = child.children[0]
    if (
      child.type === "element" &&
      child.tagName === "pre" &&
      child.children.length === 1 &&
      code?.type === "element" &&
      code.tagName === "code"
    ) {
      const language = (Array.isArray(code.properties.className) ? code.properties.className : []).join(" ")
      return /\blanguage-math\b/.test(language) ? [] : [{ parent: node, index, code }]
    }
    return findCodeBlocks(child as Parent)
  })
}
