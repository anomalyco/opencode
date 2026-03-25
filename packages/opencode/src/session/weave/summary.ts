import { ulid } from "ulid"
import type { SummaryNode } from "./types"
import { WeaveDB } from "./db"

export namespace WeaveSummary {
  export async function addLeaf(input: {
    sessionID: string
    text: string
    sourceMessageIDs: string[]
    parentID?: string
    depth?: number
  }) {
    const node: SummaryNode = {
      id: ulid(),
      sessionID: input.sessionID,
      parentID: input.parentID,
      depth: input.depth ?? 0,
      text: input.text,
      sourceMessageIDs: input.sourceMessageIDs,
      createdAt: Date.now(),
    }
    await WeaveDB.appendSummaryNode(input.sessionID, node)
    return node
  }

  export async function condense(input: {
    sessionID: string
    parentID?: string
    nodes: SummaryNode[]
    text: string
  }) {
    const depth = (Math.max(0, ...input.nodes.map((node) => node.depth)) || 0) + 1
    return addLeaf({
      sessionID: input.sessionID,
      parentID: input.parentID,
      depth,
      text: input.text,
      sourceMessageIDs: input.nodes.flatMap((node) => node.sourceMessageIDs),
    })
  }

  export async function list(sessionID: string) {
    const store = await WeaveDB.read(sessionID)
    return store.summaryNodes.toSorted((a, b) => a.depth - b.depth || b.createdAt - a.createdAt)
  }
}
