import { parseSessionMention, sessionMentions, type SessionMention } from "@opencode/util/session-mention"

export type SessionTitle = (id: string) => string | undefined

export function markSessionLinks(root: HTMLElement, title: SessionTitle) {
  // Already-rendered references retain their source so renames, discovery and deletion are reactive.
  root.querySelectorAll<HTMLElement>("[data-session-reference]").forEach((element) => {
    const source = element.dataset.sessionReference!
    const mention = parseSessionMention(source)

    if (!mention) return
    const label = title(mention.id)

    if (
      element.textContent === (label === undefined ? source : `@${label}`) &&
      (element.tagName === "BUTTON") === (label !== undefined)
    )
      return
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
    code.dataset.sessionId = mention.id
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
  button.textContent = `@${title}`

  return button
}

export type SessionReferenceMenu = (input: { sessionID: string; x: number; y: number }) => void

export function setupSessionLinks(
  root: HTMLElement,
  open: () => ((id: string) => void) | undefined,
  menu?: () => SessionReferenceMenu | undefined,
) {
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return
    const button = event.target.closest("button[data-session-id]")

    if (!(button instanceof HTMLButtonElement) || !root.contains(button)) return
    const handler = open()

    if (!handler) return
    event.stopPropagation()
    handler(button.dataset.sessionId!)
  }

  const contextMenu = (event: MouseEvent) => {
    const reference = sessionReferenceTarget(root, event.target)
    const handler = menu?.()

    if (event.defaultPrevented || !reference || !handler) return
    event.preventDefault()
    event.stopPropagation()
    handler({ sessionID: reference.dataset.sessionId!, x: event.clientX, y: event.clientY })
  }

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "ContextMenu" && (event.key !== "F10" || !event.shiftKey)) return
    const reference = sessionReferenceTarget(root, event.target)
    const handler = menu?.()

    if (event.defaultPrevented || !reference || !handler) return
    const bounds = reference.getBoundingClientRect()
    event.preventDefault()
    handler({ sessionID: reference.dataset.sessionId!, x: bounds.left, y: bounds.bottom })
  }

  root.addEventListener("click", click)
  root.addEventListener("contextmenu", contextMenu)
  root.addEventListener("keydown", keyDown)

  return () => {
    root.removeEventListener("click", click)
    root.removeEventListener("contextmenu", contextMenu)
    root.removeEventListener("keydown", keyDown)
  }
}

function sessionReferenceTarget(root: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Element)) return
  const reference = target.closest<HTMLElement>("[data-session-reference][data-session-id]")

  return reference && root.contains(reference) ? reference : undefined
}

/** Undefined when the selection holds no session reference, so the caller keeps its usual copy. */
export function sessionReferenceClipboardText(root: HTMLElement, ranges: readonly Range[]) {
  const references = Array.from(root.querySelectorAll("[data-session-reference]"))

  if (!ranges.some((range) => references.some((reference) => range.intersectsNode(reference)))) return
  const container = document.createElement("div")
  container.style.cssText = "position:fixed;top:0;left:-100000px"
  ranges.forEach((range) => container.append(sessionReferenceRange(range).cloneContents()))
  container.querySelectorAll<HTMLElement>("[data-session-reference]").forEach((reference) => {
    reference.replaceWith(reference.dataset.sessionReference ?? "")
  })
  // `innerText` needs layout to keep line breaks.
  root.append(container)
  const text = container.innerText
  container.remove()

  return text
}

/** References copy atomically even when the selection starts or ends inside their displayed title. */
export function sessionReferenceRange(range: Range) {
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement

  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement

  const first = start?.closest("[data-session-reference]")

  const last = end?.closest("[data-session-reference]")

  if (!first && !last) return range
  const selection = range.cloneRange()

  if (first) selection.setStartBefore(first)

  if (last) selection.setEndAfter(last)

  return selection
}
