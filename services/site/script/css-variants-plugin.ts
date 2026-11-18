// Production CSS plugins shared by the site's build (vite.config.ts) and the docs' own build
// (src/docs/script/build.ts), so both ship the same stylesheets for the same settings.
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import type { PluginOption } from "vite"
import variants from "../src/component/site/css-variants.json"

/**
 * Production only: a stylesheet named *.dev.css is for development tools (Settings, Design mode) and
 * builds empty, so its rules never reach a page's render-blocking CSS.
 */
export function devOnlyCss(): PluginOption {
  return {
    name: "dev-only-css",
    apply: "build",
    enforce: "pre",
    load: (id) => (/\.dev\.css(\?|$)/.test(id) ? "" : undefined),
  }
}

/**
 * Production only: Settings and Design mode are development tools, so the settings attributes
 * always carry the default settings' values (src/component/site/css-variants.json): on the site root,
 * and on the elements the pre-paint rules name (`scoped`, matched by their attribute values, such as
 * `[data-component="products"]`). This drops, from the production CSS, each selector that needs
 * another value of one of them, nested selectors included (read with their parents'), each rule left
 * with none, and then the at-rules left empty and the @keyframes nothing names any more; the
 * development server keeps every variant for Design mode. Only attributes outside parentheses count,
 * and an :is() or :where() none of whose selectors can match (an attribute inside :not() or :has()
 * keeps its selector).
 */
export function cssVariantsForProduction(): PluginOption {
  const root = variants.root as Record<string, string | null>
  const scoped = (variants.scoped as [string, string, string | null][]).map(([element, name, value]) => ({
    element: attributes(element).map((attribute) => attribute.join("")),
    name,
    value,
  }))
  const impossible = (selector: string): boolean =>
    alternatives(selector).some((list) => split(list).every((each) => impossible(each))) ||
    compounds(selector).some((compound) => {
      const found = attributes(compound)
      const keys = new Set(found.map((attribute) => attribute.join("")))
      return found.some(([name, operator, value]) => {
        if (name in root) return !matches(root[name], operator, value)
        return scoped.some(
          (entry) =>
            entry.name === name &&
            entry.element.every((key) => keys.has(key)) &&
            !matches(entry.value, operator, value),
        )
      })
    })
  return {
    name: "css-variants-for-production",
    apply: "build",
    config: () => ({
      css: {
        postcss: {
          plugins: [
            {
              postcssPlugin: "css-variants-for-production",
              OnceExit(css: Root) {
                // Each rule's selectors as written out in full, so a nested one is read with its parents'.
                const full = new WeakMap<Node, string[]>()
                css.walkRules((rule) => {
                  if (/keyframes$/i.test(rule.parent?.name ?? "")) return
                  const parent = parentRule(rule)
                  const parents = (parent && full.get(parent)) ?? [""]
                  const selectors = split(rule.selector ?? "").map((selector) => ({
                    selector,
                    full: parents.map((parent) => nest(parent, selector.trim())).filter((each) => !impossible(each)),
                  }))
                  const kept = selectors.filter((selector) => selector.full.length)
                  full.set(
                    rule,
                    kept.flatMap((selector) => selector.full),
                  )
                  if (!kept.length) return rule.remove()
                  if (kept.length < selectors.length)
                    rule.selector = kept.map((selector) => selector.selector).join(",")
                })
                removeEmpty(css)
                // A @keyframes no declaration names any more (an animation, or a custom property one
                // reads), unless another file names it: a stylesheet built on its own, or a script.
                const named = new Set<string>()
                css.walkDecls((decl) => decl.value?.match(/[\w-]+/g)?.forEach((name) => named.add(name)))
                css.walkAtRules(/^(-webkit-)?keyframes$/i, (rule) => {
                  const name = (rule.params ?? "").trim().replace(/^["']|["']$/g, "")
                  if (named.has(name) || namedElsewhere(name, rule.source?.input?.file)) return
                  rule.remove()
                })
                removeEmpty(css)
              },
            },
          ],
        },
      },
    }),
  }
}

// The PostCSS nodes this reads (the site doesn't depend on PostCSS itself; Vite runs it).
type Node = {
  type: string
  name?: string
  params?: string
  selector?: string
  value?: string
  nodes?: Node[]
  parent?: Node
  source?: { input?: { file?: string } }
  remove(): void
}
type Root = Node & {
  walk(callback: (node: Node) => void): void
  walkRules(callback: (rule: Node) => void): void
  walkDecls(callback: (decl: Node) => void): void
  walkAtRules(filter: RegExp, callback: (rule: Node) => void): void
}

/** The nearest rule a rule is nested in (through at-rules such as @media), if any. */
function parentRule(rule: Node) {
  let node = rule.parent
  while (node && node.type === "atrule") node = node.parent
  return node?.type === "rule" ? node : undefined
}

/** A nested selector written out against one of its parent's (CSS nesting: `&`, or a descendant). */
function nest(parent: string, selector: string) {
  if (!parent) return selector
  return selector.includes("&") ? selector.replaceAll("&", parent) : `${parent} ${selector}`
}

/** Removes the rules and at-rules (other than @font-face and the like, which hold declarations) left empty. */
function removeEmpty(css: Root) {
  const empty: Node[] = []
  css.walk((node) => {
    if ((node.type === "rule" || node.type === "atrule") && node.nodes && node.nodes.length === 0) empty.push(node)
  })
  if (!empty.length) return
  empty.forEach((node) => node.remove())
  removeEmpty(css)
}

/** A selector list's selectors. */
function split(selector: string) {
  const parts: string[] = []
  let depth = 0
  let quote = ""
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i]
    if (quote) {
      if (char === quote) quote = ""
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === "(" || char === "[") depth++
    else if (char === ")" || char === "]") depth--
    else if (char === "," && depth === 0) {
      parts.push(selector.slice(start, i))
      start = i + 1
    }
  }
  return [...parts, selector.slice(start)]
}

