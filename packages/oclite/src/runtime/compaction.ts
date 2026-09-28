// Overflow policy (ARCHITECTURE §6): estimate before every turn; at profile.compactAt × limit, first stub old
// tool outputs (a persisted `prune`), then, if still over, summarize through a side call (a `compaction`).
import { Effect, Stream } from "effect"
import { Message, type ToolDefinition } from "@opencode-ai/llm"
import type { AgentDef, EventSink, LlmGatewayShape, ModelHandle, Profile, SessionRecord, SessionStoreShape } from "../contract"
import { replay, type Replay } from "../session/store"

/** Context window used when nothing is known. opencode skips compaction at context 0; oclite never does. */
export const FALLBACK_CONTEXT = 32768

export function limit(agent: AgentDef, handle: ModelHandle) {
  return agent.max_context_tokens ?? (handle.contextWindow > 0 ? handle.contextWindow : FALLBACK_CONTEXT)
}

/**
 * E = last step's server-reported usage + chars/4 of what was appended since (+25% when that usage was
 * estimated). Without a trustworthy step (none yet, or a prune/compaction since) it is chars/4 of the request.
 */
export function estimate(state: Replay, system: string, tools: readonly ToolDefinition[]) {
  const step = state.records.findLast((record) => record.type === "step")
  const stale = !step || state.records.some((record) => record.type === "prune" && record.seq > step.seq)
  if (stale) return Math.ceil((system.length + JSON.stringify(tools).length + JSON.stringify(state.messages).length) / 4)
  const since = state.records.filter((record) => record.seq > step.seq)
  const base = (step.usage.input + step.usage.output) * (step.usage.estimated ? 1.25 : 1)
  return Math.ceil(base + (since.length ? JSON.stringify(since).length / 4 : 0))
}

export interface CompactInput {
  session_id: string
  agent_path: string[]
  agent: AgentDef
  handle: ModelHandle
  profile: Profile
  system: string
  tools: readonly ToolDefinition[]
  /** The turn about to be sent; tool results older than turn − stubAfterTurns are stubbed. */
  turn: number
  textProtocol: boolean
  gateway: LlmGatewayShape
  store: SessionStoreShape
  sink: EventSink
}

/**
 * Runs the §6 policy. `force` (overflow error paths) runs both steps unconditionally.
 * Returns what happened so the loop can re-read the session.
 */
export const maybe = Effect.fn("compaction.maybe")(function* (input: CompactInput, force = false) {
  const trigger = input.profile.compactAt * limit(input.agent, input.handle)
  const load = () => input.store.read(input.session_id).pipe(Effect.map((records) => replay(records, input)))
  const before = yield* load()
  if (!force && estimate(before, input.system, input.tools) < trigger) return "none" as const
  const status = (message: string) =>
    input.sink({ session_id: input.session_id, agent_path: input.agent_path, type: "status", phase: "compact", message })

  const cut = input.turn - input.profile.stubAfterTurns
  const pruned = Math.max(-1, ...before.records.flatMap((record) => (record.type === "prune" ? [record.before_turn] : [])))
  const stubbable = before.records.some((record) => record.type === "tool_result" && record.turn < cut && record.turn >= pruned)
  if (stubbable) {
    yield* status(`stubbing tool outputs older than ${input.profile.stubAfterTurns} turns`)
    yield* input.store.append(input.session_id, { type: "prune", before_turn: cut })
    if (!force && estimate(yield* load(), input.system, input.tools) < trigger) return "stubbed" as const
  }

  yield* status("compacting conversation")
  const all = yield* input.store.read(input.session_id)
  const state = replay(all, input)
  const { SessionCompaction } = yield* Effect.promise(() => import("@opencode-ai/core/session/compaction"))
  const prompt = yield* Effect.promise(() => import("@/agent/prompt/compaction.txt"))
  const summary = yield* input.gateway
    .stream(input.handle, {
      session_id: input.session_id,
      label: "compaction",
      system: prompt.default,
      messages: [Message.user(SessionCompaction.buildPrompt({ previousSummary: state.summary, context: serialize(state.records) }))],
      tools: [],
      thinking: false,
      maxTokens: 4096,
      onQueued: (behind) => status(`compaction queued behind ${behind}`),
    })
    .pipe(Stream.runFold(() => "", (text, event) => (event.type === "text-delta" ? text + event.text : text)))
  yield* input.store.append(input.session_id, {
    type: "compaction",
    summary: compose(summary, all, state),
    through_seq: all.at(-1)?.seq ?? 0,
  })
  return "compacted" as const
})

/** History after compaction: summary + original goal (≤ 2000 chars) + latest request + open todos. */
function compose(summary: string, all: readonly SessionRecord[], state: Replay) {
  const users = all.flatMap((record) => (record.type === "user" && !record.synthetic ? [record.text] : []))
  const open = state.todos.filter(
    (todo) => !(todo && typeof todo === "object" && "status" in todo && ["completed", "cancelled"].includes(String(todo.status))),
  )
  return [
    `<compaction-summary>\n${summary.trim()}\n</compaction-summary>`,
    users[0] !== undefined ? `Original request:\n${users[0].slice(0, 2000)}` : undefined,
    users.length > 1 ? `Latest request:\n${users.at(-1)!.slice(0, 2000)}` : undefined,
    open.length ? `Open todos:\n${open.map((todo) => `- ${JSON.stringify(todo)}`).join("\n")}` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join("\n\n")
}

/** Conversation lines for buildPrompt; tool output is capped at 2000 chars, messages at 4000 (pasted files). */
function serialize(records: readonly SessionRecord[]) {
  return records.flatMap((record) => {
    if (record.type === "user") return [`user: ${record.text.slice(0, 4000)}`]
    if (record.type === "text") return [`assistant: ${record.text.slice(0, 4000)}`]
    if (record.type === "tool_call") return [`assistant tool call ${record.name}: ${JSON.stringify(record.input).slice(0, 500)}`]
    if (record.type === "tool_result") return [`tool result ${record.name} (${record.status}): ${record.output.slice(0, 2000)}`]
    return []
  })
}
