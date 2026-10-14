import { Match, Predicate } from "effect"
import { base64Encode } from "@opencode/util/encode"
import type {
  JsonValue,
  SessionInfo,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client/promise"

/** What a parent session's subagent tool part reports for one child session. */
export type TaskStatus = "running" | "completed" | "cancelled" | "error"

/** Row states the agents panel renders. */
export type DerivedStatus = "idle" | "busy" | "cancelled" | "completed" | "error"

/** Tool names that spawn a child session, current first for the common case. */
const subagentNames = ["subagent", "task"]

export function text(value: JsonValue | undefined): string | undefined {
  if (!Predicate.isString(value)) return undefined

  const trimmed = value.trim()

  if (!trimmed) return undefined

  return trimmed
}

function toolMetadata(part: SessionMessageAssistantTool, key: string): JsonValue | undefined {
  if (!("metadata" in part.state)) return undefined

  return part.state.metadata?.[key]
}

/** The child session id a tool part spawned, accepting both metadata key spellings. */
export function toolSessionID(part: SessionMessageAssistantTool): string | undefined {
  return text(toolMetadata(part, "sessionID")) ?? text(toolMetadata(part, "sessionId"))
}

function toolDescription(part: SessionMessageAssistantTool): string | undefined {
  if (!("input" in part.state) || Predicate.isString(part.state.input)) return undefined

  return text(part.state.input.description)
}

function isSubagentPart(part: SessionMessageAssistantTool): boolean {
  return subagentNames.includes(part.name)
}

/**
 * The terminal state of one child session from its parent tool part. A completed part
 * is done; an error part is only a cancellation when the runner marked it interrupted
 * or aborted, mirroring core's structured abort errors.
 */
export function taskStatus(part: SessionMessageAssistantTool): TaskStatus {
  if (part.state.status === "completed") return "completed"

  if (part.state.status === "error") {
    if (toolMetadata(part, "interrupted") === true) return "cancelled"

    if (part.state.error.type === "aborted") return "cancelled"

    return "error"
  }

  return "running"
}

/**
 * A completed part whose child is still active in the background: the runner
 * settles the call while the subagent keeps running, and a synthetic completion
 * notice lands when it actually finishes.
 */
export function partBackgrounded(part: SessionMessageAssistantTool): boolean {
  if (part.state.status !== "completed" || !("metadata" in part.state)) return false

  return part.state.metadata?.status === "running"
}

/** A running foreground subagent call, with a child session once one exists. */
export interface BlockingSubagent {
  readonly partID: string
  readonly childID: string | undefined
  readonly label: string
}

/** The joinable tool parts plus the live foreground calls of a parent transcript. */
export interface SubagentTasks {
  readonly parts: Map<string, SessionMessageAssistantTool>
  readonly blocking: BlockingSubagent[]
}

function completedChildIDs(messages: SessionMessageInfo[]): Set<string> {
  const completed = new Set<string>()

  for (const message of messages) {
    if (message.type !== "synthetic" || message.metadata?.source !== "subagent") continue
    const childID = text(message.metadata?.childID)

    if (childID) completed.add(childID)
  }

  return completed
}

function latestUncompleted(messages: SessionMessageInfo[]): SessionMessageInfo | undefined {
  let latest: SessionMessageInfo | undefined

  for (const message of messages) {
    if (message.type !== "assistant" || message.time.completed !== undefined) continue

    latest = message
  }

  return latest
}

/**
 * The joinable tool parts plus the live foreground calls of a parent transcript,
 * mirroring the header's background-task reader: a running part only counts inside
 * the latest uncompleted assistant message (older ones are stale), and a
 * backgrounded completion only counts until its synthetic notice lands.
 */
export function subagentTasks(messages: SessionMessageInfo[]): SubagentTasks {
  const parts = new Map<string, SessionMessageAssistantTool>()
  const blocking: BlockingSubagent[] = []
  const finished = completedChildIDs(messages)
  const live = latestUncompleted(messages)

  for (const message of messages) {
    if (message.type !== "assistant") continue

    for (const part of message.content) {
      if (part.type !== "tool" || !isSubagentPart(part)) continue
      const childID = toolSessionID(part)

      if (part.state.status === "running") {
        if (message !== live) continue
        blocking.push({ partID: part.id, childID, label: toolDescription(part) ?? childID ?? part.id })

        if (childID) parts.set(childID, part)

        continue
      }

      if (!childID) continue

      if (part.state.status === "completed" && partBackgrounded(part) && finished.has(childID)) continue

      parts.set(childID, part)
    }
  }

  return { parts, blocking }
}

/** Every subagent task description of a parent transcript keyed by child session id, last write wins. */
export function subagentDescriptions(messages: SessionMessageInfo[]): Map<string, string> {
  const descriptions = new Map<string, string>()

  for (const message of messages) {
    if (message.type !== "assistant") continue

    for (const part of message.content) {
      if (part.type !== "tool" || !isSubagentPart(part)) continue
      const childID = toolSessionID(part)
      const description = toolDescription(part)

      if (childID && description) descriptions.set(childID, description)
    }
  }

  return descriptions
}

/** Direct children of one session, oldest first by id. */
export function childrenOf<T extends { id: string; parentID?: string }>(sessions: readonly T[], parentID: string): T[] {
  return sessions.filter((session) => session.parentID === parentID).sort((a, b) => (a.id < b.id ? -1 : 1))
}

/**
 * One row's rendered state. A running part means work in flight no matter what the
 * status map says; a backgrounded completion without an outcome is still active;
 * otherwise the outcome is ground truth, then the part's terminal state.
 */
export function deriveStatus(input: {
  part: TaskStatus | undefined
  backgrounded: boolean
  running: boolean
  outcome: SessionInfo["outcome"]
}): DerivedStatus {
  if (input.part === "running") return "busy"

  if (input.running) return "busy"

  if (input.outcome === "interrupted") return "cancelled"

  if (input.outcome === "failed") return "error"

  if (input.outcome === "succeeded") return "completed"

  if (input.part === "completed") return input.backgrounded ? "busy" : "completed"

  if (input.part) return input.part

  return "idle"
}

/** One child's rendered state from its tool part plus the live store. */
export function childStatus(input: {
  part: SessionMessageAssistantTool | undefined
  running: boolean
  outcome: SessionInfo["outcome"]
}): DerivedStatus {
  const task = input.part ? taskStatus(input.part) : undefined

  return deriveStatus({
    part: task,
    backgrounded: input.part ? partBackgrounded(input.part) : false,
    running: input.running,
    outcome: input.outcome,
  })
}

/** All tokens one child session burned, matching the context tab's total. */
export function tokenTotal(tokens: TokenUsageInfo): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

/**
 * Whole-tree spend: the owner's own cost plus every known child. Stored costs are
 * own-only (the projector attributes each step to its running session), so adding
 * the family never double counts. Matches the client's family aggregate.
 */
export function treeCost(parentCost: number | undefined, children: readonly { cost: number }[]): number {
  return (parentCost ?? 0) + childrenCost(children)
}

/** Subagents-only spend: every known child, never the owner. Pairs with treeCost. */
export function childrenCost(children: readonly { cost: number }[]): number {
  return children.reduce((sum, child) => sum + child.cost, 0)
}

export function formatTokens(total: number): string {
  if (total < 1000) return String(total)

  if (total < 1_000_000) return `${(total / 1000).toFixed(total < 10_000 ? 1 : 0)}k`

  return `${(total / 1_000_000).toFixed(1)}M`
}

export function formatCost(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(value)
}

export function formatTime(value: number, locale: string): string {
  return new Date(value).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** SPA route of a child session on the same server; the solid router intercepts the click. */
export function childHref(serverKey: string, sessionID: string): string {
  return `/server/${base64Encode(serverKey)}/session/${sessionID}`
}

/** Child titles carry a ` (@agent subagent)` suffix when no task description exists; drop it. */
export function stripSubagentSuffix(title: string): string {
  return title.replace(/\s+\(@[^)]+ subagent\)$/, "")
}

/** List orders for the agents panel. */
export type AgentSort = "recent" | "cost" | "tokens" | "name"

function compareKeys(a: number | string, b: number | string): number {
  if (Predicate.isNumber(a) && Predicate.isNumber(b)) return a - b

  return String(a).localeCompare(String(b))
}

/** Sorted children: recent means newest first unless ascending flips it. */
export function sortAgents<T extends { id: string; cost: number; tokens: TokenUsageInfo; time: { created: number } }>(
  sessions: readonly T[],
  options: { sort: AgentSort; ascending: boolean; name: (sessionID: string) => string },
): T[] {
  const direction = options.ascending ? 1 : -1

  const keyed = sessions.map((session) => ({
    session,
    key: Match.value(options.sort).pipe(
      Match.when("cost", () => session.cost),
      Match.when("tokens", () => tokenTotal(session.tokens)),
      Match.when("name", () => options.name(session.id).toLocaleLowerCase()),
      Match.orElse(() => session.time.created),
    ),
  }))

  keyed.sort((a, b) => compareKeys(a.key, b.key) * direction || (a.session.id < b.session.id ? -1 : 1))

  return keyed.map((entry) => entry.session)
}

/** Case-insensitive title, description, model and id match. */
export function filterAgents<T extends { id: string; model?: { id: string; providerID: string } }>(
  sessions: readonly T[],
  query: string,
  name: (sessionID: string) => string,
): T[] {
  const needle = query.trim().toLocaleLowerCase()

  if (!needle) return [...sessions]

  return sessions.filter((session) => {
    const model = session.model ? `${session.model.providerID}/${session.model.id}`.toLocaleLowerCase() : ""

    return (
      name(session.id).toLocaleLowerCase().includes(needle) ||
      session.id.toLocaleLowerCase().includes(needle) ||
      model.includes(needle)
    )
  })
}

/** Compact elapsed clock: 45s, 12m 36s, 3h 04m 09s. */
export function formatElapsed(started: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - started) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(rest).padStart(2, "0")}s`

  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, "0")}s`

  return `${rest}s`
}

