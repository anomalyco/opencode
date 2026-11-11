import type { Element, ElementContent, Root, RootContent } from "hast"
import { toText } from "hast-util-to-text"
import type { MdxJsxAttribute, MdxJsxFlowElementHast } from "mdast-util-mdx-jsx"
import { bundledLanguages, createCssVariablesTheme, createHighlighter, isSpecialLang } from "shiki"

// Fenced code in the site's code frame (component/site/code-frame.tsx, docs-variants.css "Vercel
// square"): a header with the block's label and a Copy button over the highlighted code. Shiki colours
// with CSS variables that docs.css maps to David's code colours (docs-variants.css --token-*: commands,
// flags, strings, operators, output), which are light-dark() pairs, so the page's theme picks them. By kind:
// - shell (bash, sh): "Terminal" (document.tsx names it, a tree and a diff in the page's language).
//   With `$ ` prompts, the prompts and the output lines are muted and Copy takes the commands only.
// - a `├──` tree in a text fence: the site's FileTree, without Copy.
// - diff: +/- rows; Copy leaves the removed lines out.
// - `title="…"` in the fence's meta: the title as the label, with the file's icon when it names a file.
// - anything else: its language as the label.
// The `pre` is the funnel's `snippet` copy region, named by its language (lib/funnel.ts).
const theme = createCssVariablesTheme({ name: "opencode-docs" })
// Shell, as in David's terminal samples: options and environment variables in the flag colour, and
// unquoted arguments plain, leaving the command and quoted strings coloured.
theme.tokenColors?.push(
  {
    scope: ["constant.other.option", "variable.other.assignment.shell"],
    settings: { foreground: "var(--shiki-token-keyword)" },
  },
  { scope: ["string.unquoted.argument.shell"], settings: { foreground: "var(--shiki-foreground)" } },
)
const highlighter = createHighlighter({ langs: ["plaintext"], themes: [theme] })
const shells = new Set(["bash", "sh", "shell", "zsh", "console"])
const labels: Record<string, string> = {
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "JSX",
  json: "JSON",
  jsonc: "JSONC",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  md: "Markdown",
  markdown: "Markdown",
  mdx: "MDX",
  html: "HTML",
  css: "CSS",
  python: "Python",
  py: "Python",
  go: "Go",
  rust: "Rust",
  dockerfile: "Dockerfile",
  sql: "SQL",
  http: "HTTP",
}

export default function rehypeShiki() {
  return async (tree: Root) => {
    const blocks = findCodeBlocks(tree)
    for (const block of blocks) block.parent.children[block.index] = await frame(block.code)
  }
}

async function frame(code: Element): Promise<ElementContent> {
  const className = code.properties.className
  const lang =
    (Array.isArray(className) ? className : [])
      .map((name) => /\blanguage-(\S+)/.exec(String(name))?.[1])
      .find((name) => name !== undefined) ?? "plaintext"
  const title = ((code.data as { meta?: string } | undefined)?.meta ?? "").match(/title="([^"]+)"/)?.[1]
  const text = toText(code, { whitespace: "pre" }).replace(/(?:\r\n|\r|\n)$/, "")
  const file = title?.replace(/ \(excerpt\)$/, "")
  const named = file !== undefined && /[./]/.test(file) && !/\s/.test(file)

  if (["text", "txt", "plaintext"].includes(lang) && !title && /[├└]──/.test(text))
    return jsx("CodeFrame", { variant: "fileTree", kind: "tree" }, [jsx("FileTree", { tree: text }, [])])

  if (shells.has(lang)) {
    const lines = text.split("\n")
    const prompted = lines.some((line) => line.startsWith("$ "))
    const pre = prompted ? await terminal(lines, lang) : await highlight(text, lang)
    return jsx(
      "CodeFrame",
      {
        variant: "terminal",
        kind: "terminal",
        label: title,
        copy: prompted ? lines.filter((line) => line.startsWith("$ ")).join("\n") : text,
        method: lang,
      },
      [pre],
    )
  }

  if (lang === "diff")
    return jsx(
      "CodeFrame",
      {
        variant: "codeDiff",
        kind: named ? "file" : "code",
        label: title,
        file: named ? file : undefined,
        copy: text
          .split("\n")
          .filter((line) => !line.startsWith("-"))
          .map((line) => line.replace(/^[+ ]/, ""))
          .join("\n"),
        method: lang,
      },
      [diff(text)],
    )

  return jsx(
    "CodeFrame",
    {
      variant: title ? "codeTitle" : "code",
      kind: named ? "file" : "code",
      label: title ?? labels[lang] ?? "",
      file: named ? file : undefined,
      copy: text,
      method: lang,
    },
    [await highlight(text, lang)],
  )
}

