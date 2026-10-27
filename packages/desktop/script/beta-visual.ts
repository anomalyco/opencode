// A pull request's "### Visual" SVG, rebuilt from an allowlist for the What's new in beta dialog, which shows it only
// as an <img>. The input is parsed as XML and serialized again from scratch: exactly one <svg> root, known shape,
// paint and animation elements and attributes only, references to the document itself only, and no CSS escapes.
export * as BetaVisual from "./beta-visual"

import { DomUtils, parseDocument } from "htmlparser2"

/** The most bytes a visual may take once rebuilt. */
const LIMIT = 8 * 1024

const ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
  "tspan",
  "title",
  "desc",
  "clipPath",
  "mask",
  "linearGradient",
  "radialGradient",
  "stop",
  "style",
  "animate",
  "animateTransform",
  "animateMotion",
  "set",
])

const SMIL = new Set(["animate", "animateTransform", "animateMotion", "set"])

const ATTRIBUTES = new Set([
  "id",
  "class",
  "style",
  "viewBox",
  "preserveAspectRatio",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "d",
  "points",
  "pathLength",
  "transform",
  "transform-origin",
  "href",
  "color",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "opacity",
  "visibility",
  "display",
  "vector-effect",
  "paint-order",
  "clip-path",
  "clip-rule",
  "clipPathUnits",
  "mask",
  "maskUnits",
  "maskContentUnits",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "font-size",
  "font-weight",
  "font-family",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "attributeName",
  "attributeType",
  "values",
  "from",
  "to",
  "by",
  "dur",
  "begin",
  "end",
  "repeatCount",
  "repeatDur",
  "keyTimes",
  "keySplines",
  "keyPoints",
  "calcMode",
  "additive",
  "accumulate",
  "restart",
  "type",
  "rotate",
  "path",
])

/** Where text may appear; elsewhere it is formatting whitespace. */
const TEXT = new Set(["text", "tspan", "title", "desc", "style"])

type Node = ReturnType<typeof parseDocument>["children"][number]

/**
 * The visual rebuilt twice: `animated` as drawn, and `still` with its SMIL elements, keyframes and animation and
 * transition declarations removed, for reduced motion. None when it is not one <svg> root, uses anything outside the
 * allowlist that can reach outside the document (a CSS escape, `@import`, a `url()` or `href` that is not `#id`, a
 * doctype), or is over 8 KB.
 */
export function sanitize(input: string) {
  if (input.length > LIMIT * 4 || /<!(doctype|entity|element|attlist)/i.test(input)) return undefined

  const document = parseDocument(input.replace(/^\s*<\?xml[^>]*\?>/, ""), {
    xmlMode: true,
    recognizeCDATA: true,
    recognizeSelfClosing: true,
  })

  const roots = document.children.filter(
    (node) => !DomUtils.isComment(node) && !(DomUtils.isText(node) && !node.data.trim()),
  )

  const root = roots[0]

  if (roots.length !== 1 || !root || !DomUtils.isTag(root) || root.name !== "svg") return undefined

  const animated = serialize(root, false)
  const still = serialize(root, true)

  if (animated === undefined || still === undefined || new TextEncoder().encode(animated).length > LIMIT)
    return undefined

  return { animated, still }
}

/** One element and its allowed children as markup; undefined anywhere means the whole visual is refused. */
function serialize(node: Node, still: boolean): string | undefined {
  if (!DomUtils.isTag(node) || !ELEMENTS.has(node.name)) return ""

  const name = node.name

  if (SMIL.has(name) && (still || /href$/i.test(node.attribs.attributeName ?? ""))) return ""

  const attributes = Object.entries(node.attribs).flatMap(([key, value]): [string, string | undefined][] => {
    const attribute = key === "xlink:href" ? "href" : key

    if (!ATTRIBUTES.has(attribute)) return []

    if (attribute === "href" && !/^#[\w-]+$/.test(value)) return []

    if (attribute === "style") return [[attribute, declarations(value, still)]]

    return [[attribute, safe(value) ? value : undefined]]
  })

  // A CSS escape or an outside reference in any value refuses the whole visual, rather than drawing part of it.
  if (attributes.some(([, value]) => value === undefined)) return undefined

  const children = node.children.map((child) => {
    if (DomUtils.isTag(child)) return serialize(child, still)

    if (DomUtils.isCDATA(child) || DomUtils.isText(child)) return text(name, DomUtils.textContent(child), still)

    return ""
  })

  if (children.includes(undefined)) return undefined

  const open = [
    name,
    ...(name === "svg" ? [`xmlns="http://www.w3.org/2000/svg"`] : []),
    ...attributes.map(([key, value]) => `${key}="${escape(value)}"`),
  ].join(" ")

  const body = children.join("")

  return body ? `<${open}>${body}</${name}>` : `<${open}/>`
}

/** An element's text, kept only where text means something; a stylesheet must pass `stylesheet`. */
function text(element: string, value: string, still: boolean) {
  if (!TEXT.has(element)) return ""

  if (element !== "style") return escape(value)

  const css = stylesheet(value, still)

  return css === undefined ? undefined : escape(css)
}

/** A stylesheet that only styles this document: rules, `@keyframes` and `@media`, no escapes or outside urls. */
function stylesheet(value: string, still: boolean) {
  const css = value.replace(/\/\*[\s\S]*?\*\//g, "")

  if (!safe(css) || /@(?!(-webkit-)?keyframes\b|media\b)/i.test(css)) return undefined

  if (!still) return css.trim()

  return withoutKeyframes(css)
    .replace(/\{([^{}]*)\}/g, (_, body: string) => `{${declarations(body, true)}}`)
    .trim()
}

/** A declaration list, without its animations and transitions for the still. */
function declarations(value: string, still: boolean) {
  const css = value.replace(/\/\*[\s\S]*?\*\//g, "")

  if (!safe(css)) return undefined

  if (!still) return css.trim()

  return css
    .split(";")
    .filter((declaration) => !/^\s*(-webkit-)?(animation|transition)(-[\w-]+)?\s*:/i.test(declaration))
    .join(";")
    .trim()
}

/** The stylesheet without its `@keyframes` blocks, braces balanced. */
function withoutKeyframes(css: string) {
  const start = css.search(/@(-webkit-)?keyframes\b/i)

  if (start === -1) return css

  const open = css.indexOf("{", start)

  if (open === -1) return css.slice(0, start)

  const end = Array.from(css.slice(open)).reduce(
    (state, char, index) => {
      if (state.end !== -1) return state

      const depth = state.depth + ({ "{": 1, "}": -1 }[char] ?? 0)

      return { depth, end: depth === 0 ? open + index + 1 : -1 }
    },
    { depth: 0, end: -1 },
  ).end

  return css.slice(0, start) + (end === -1 ? "" : withoutKeyframes(css.slice(end)))
}

/** No CSS escapes, no `@import`, and every `url()` points into the document. */
function safe(value: string) {
  return !value.includes("\\") && !/@import/i.test(value) && !/url\(\s*(?!['"]?#)/i.test(value)
}

function escape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
