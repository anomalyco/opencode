export type OfficeComment = {
  id: string
  author: string
  text: string
  status: "open" | "resolved" | "denied"
  suggestedText?: string
  anchor?: string
  createdAt: number
}

export type OfficePreviewResult = {
  managed: boolean
  source: "draft" | "file"
  filename: string
  contentType: "markdown"
  content?: string
  fileUrl?: string
  comments: OfficeComment[]
  lock?: { sessionID: string; owner: string; stale: boolean }
}

export type OfficeCommentAction = "resolve" | "deny" | "approve" | "edit" | "delete"

export function availableCommentActions(
  comment: Pick<OfficeComment, "status" | "suggestedText">,
): OfficeCommentAction[] {
  if (comment.status !== "open") return ["delete"]
  const actions: OfficeCommentAction[] = ["resolve", "deny"]
  if (comment.suggestedText) actions.push("approve")
  actions.push("edit", "delete")
  return actions
}

export function markdownBlockIndex(root: HTMLElement, node: Node | null) {
  let current: Node | null = node
  while (current && current !== root) {
    if (current instanceof Element && current.hasAttribute("data-markdown-block")) {
      const parent = current.parentNode
      if (parent instanceof Element) {
        const index = Array.prototype.indexOf.call(parent.children, current)
        if (index >= 0) return index
      }
    }
    current = current.parentNode
  }
  return undefined
}

// anchors look like "startParagraph:startOffset"; bare indices are accepted too
export function anchorParagraphIndex(anchor: string | undefined) {
  if (!anchor) return undefined
  const value = Number(anchor.split(":")[0])
  return Number.isInteger(value) && value >= 0 ? value : undefined
}
