import { SessionID } from "@opencode/schema/session-id"

// Generated session IDs have a 26-character alphanumeric suffix. Require a complete token
// so a partially streamed ID, an identifier suffix, or a path does not become a link.
const sessionID = /(?<![A-Za-z0-9_])ses_[A-Za-z0-9]{26}(?![A-Za-z0-9_])/g
const exactSessionID = /^ses_[A-Za-z0-9]{26}$/

export function markSessionLinks(root: HTMLElement) {
  if (!root.textContent?.includes("ses_")) return
  // The worker's escaped-raw fallback has no markdown elements; linking its text
  // would turn IDs inside still-unparsed fenced code into buttons.
  if (!root.querySelector("p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6")) return

  root.querySelectorAll("code").forEach((code) => {
    if (code.closest("pre, a, button") || !exactSessionID.test(code.textContent ?? "")) return
    const link = sessionButton(code.textContent!)
    code.replaceWith(link)
    link.replaceChildren(code)
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
      fragment.append(node.data.slice(start, match.index), sessionButton(match[0]))
      start = match.index + match[0].length
    })
    fragment.append(node.data.slice(start))
    node.replaceWith(fragment)
  })
}

function sessionButton(id: string) {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "markdown-session-link"
  button.dataset.sessionId = id
  button.textContent = id
  return button
}

export function setupSessionLinks(root: HTMLElement, open: () => ((id: SessionID) => void) | undefined) {
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return
    const button = event.target.closest("button[data-session-id]")
    if (!(button instanceof HTMLButtonElement) || !root.contains(button)) return
    const handler = open()
    if (!handler) return
    event.stopPropagation()
    handler(SessionID.make(button.dataset.sessionId!, { disableChecks: true }))
  }
  root.addEventListener("click", click)
  return () => root.removeEventListener("click", click)
}
