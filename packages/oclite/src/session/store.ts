// Append-only JSONL sessions (ARCHITECTURE §7): one redacted record per line, flushed per line; replay for resume.
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync } from "fs"
import path from "path"
import { Effect, Layer } from "effect"
import { Message } from "@opencode-ai/llm"
import { SessionStore, type RecordInput, type SessionHeader, type SessionRecord, type SessionStoreShape } from "../contract"
import { dataDir, id } from "../util/paths"
import { redact } from "../util/redact"
import { parseLine } from "./records"

export const layer = Layer.sync(SessionStore, () => make(path.join(dataDir(), "sessions")))

/** A store rooted at `dir` (tests pass a temp dir; the layer uses ~/.local/share/oclite/sessions). */
export function make(dir: string): SessionStoreShape {
  const seqs = new Map<string, number>()
  // Ids reach paths (`--resume <id>`), so anything but `ses_<alnum>` is refused before touching the disk.
  const file = (session: string) => {
    if (!validId(session)) throw new Error(`invalid session id "${session}"`)
    return path.join(dir, `${session}.jsonl`)
  }
  const read = (session: string) =>
    Effect.promise(async () => {
      const handle = Bun.file(file(session))
      if (!(await handle.exists())) return []
      return (await handle.text()).split("\n").flatMap((line) => parseLine(line) ?? [])
    })
  const write = (session: string, record: RecordInput) =>
    Effect.gen(function* () {
      // Transcripts hold code and output the redactor can't know about: owner-only dir and files, fixed on first open.
      if (!seqs.has(session)) secure(dir, file(session))
      const seq = seqs.get(session) ?? ((yield* read(session)).at(-1)?.seq ?? -1) + 1
      seqs.set(session, seq + 1)
      // appendFileSync writes the whole line before returning, so a crash leaves at most one torn tail line.
      appendFileSync(file(session), JSON.stringify({ ...(redact(record) as RecordInput), seq, t: Date.now() }) + "\n", { mode: 0o600 })
    })
  const headers = Effect.promise(() =>
    Promise.all(
      (safeList(dir) ?? []).map(async (name) => {
        const head = parseLine((await Bun.file(path.join(dir, name)).slice(0, 16384).text()).split("\n")[0] ?? "")
        return head?.type === "session" ? head : undefined
      }),
    ).then((items) => items.filter((item) => item !== undefined).toSorted((a, b) => b.created_at - a.created_at)),
  )
  return {
    create: (header) => Effect.suspend(() => {
      const session = header.id || id("ses")
      return write(session, { ...header, id: session, type: "session", v: 1 }).pipe(Effect.as(session))
    }),
    append: write,
    read,
    list: (filter) => headers.pipe(Effect.map((items) =>
      items.filter((item) => !filter?.cwd || item.cwd === filter.cwd).slice(0, filter?.limit ?? items.length))),
    latest: (cwd) => headers.pipe(Effect.map((items) => items.find((item) => item.cwd === cwd && !item.parent_id)?.id)),
  }
}

export function validId(session: string) {
  return /^ses_[A-Za-z0-9]+$/.test(session)
}

function secure(dir: string, file: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  if (existsSync(file)) chmodSync(file, 0o600)
}

function safeList(dir: string) {
  if (!existsSync(dir)) return undefined
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isFile() && entry.name.endsWith(".jsonl") ? [entry.name] : []))
}

export interface Replay {
  header?: SessionHeader
  messages: Message[]
  /** Records after the last compaction, minus a trailing incomplete step (what the model sees). */
  records: SessionRecord[]
  todos: unknown[]
  activated: string[]
  summary?: string
  /** Next turn number. */
  turn: number
}

/**
 * Rebuild the conversation from records: apply the last compaction and every prune, then drop a trailing
 * incomplete step (parts of a turn with no `step` record, and tool calls without results), so a resumed run
 * continues from the last complete tool result. `textProtocol` renders calls/results as plain text turns
 * for servers without a tool-call parser.
 */
