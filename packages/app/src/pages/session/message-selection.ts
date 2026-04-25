import { createSignal, type Accessor } from "solid-js"

export type MessageRole = "assistant" | "user"

export type MessageSelectionRect = {
  x: number
  y: number
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

export type MessageSelection = {
  messageID: string
  role: MessageRole
  quote: string
  rect: MessageSelectionRect
  anchor?: MessageSelectionRect
}

type Input = {
  blocked?: string
  root?: ParentNode | null
  selection?: Selection | null
}

const turnSel = "[data-message-id]"
const scopeSel = '[data-message-selection="true"][data-message-selection-id][data-message-role]'

const blockedSel = [
  '[data-component="prompt-input"]',
  '[data-component="message-annotation-basket"]',
  "[data-session-title]",
  '[data-message-selection-ignore="true"]',
].join(", ")

const parent = (node: Node | null) => {
  if (node instanceof Element) return node
  return node?.parentElement ?? undefined
}

const turn = (node: Node | null) => parent(node)?.closest<HTMLElement>(turnSel)

const scope = (node: Node | null) => parent(node)?.closest<HTMLElement>(scopeSel)

const blocked = (node: Node | null, sel: string) => !!parent(node)?.closest(sel)

const within = (root: ParentNode | null | undefined, node: Node | null) => {
  if (!(root instanceof Node)) return true
  return root.contains(node)
}

const role = (value: string | undefined) => {
  if (value === "assistant" || value === "user") return value
}

const box = (rect: DOMRect | DOMRectReadOnly): MessageSelectionRect => {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  }
}

const geometry = (range: Range) => {
  const list = range.getClientRects()
  const back = range.getBoundingClientRect()
  const first = list.item(0) ?? back
  const last = list.length === 0 ? back : list.item(list.length - 1) ?? back
  return {
    rect: box(first),
    anchor: box(last),
  }
}

export function readMessageSelection(input: Input = {}) {
  const selection = input.selection ?? (typeof window === "undefined" ? undefined : window.getSelection())
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return

  const range = selection.getRangeAt(0)
  if (!within(input.root, range.startContainer) || !within(input.root, range.endContainer)) return

  const sel = input.blocked ?? blockedSel
  if (blocked(range.startContainer, sel) || blocked(range.endContainer, sel)) return

  const startTurn = turn(range.startContainer)
  if (!startTurn) return

  const endTurn = turn(range.endContainer)
  if (!endTurn || endTurn !== startTurn) return

  const start = scope(range.startContainer)
  if (!start) return

  const end = scope(range.endContainer)
  if (!end) return

  const messageID = start.dataset.messageSelectionId
  if (!messageID || end.dataset.messageSelectionId !== messageID) return

  const kind = role(start.dataset.messageRole)
  if (!kind || role(end.dataset.messageRole) !== kind) return

  const quote = range.toString().trim()
  if (!quote) return

  return {
    messageID,
    role: kind,
    quote,
    ...geometry(range),
  } satisfies MessageSelection
}

export function createMessageSelectionController(input: { root: Accessor<ParentNode | undefined>; blocked?: string }) {
  const [state, setState] = createSignal<MessageSelection>()

  const sync = (selection?: Selection | null) => {
    const next = readMessageSelection({
      root: input.root(),
      selection,
      blocked: input.blocked,
    })
    setState(next)
    return next
  }

  const clear = () => setState()

  return {
    current: state,
    sync,
    clear,
  }
}
