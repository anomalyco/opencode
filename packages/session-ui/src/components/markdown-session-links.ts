import type { MarkdownSessionTitle } from "../context/markdown"

// Generated session IDs have a 26-character alphanumeric suffix. Require a complete token
// so a partially streamed ID, an identifier suffix, or a path does not become a link.
const sessionID = /(?<![A-Za-z0-9_])ses_[A-Za-z0-9]{26}(?![A-Za-z0-9_])/g

const exactSessionID = /^ses_[A-Za-z0-9]{26}$/

/** Titles a block's links would show, so a block re-renders when a referenced session resolves. */
export function sessionTitleSignature(html: string, title: MarkdownSessionTitle | undefined) {
  if (!title || !html.includes("ses_")) return ""

  return [...new Set(Array.from(html.matchAll(sessionID), (match) => match[0]))]
    .map((id) => `${id}=${title(id) ?? ""}`)
    .join("\n")
}

export function markSessionLinks(root: HTMLElement, title?: MarkdownSessionTitle) {
  if (!root.textContent?.includes("ses_")) return

  // The worker's escaped-raw fallback has no markdown elements; linking its text
  // would turn IDs inside still-unparsed fenced code into buttons.
  if (!root.querySelector("p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6")) return

  root.querySelectorAll("code").forEach((code) => {
    if (code.closest("pre, a, button") || !exactSessionID.test(code.textContent ?? "")) return
    const id = code.textContent!
    const label = title?.(id)
    const link = sessionButton(id, label)
    code.replaceWith(link)

    if (!label) link.replaceChildren(code)
  })

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []

  while (walker.nextNode()) {
    const node = walker.currentNode as Text

    if (node.parentElement?.closest("a, button, code, pre")) continue

    if (node.data.includes("ses_")) nodes.push(node)
  }

  nodes.forEach((node) => {
    const matches = [...node.data.matchAll(sessionID)]

    if (!matches.length) return
    const fragment = document.createDocumentFragment()
    let start = 0
    matches.forEach((match) => {
      fragment.append(node.data.slice(start, match.index), sessionButton(match[0], title?.(match[0])))
      start = match.index + match[0].length
    })
    fragment.append(node.data.slice(start))
    node.replaceWith(fragment)
  })
}

function sessionButton(id: string, title: string | undefined) {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "markdown-session-link"
  button.dataset.sessionId = id
  button.textContent = title || id

  if (title) {
    button.dataset.sessionTitle = ""
    button.title = id
  }

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
