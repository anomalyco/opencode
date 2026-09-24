import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { groupEntries, mergeGroups, splitGroups, type GroupNode } from "./tree"

export type PartRef = {
  messageID: string
  partID: string
}

export type CacheUsage = {
  read: number
  model: SessionMessageAssistant["model"]
}

export type SessionEntry =
  | { type: "message"; messageID: string }
  | { type: "compaction-queued"; inboxID: string }
  | { type: "part"; ref: PartRef }
  | { type: "assistant-footer"; messageID: string }
  | { type: "turn-usage"; messageIDs: string[]; previousCache?: CacheUsage }

export type GroupKind = "activity" | "reasoning" | "exploration" | "instructions"
export type SessionNode = GroupNode<SessionEntry, GroupKind>
export type SessionGroup = {
  type: "group"
  children: readonly GroupNode<SessionEntry, GroupKind>[]
  size: number
  completed: boolean
} & ({ kind: "reasoning" | "instructions" } | { kind: "exploration" | "activity"; pending: PartRef[] })

/** Experimental transcript detail; undefined selects the default production rules. */
export type Verbosity = "low" | "medium" | "high"
export const defaultVerbosity: Verbosity = "medium"

export type SessionRow = SessionEntry | SessionGroup

export type AppendPart =
  | { type: "text" }
  | { type: "reasoning"; time?: { completed?: number } }
  | { type: "tool"; name: string }

export type ProjectionEntry = {
  entry: SessionEntry
  part?: AppendPart
  path?: readonly GroupKind[]
  closesPrevious?: boolean
}

/** Hydrate a fresh history batch in one pass rather than merging one leaf at a time. */
export function projectEntries(entries: ProjectionEntry[]): SessionRow[] {
  const nodes = groupEntries(entries, (item) => item.path ?? [])
  return nodes.map((node, index) => {
    if (node.type === "entry") return node.entry.entry
    const next = nodes[index + 1]
    const completed =
      (next !== undefined && (next.type === "group" || next.entry.closesPrevious !== false)) ||
      (node.kind === "reasoning" &&
        node.children.every(
          (child) =>
            child.type === "entry" &&
            child.entry.part?.type === "reasoning" &&
            child.entry.part.time?.completed !== undefined,
        ))
    return sessionGroup({ ...node, children: node.children.map(unwrap) }, completed)
  })
}

function sessionGroup(node: Extract<SessionNode, { type: "group" }>, completed: boolean): SessionGroup {
  if (node.kind === "exploration" || node.kind === "activity")
    return { ...node, kind: node.kind, pending: [], completed }
  return { ...node, kind: node.kind, completed }
}

function unwrap(node: GroupNode<ProjectionEntry, GroupKind>): GroupNode<SessionEntry, GroupKind> {
  if (node.type === "entry") return { ...node, entry: node.entry.entry }
  return { ...node, children: node.children.map(unwrap) }
}

const explorationTools = new Set(["read", "glob", "grep", "webfetch", "websearch"])

/**
 * Grouping path for an assistant part. Adjacent thoughts group, as do reads, searches
 * and web fetches. Low wraps every run of tools and thoughts in one activity summary.
 */
export function partPath(part: AppendPart, verbosity: Verbosity): readonly GroupKind[] {
  const activity: GroupKind[] = verbosity === "low" && part.type !== "text" ? ["activity"] : []
  if (part.type === "reasoning") return [...activity, "reasoning"]
  if (part.type === "tool" && explorationTools.has(part.name.toLowerCase())) return [...activity, "exploration"]
  return activity
}

/** Instruction loads group; other messages stand alone. */
export function messagePath(message: SessionMessageInfo, verbosity: Verbosity): readonly GroupKind[] {
  if (instructionPaths(message).length === 0) return []
  return verbosity === "low" ? ["activity", "instructions"] : ["instructions"]
}

/** Files loaded by an instruction message; one load can carry several. */
export function instructionPaths(message: SessionMessageInfo | undefined): string[] {
  if (message?.type !== "synthetic") return []
  const instruction = message.metadata?.instruction
  if (typeof instruction !== "object" || instruction === null || Array.isArray(instruction)) return []
  return Array.isArray(instruction.paths)
    ? instruction.paths.filter((path): path is string => typeof path === "string")
    : []
}

/** Production rules only: keep lifecycle/status decisions outside the tree engine. */
export function append(
  rows: SessionRow[],
  ref: PartRef,
  part: AppendPart,
  index = rows.length,
  verbosity = defaultVerbosity,
) {
  const [node] = groupEntries<SessionEntry, GroupKind>([{ type: "part", ref }], () => partPath(part, verbosity))
  if (node.type === "entry") {
    completePrevious(rows, index)
    rows.splice(index, 0, node.entry)
    return
  }
  const previous = rows[index - 1]
  if (previous?.type === "group" && previous.kind === node.kind) {
    // Permission-blocked tools remain at the end, just as the former refs/pending
    // partition did. Inserting a new ref must precede those blocked tools.
    const pending = previous.kind === "exploration" ? previous.pending.length : 0
    const [left, right] = splitGroups([previous], previous.size - pending)
    const [merged] = mergeGroups(mergeGroups(left, [node]), right)
    if (merged.type !== "group") throw new Error("Expected merged session group")
    previous.children = merged.children
    previous.size = merged.size
    if (part.type === "reasoning") previous.completed &&= part.time?.completed !== undefined
    return
  }
  completePrevious(rows, index)
  rows.splice(
    index,
    0,
    sessionGroup(node, node.kind === "reasoning" && part.type === "reasoning" && part.time?.completed !== undefined),
  )
}

export function completePrevious(rows: SessionRow[], index = rows.length) {
  const previous = rows[index - 1]
  if (previous?.type === "group") previous.completed = true
}

/** Part references for an existing production subgroup, not a flat timeline. */
export function groupRefs(row: SessionGroup, includePending = false): PartRef[] {
  const pending = !includePending && (row.kind === "exploration" || row.kind === "activity") ? row.pending : []
  const visit = (nodes: readonly GroupNode<SessionEntry, GroupKind>[]): PartRef[] =>
    nodes.flatMap((node) => {
      if (node.type === "group") return visit(node.children)
      if (node.entry.type !== "part") return []
      const ref = node.entry.ref
      if (pending.some((item) => item.messageID === ref.messageID && item.partID === ref.partID)) return []
      return [ref]
    })
  return visit(row.children)
}

export function partitionPending(rows: SessionRow[], pending: Set<string>) {
  rows.forEach((row) => {
    if (row.type !== "group" || (row.kind !== "exploration" && row.kind !== "activity")) return
    // The production exploration rule creates direct part children. Preserve the
    // existing stable partition order when permissions are admitted or dismissed.
    // Activity groups render blocked tools outside the summary without reordering.
    if (row.kind === "exploration") {
      const blocked = (node: GroupNode<SessionEntry, GroupKind>) =>
        node.type === "entry" && node.entry.type === "part" && pending.has(node.entry.ref.partID)
      row.children = [...row.children.filter((node) => !blocked(node)), ...row.children.filter(blocked)]
    }
    row.pending = groupRefs(row, true).filter((ref) => pending.has(ref.partID))
  })
}

export function hasPart(rows: SessionRow[], ref: PartRef) {
  return rows.some((row) => {
    if (row.type === "part") return row.ref.messageID === ref.messageID && row.ref.partID === ref.partID
    if (row.type !== "group") return false
    return groupRefs(row, true).some((item) => item.messageID === ref.messageID && item.partID === ref.partID)
  })
}