/** A selector's compound selectors (between its combinators), without what's inside parentheses. */
function compounds(selector: string) {
  const list = [""]
  let depth = 0
  let bracket = false
  let quote = ""
  for (const char of selector) {
    if (quote) {
      if (char === quote) quote = ""
      if (!depth) list[list.length - 1] += char
      continue
    }
    if (char === "(") depth++
    if (char === ")") depth--
    if (depth || char === ")") continue
    if (char === '"' || char === "'") quote = char
    if (char === "[") bracket = true
    if (char === "]") bracket = false
    if (!bracket && /[\s>+~]/.test(char)) {
      if (list.at(-1)) list.push("")
      continue
    }
    list[list.length - 1] += char
  }
  return list.filter(Boolean)
}

/** The selector lists of a selector's own :is() and :where(), which match when one of theirs does. */
function alternatives(selector: string) {
  const depth = (text: string) => [...text].reduce((open, char) => open + (char === "(" ? 1 : char === ")" ? -1 : 0), 0)
  return [...selector.matchAll(/:(?:is|where)\(/g)]
    .filter((match) => depth(selector.slice(0, match.index)) === 0)
    .map((match) => {
      let open = 1
      let end = match.index + match[0].length
      for (; end < selector.length && open; end++) {
        if (selector[end] === "(") open++
        if (selector[end] === ")") open--
      }
      return selector.slice(match.index + match[0].length, end - 1)
    })
}

/** A compound selector's attribute selectors, as name, operator and value (a case-insensitive one is left out). */
function attributes(compound: string) {
  return [...compound.matchAll(/\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*)))?\s*([is])?\s*\]/g)]
    .filter((match) => match[6] !== "i")
    .map((match) => [match[1], match[2] ?? "", match[3] ?? match[4] ?? match[5] ?? ""] as const)
}

/** Whether an attribute with this production value (null: absent) matches an attribute selector. */
function matches(fixed: string | null, operator: string, value: string) {
  if (fixed === null) return false
  if (operator === "") return true
  if (operator === "=") return fixed === value
  if (operator === "~=") return fixed.split(" ").includes(value)
  if (operator === "|=") return fixed === value || fixed.startsWith(`${value}-`)
  if (operator === "^=") return fixed.startsWith(value)
  if (operator === "$=") return fixed.endsWith(value)
  return fixed.includes(value)
}

// The site's and its packages' sources, each file's words, read once: a @keyframes one of them names
// stays, as a stylesheet built on its own or a script may use it.
const sources = ["../src", "../../../packages/ui/src", "../../../packages/nav-menus/src"].map((dir) =>
  path.resolve(import.meta.dirname, dir),
)
let words: Map<string, Set<string>> | undefined
function namedElsewhere(name: string, file: string | undefined) {
  words ??= new Map(
    sources.flatMap((dir) =>
      readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((entry) => /\.(css|tsx?|mdx)$/.test(entry))
        .map((entry) => {
          const text = readFileSync(path.join(dir, entry), "utf8")
          return [path.join(dir, entry), new Set(text.match(/[\w-]+/g))] as const
        }),
    ),
  )
  return [...words].some(([source, names]) => source !== file && names.has(name))
}
