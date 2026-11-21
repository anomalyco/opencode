import { sessionReferenceRange } from "./markdown-session-links"

// Chromium's default copy inlines computed styles, so text copied from a dark theme pastes as light text on the
// destination's white page. Copied HTML keeps only semantic markup and lets the destination style it.

const removedSelector = [
  "button",
  "input",
  "textarea",
  "select",
  "script",
  "style",
  "template",
  "svg",
  '[aria-hidden="true"]',
  ".sr-only",
  '[data-slot="markdown-copy-button"]',
  '[data-slot="markdown-code-toolbar"]',
].join(", ")

// Ancestors that give a partial selection its meaning, such as a phrase inside bold text or a line inside a code block.
const semanticTags = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "CODE",
  "DEL",
  "EM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "I",
  "KBD",
  "LI",
  "OL",
  "P",
  "PRE",
  "S",
  "STRONG",
  "TABLE",
  "TBODY",
  "TD",
  "TH",
  "THEAD",
  "TR",
  "UL",
])

const keptAttributes = new Set(["alt", "colspan", "rowspan", "start"])

const linkProtocols = new Set(["http:", "https:", "mailto:"])

const webProtocols = new Set(["http:", "https:"])

/** Copy special content as source without changing the screen selection. */
export function markdownClipboard(root: HTMLElement, ranges: readonly Range[]) {
  const formulas = Array.from(root.querySelectorAll<HTMLElement>(".katex"))
    .filter((element) => element.querySelector('annotation[encoding="application/x-tex"]'))
    .map((element) => element.closest<HTMLElement>(".katex-display") ?? element)

  const references = Array.from(root.querySelectorAll("[data-session-reference]"))

  let hasMath = false
  let normalized = false
  let startEdge: "inline" | "block" | undefined
  let endEdge: "inline" | "block" | undefined

  const expanded = ranges.map((range, index) => {
    const selection = range.cloneRange()
    formulas.forEach((formula) => {
      if (!range.intersectsNode(formula)) return

      const startsInside = formula.contains(range.startContainer)
      const endsInside = formula.contains(range.endContainer)

      if ((!startsInside && !endsInside) || hasSelectedMathText(range, formula)) {
        hasMath = true
        if (startsInside) selection.setStartBefore(formula)
        if (endsInside) selection.setEndAfter(formula)
        return
      }

      normalized = true

      if (startsInside && endsInside) {
        selection.setStartBefore(formula)
        selection.collapse(true)
        return
      }

      const edge = formula.matches(".katex-display") ? "block" : "inline"
      if (startsInside && index === 0) startEdge = edge
      if (endsInside && index === ranges.length - 1) endEdge = edge
      if (startsInside) selection.setStartAfter(formula)
      if (endsInside) selection.setEndBefore(formula)
    })
    return sessionReferenceRange(selection)
  })

  if (!hasMath && !normalized && !ranges.some((range) => references.some((ref) => range.intersectsNode(ref)))) return

  const container = document.createElement("div")
  container.style.cssText = "position:fixed;top:0;left:-100000px"
  expanded.forEach((range) => container.append(range.cloneContents()))
  container.querySelectorAll<HTMLElement>("[data-session-reference]").forEach((reference) => {
    reference.replaceWith(reference.dataset.sessionReference ?? "")
  })
  container.querySelectorAll<HTMLElement>(".katex").forEach((formula) => {
    const source = formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent

    if (source === undefined || source === null) return
    const display = formula.closest<HTMLElement>(".katex-display")
    const tex = document.createElement("span")
    tex.style.whiteSpace = "pre-wrap"
    tex.textContent = display ? `$$${source}$$` : `$${source}$`

    if (display) {
      display.replaceChildren(tex)

      return
    }

    formula.replaceWith(tex)
  })

  // Inline shrinkage can leave a selected space at an edge that innerText would otherwise drop.
  let marker = ""

  if (startEdge === "inline" || endEdge === "inline") {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []

    while (walker.nextNode()) {
      // SAFETY: SHOW_TEXT restricts the walker to Text nodes.
      const node = walker.currentNode as Text
      if (node.data) nodes.push(node)
    }

    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const guardStart = startEdge === "inline" && first?.data.startsWith(" ")
    const guardEnd = endEdge === "inline" && last?.data.endsWith(" ")

    if (guardStart || guardEnd) {
      let codepoint = 0xe000
      while (container.textContent?.includes(String.fromCodePoint(codepoint))) codepoint++
      marker = String.fromCodePoint(codepoint)
      if (guardStart) first.insertData(0, marker)
      if (guardEnd) last.appendData(marker)
    }
  }

  // innerText needs layout to retain the selected block and line breaks.
  root.append(container)
  const rendered = container.innerText
  container.remove()

  // The marker does not occur in the fragment, so hidden edge nodes cannot make us remove user text.
  const text = marker ? rendered.replaceAll(marker, "") : rendered

  if (!hasMath) return { ranges: expanded, text }

  const selected = getSelection()?.toString() ?? ""
  const leading = startEdge ? 0 : Math.max(0, (selected.match(/^ */)?.[0].length ?? 0) - (text.match(/^ */)?.[0].length ?? 0))
  const trailing = endEdge ? 0 : Math.max(0, (selected.match(/ *$/)?.[0].length ?? 0) - (text.match(/ *$/)?.[0].length ?? 0))

  return { ranges: expanded, text: " ".repeat(leading) + text + " ".repeat(trailing) }
}