export function replay(all: readonly SessionRecord[], options: { textProtocol?: boolean } = {}): Replay {
  const compaction = all.findLast((record) => record.type === "compaction")
  const live = compaction ? all.filter((record) => record.seq > compaction.through_seq) : all
  const stepped = new Set(live.flatMap((record) => (record.type === "step" ? [record.turn] : [])))
  const resulted = new Set(live.flatMap((record) => (record.type === "tool_result" ? [record.call_id] : [])))
  const calls = new Map(live.flatMap((record) => (record.type === "tool_call" ? [[record.call_id, record] as const] : [])))
  const records = live.filter((record) => {
    if (record.type === "text" || record.type === "reasoning") return stepped.has(record.turn)
    if (record.type === "tool_call") return stepped.has(record.turn) && resulted.has(record.call_id)
    if (record.type === "tool_result") return stepped.has(calls.get(record.call_id)?.turn ?? -1)
    return true
  })
  const pruned = Math.max(-1, ...all.flatMap((record) => (record.type === "prune" ? [record.before_turn] : [])))
  const turns = all.flatMap((record) => ("turn" in record ? [record.turn] : []))
  return {
    header: all.find((record) => record.type === "session"),
    messages: toMessages(records, pruned, compaction?.summary, options.textProtocol === true),
    records,
    todos: todos(all),
    activated: [...new Set(all.flatMap((record) => (record.type === "tools_activated" ? record.names : [])))],
    summary: compaction?.summary,
    turn: turns.length ? Math.max(...turns) + 1 : 0,
  }
}

/** The stub that replaces an old tool output (§6 step 1). */
export function stub(record: { name: string; bytes: number }, input: unknown) {
  const arg = input && typeof input === "object" ? Object.values(input).find((value) => typeof value === "string") : undefined
  return `[output elided: ${record.name}${arg ? ` ${String(arg).slice(0, 80)}` : ""}, ${record.bytes} B — re-run the tool if needed]`
}

function toMessages(records: readonly SessionRecord[], pruned: number, summary: string | undefined, text: boolean) {
  const inputs = new Map(records.flatMap((record) => (record.type === "tool_call" ? [[record.call_id, record.input] as const] : [])))
  const parts = records.flatMap((record): Array<{ role: "user" | "assistant" | "tool"; part: Message["content"][number] }> => {
    if (record.type === "user" || record.type === "reminder") return [{ role: "user", part: Message.text(record.text) }]
    if (record.type === "text") return [{ role: "assistant", part: Message.text(record.text) }]
    // Text-protocol turns keep the call inside the assistant text; the call record is bookkeeping only.
    if (record.type === "tool_call")
      return text ? [] : [{ role: "assistant", part: { type: "tool-call", id: record.call_id, name: record.name, input: record.input } }]
    if (record.type !== "tool_result") return []
    const output = record.turn < pruned ? stub(record, inputs.get(record.call_id)) : record.output
    if (text) return [{ role: "user", part: Message.text(`<tool_result name="${record.name}">\n${output}\n</tool_result>`) }]
    const result = { type: record.status === "ok" ? ("text" as const) : ("error" as const), value: output }
    return [{ role: "tool", part: { type: "tool-result", id: record.call_id, name: record.name, result } }]
  })
  // Reasoning is kept in JSONL but not replayed: it has no provider signature and only costs context.
  const head = summary === undefined ? [] : [{ role: "user" as const, part: Message.text(summary) }]
  return [...head, ...parts].reduce<Message[]>((messages, item) => {
    const last = messages.at(-1)
    if (last && last.role === item.role && item.role !== "tool")
      return [...messages.slice(0, -1), Message.make({ role: item.role, content: [...last.content, item.part] })]
    return [...messages, Message.make({ role: item.role, content: [item.part] })]
  }, [])
}

function todos(records: readonly SessionRecord[]) {
  const last = records.findLast((record) => record.type === "tool_call" && record.name === "todowrite")
  const input = last?.type === "tool_call" ? last.input : undefined
  return input && typeof input === "object" && "todos" in input && Array.isArray(input.todos) ? input.todos : []
}
