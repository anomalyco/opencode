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

/** Expand only formulas intersecting the original selection, without changing the screen selection. */
export function markdownMathRanges(root: HTMLElement, ranges: readonly Range[]) {
  const formulas = Array.from(root.querySelectorAll<HTMLElement>(".katex"))
    .filter((element) => element.querySelector('annotation[encoding="application/x-tex"]'))
    .map((element) => element.closest<HTMLElement>(".katex-display") ?? element)

  if (!ranges.some((range) => formulas.some((formula) => range.intersectsNode(formula)))) return

  return ranges.map((range) => {
    const selection = range.cloneRange()
    formulas.forEach((formula) => {
      if (!range.intersectsNode(formula)) return

      if (formula.contains(range.startContainer)) selection.setStartBefore(formula)

      if (formula.contains(range.endContainer)) selection.setEndAfter(formula)
    })

    return selection
  })
}

export function markdownMathClipboardText(root: HTMLElement, ranges: readonly Range[]) {
  const container = document.createElement("div")
  container.style.cssText = "position:fixed;top:0;left:-100000px"
  ranges.forEach((range) => container.append(sessionReferenceRange(range).cloneContents()))
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
  // innerText needs layout to retain the selected block and line breaks.
  root.append(container)
  const text = container.innerText
  container.remove()

  // Layout drops spaces at the edges of the cloned fragment, even when the original selection rendered them.
  const selected = getSelection()?.toString() ?? ""
  const leading = Math.max(0, (selected.match(/^ */)?.[0].length ?? 0) - (text.match(/^ */)?.[0].length ?? 0))
  const trailing = Math.max(0, (selected.match(/ *$/)?.[0].length ?? 0) - (text.match(/ *$/)?.[0].length ?? 0))

  return " ".repeat(leading) + text + " ".repeat(trailing)
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