function hasSelectedMathText(range: Range, formula: Element) {
  const visible = formula.querySelector(".katex-html")

  if (!visible) return false

  const scratch = document.createRange()
  scratch.selectNodeContents(visible)
  const start = scratch.comparePoint(range.startContainer, range.startOffset)
  const end = scratch.comparePoint(range.endContainer, range.endOffset)

  if (start === 1 || end === -1) return false

  if (start === 0) scratch.setStart(range.startContainer, range.startOffset)
  if (end === 0) scratch.setEnd(range.endContainer, range.endOffset)

  // KaTeX inserts a zero-width space in some layout-only spans.
  return !!scratch.toString().replace(/[\s\u200b]/g, "")
}

function sanitizeAttributes(element: Element) {
  for (const attribute of Array.from(element.attributes)) {
    if (keptAttributes.has(attribute.name)) continue

    if (attribute.name === "href" && element.tagName === "A" && hasProtocol(attribute.value, linkProtocols)) continue

    if (attribute.name === "src" && element.tagName === "IMG" && hasProtocol(attribute.value, webProtocols)) continue
    element.removeAttribute(attribute.name)
  }
}

function hasProtocol(value: string, protocols: Set<string>) {
  return URL.canParse(value) && protocols.has(new URL(value).protocol)
}

export function markdownClipboardHtml(root: Element, range: Range) {
  const selection = sessionReferenceRange(range)

  const ancestor = selection.commonAncestorContainer
  let content: Node = selection.cloneContents()

  for (
    let element = ancestor instanceof Element ? ancestor : ancestor.parentElement;
    element && element !== root && root.contains(element);
    element = element.parentElement
  ) {
    if (!semanticTags.has(element.tagName)) continue
    const wrapper = element.cloneNode(false)
    wrapper.appendChild(content)
    content = wrapper
  }

  const container = document.createElement("div")
  container.appendChild(content)
  container.querySelectorAll<HTMLElement>("[data-session-reference]").forEach((reference) => {
    const code = document.createElement("code")
    code.textContent = reference.dataset.sessionReference ?? ""
    reference.replaceWith(code)
  })
  container.querySelectorAll(removedSelector).forEach((element) => element.remove())
  container.querySelectorAll("*").forEach(sanitizeAttributes)

  return container.innerHTML
}