/** Short relative stamp in the active locale: 2s ago, 18m ago, 3h ago, older falls back to the clock. */
export function formatRelative(when: number, now: number, locale: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" })
  const seconds = Math.max(0, Math.floor((now - when) / 1000))

  if (seconds < 60) return format.format(-seconds, "second")

  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) return format.format(-minutes, "minute")

  const hours = Math.floor(minutes / 60)

  if (hours < 24) return format.format(-hours, "hour")

  return formatTime(when, locale)
}

/** One recent tool call of a child transcript for the activity feed. */
export interface AgentActivity {
  readonly tool: string
  readonly target: string
  readonly at: number
}

/** The newest tool calls first, capped at the limit. */
export function latestActivity(messages: SessionMessageInfo[], limit = 3): AgentActivity[] {
  const found: AgentActivity[] = []

  for (let index = messages.length - 1; index >= 0 && found.length < limit; index--) {
    const message = messages[index]

    if (!message || message.type !== "assistant") continue

    for (let part = message.content.length - 1; part >= 0 && found.length < limit; part--) {
      const entry = message.content[part]

      if (!entry || entry.type !== "tool") continue

      found.push({
        tool: entry.name,
        target: activityTarget(entry),
        at: entry.time.completed ?? entry.time.ran ?? entry.time.created,
      })
    }
  }

  return found
}

function activityTarget(part: SessionMessageAssistantTool): string {
  if (!("input" in part.state) || Predicate.isString(part.state.input)) return ""

  const input = part.state.input

  return (
    text(input.path) ?? text(input.pattern) ?? text(input.command) ?? text(input.query) ?? text(input.description) ?? ""
  )
}

/** The newest assistant text of a transcript, for the expandable last response. */
export function lastResponse(messages: SessionMessageInfo[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]

    if (!message || message.type !== "assistant") continue

    const texts: string[] = []

    for (const part of message.content) {
      if (part.type === "text" && part.text.trim()) texts.push(part.text)
    }

    if (texts.length > 0) return texts.join("\n\n")
  }

  return undefined
}