// Each block highlighted once per build: the V1 docs repeat the same blocks in every language.
const highlights = new Map<string, Promise<Element>>()

/** The code highlighted as one `pre`, on the frame's surface (Shiki's own background dropped). */
async function highlight(text: string, requested: string) {
  const key = `${requested}\0${text}`
  if (!highlights.has(key)) highlights.set(key, highlightOnce(text, requested))
  return structuredClone(await highlights.get(key)!)
}

async function highlightOnce(text: string, requested: string) {
  const shiki = await highlighter
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
  const pre = shiki.codeToHast(text, { theme: "opencode-docs", lang }).children[0] as Element
  pre.properties = {
    tabIndex: 0,
    dataLanguage: lang,
    dataFunnelCopy: "snippet",
    dataFunnelMethod: requested,
  }
  return pre
}

/** A shell session: each `$ ` line is a muted prompt and its highlighted command, the rest muted output. */
async function terminal(lines: string[], lang: string) {
  const commands = lines.filter((line) => line.startsWith("$ ")).map((line) => line.slice(2))
  const pre = await highlight(commands.join("\n"), lang)
  const code = pre.children[0] as Element
  const highlighted = code.children.filter((node): node is Element => node.type === "element")
  let next = 0
  code.children = lines.flatMap((line, index): ElementContent[] => [
    ...(index ? [{ type: "text" as const, value: "\n" }] : []),
    line.startsWith("$ ")
      ? span({ dataToken: "prompt" }, [{ type: "text", value: "$ " }, highlighted[next++]])
      : span({ dataToken: "output" }, [{ type: "text", value: line }]),
  ])
  return pre
}

/** A diff as rows: the sign in its own gutter, removed and added rows tinted (docs-variants.css). */
function diff(text: string): Element {
  return {
    type: "element",
    tagName: "pre",
    properties: { dataComponent: "code-diff", tabIndex: 0, dataFunnelCopy: "snippet", dataFunnelMethod: "diff" },
    children: text.split("\n").map((line) => {
      const sign = line[0] === "+" || line[0] === "-" ? line[0] : " "
      return {
        type: "element",
        tagName: "code",
        properties: { dataDiff: sign },
        children: [
          span({ dataSlot: "sign" }, [{ type: "text", value: sign }]),
          { type: "text", value: `${line.slice(1)}\n` },
        ],
      }
    }),
  }
}

function span(properties: Element["properties"], children: ElementContent[]): Element {
  return { type: "element", tagName: "span", properties, children }
}

/** An MDX component in the tree, rendered by the component of that name in document.tsx. */
function jsx(name: string, attributes: Record<string, string | undefined>, children: ElementContent[]) {
  return {
    type: "mdxJsxFlowElement",
    name,
    attributes: Object.entries(attributes).flatMap(([key, value]): MdxJsxAttribute[] =>
      value === undefined ? [] : [{ type: "mdxJsxAttribute", name: key, value }],
    ),
    children,
  } satisfies MdxJsxFlowElementHast as unknown as ElementContent
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
