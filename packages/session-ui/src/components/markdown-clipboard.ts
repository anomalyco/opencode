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
  const ancestor = range.commonAncestorContainer
  let content: Node = range.cloneContents()

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
  container.querySelectorAll(removedSelector).forEach((element) => element.remove())
  container.querySelectorAll("*").forEach(sanitizeAttributes)

  return container.innerHTML
}
