import { parseSessionMention, sessionMentions, type SessionMention } from "@opencode/util/session-mention"

export type SessionTitle = (id: string) => string | undefined

export function markSessionLinks(root: HTMLElement, title: SessionTitle) {
  // Already-rendered references retain their source so renames, discovery and deletion are reactive.
  root.querySelectorAll<HTMLElement>("[data-session-reference]").forEach((element) => {
    const source = element.dataset.sessionReference!
    const mention = parseSessionMention(source)

    if (!mention) return
    const label = title(mention.id)

    if (element.textContent === (label ?? source) && (element.tagName === "BUTTON") === (label !== undefined)) return
    element.replaceWith(sessionReference(mention, source, label))
  })

  if (!root.textContent?.includes("ses_")) return

  // The worker's escaped-raw fallback has no markdown elements; linking its text
  // would turn IDs inside still-unparsed fenced code into buttons.
  if (!root.querySelector("p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6")) return

  root.querySelectorAll("code").forEach((code) => {
    if (code.closest("pre, a, button, [data-session-reference]")) return
    const source = code.textContent ?? ""
    const mention = parseSessionMention(source)

    if (mention) code.replaceWith(sessionReference(mention, source, title(mention.id)))
  })

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []

  while (walker.nextNode()) {
    // SAFETY: SHOW_TEXT restricts this walk to Text nodes.
    const node = walker.currentNode as Text

    if (node.parentElement?.closest("a, button, code, pre, [data-session-reference]")) continue

    if (node.data.includes("ses_")) nodes.push(node)
  }

  nodes.forEach((node) => {
    node.replaceWith(sessionReferenceText(node.data, title))
  })
}

/** Shared by plain user text and rendered assistant markdown. */
export function sessionReferenceText(text: string, title: SessionTitle) {
  const fragment = document.createDocumentFragment()
  let start = 0
  sessionMentions(text).forEach((mention) => {
    fragment.append(text.slice(start, mention.start), sessionReference(mention, mention.text, title(mention.id)))
    start = mention.end
  })
  fragment.append(text.slice(start))

  return fragment
}

function sessionReference(mention: SessionMention, source: string, title: string | undefined) {
  if (title === undefined) {
    const code = document.createElement("code")
    code.className = "markdown-session-id"
    code.dataset.sessionReference = source
    code.textContent = source

    return code
  }

  const button = document.createElement("button")
  button.type = "button"
  button.className = "markdown-session-link"
  button.dataset.sessionId = mention.id
  button.dataset.sessionReference = source
  button.title = mention.id
  button.textContent = title

  return button
}

export function setupSessionLinks(root: HTMLElement, open: () => ((id: string) => void) | undefined) {
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return
    const button = event.target.closest("button[data-session-id]")

    if (!(button instanceof HTMLButtonElement) || !root.contains(button)) return
    const handler = open()

    if (!handler) return
    event.stopPropagation()
    handler(button.dataset.sessionId!)
  }

  root.addEventListener("click", click)

  return () => root.removeEventListener("click", click)
}
