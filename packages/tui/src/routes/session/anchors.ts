import type { Renderable } from "@opentui/core"
import type { PartRef, SessionEntry, SessionNode } from "./grouping/session"

export type AnchorTarget = { type: "part"; ref: PartRef } | { type: "group"; groupID: string }

type Anchor = {
  target: AnchorTarget
  node: Pick<Renderable, "y" | "height" | "isDestroyed">
}

export function anchorKey(target: AnchorTarget) {
  return target.type === "part"
    ? JSON.stringify(["part", target.ref.messageID, target.ref.partID])
    : JSON.stringify(["group", target.groupID])
}

/** Whole non-assistant messages have one canonical UI body part. Derived
 * footer/usage rows use the preceding entry as their scroll reference. */
export function entryRef(entry: SessionEntry): PartRef | undefined {
  // Saved identities must not follow an in-place Solid store reconciliation.
  if (entry.type === "part") return { messageID: entry.ref.messageID, partID: entry.ref.partID }
  if (entry.type === "message") return { messageID: entry.messageID, partID: "message" }
}

export function groupID(node: Extract<SessionNode, { type: "group" }>, level: number) {
  const ref = firstRef(node.children)
  return ref && JSON.stringify([ref.messageID, ref.partID, node.kind, level])
}

function firstRef(nodes: readonly SessionNode[]): PartRef | undefined {
  for (const node of nodes) {
    const ref = node.type === "entry" ? entryRef(node.entry) : firstRef(node.children)
    if (ref) return ref
  }
}

export function containsAnchor(
  node: SessionEntry | Extract<SessionNode, { type: "group" }>,
  target: AnchorTarget,
  level = 0,
): boolean {
  if (node.type === "group") {
    if (target.type === "group" && groupID(node, level) === target.groupID) return true
    return node.children.some((child) =>
      containsAnchor(child.type === "entry" ? child.entry : child, target, level + 1),
    )
  }
  const ref = entryRef(node)
  return target.type === "part" && ref?.messageID === target.ref.messageID && ref.partID === target.ref.partID
}

/** Only mounted parts and actual group headers register. Geometry stays in OpenTUI. */
export function createTimelineAnchors() {
  const entries = new Map<string, Anchor>()
  const list = () =>
    [...entries.values()]
      .filter((anchor) => !anchor.node.isDestroyed && anchor.node.height > 0)
      .sort((a, b) => a.node.y - b.node.y)
  return {
    register(anchor: Anchor) {
      const key = anchorKey(anchor.target)
      entries.set(key, anchor)
      return () => {
        if (entries.get(key) === anchor) entries.delete(key)
      }
    },
    get(target: AnchorTarget) {
      const anchor = entries.get(anchorKey(target))
      return anchor && !anchor.node.isDestroyed && anchor.node.height > 0 ? anchor : undefined
    },
    forMessage(messageID: string) {
      return list().find((anchor) => anchor.target.type === "part" && anchor.target.ref.messageID === messageID)
    },
    messagePositions() {
      const seen = new Set<string>()
      return list().flatMap((anchor) => {
        if (anchor.target.type !== "part" || seen.has(anchor.target.ref.messageID)) return []
        const id = anchor.target.ref.messageID
        seen.add(id)
        return [{ id, y: anchor.node.y }]
      })
    },
    list,
  }
}
