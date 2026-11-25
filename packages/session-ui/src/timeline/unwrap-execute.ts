import type { JsonValue, SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { Option, Schema } from "effect"
import {
  createComputed,
  createMemo,
  createSignal,
  getOwner,
  mapArray,
  runWithOwner,
  untrack,
  type Accessor,
} from "solid-js"
import { changedFileDiff } from "../components/apply-patch-file"

/**
 * Prototype, desktop only and off by default: a Code Mode script draws as the calls it made rather than as one
 * `execute` block. Each assistant message's `execute` part is replaced by a tool part per entry of its
 * `metadata.toolCalls`, so the projections, facts and tool renderers treat them as direct calls: grouped, labelled and
 * placed by the Timeline detail setting. Each `metadata.files` entry goes to the call that made it, in order, so its
 * diff shows under that call; what no call claims follows the last one. The script's result ends its run.
 *
 * The parts stay the same objects while the script runs, and read the script's part as they are read, so a progress
 * report that adds no call moves no row.
 */

type Content = SessionMessageAssistant["content"][number]

type Tool = Extract<Content, { type: "tool" }>

type Json = { [key: string]: JsonValue }

/** The row that ends a script's run with what it returned or threw. */
export const scriptResultTool = "script-result"

/** The row that stands for a script moved to the background, which reports no calls. */
export const scriptBackgroundTool = "script-background"

/** A change a script made that no call row draws: a delete, a write without a diff, or one no call claimed. */
export const scriptFileTool = "script-file"

/** The session's messages with every script drawn as its calls. One wrapper per message, for the message's life. */
export function unwrapExecuteMessages(messages: Accessor<SessionMessageInfo[]>): Accessor<SessionMessageInfo[]> {
  return mapArray(messages, (message) => (message.type === "assistant" ? unwrapMessage(message) : message))
}

function unwrapMessage(message: SessionMessageAssistant): SessionMessageAssistant {
  // The message's parts live as long as its wrapper, and not as long as one run of the memo below.
  const owner = getOwner()
  const known = new Map<string, Tool>()

  const part = (script: Tool, key: string) => {
    const id = `${script.id}:${key}`
    const found = known.get(id)

    if (found) return found
    const made = runWithOwner(owner, () => scriptPart(script, key))!
    known.set(id, made)

    return made
  }

  // A progress report replaces the script's metadata, so this reruns on each one; it notifies only when the parts do.
  const content = createMemo(
    () =>
      message.content.flatMap((item) =>
        item.type === "tool" && item.name === "execute"
          ? rowKeys(readScript(item)).map((key) => part(item, key))
          : [item],
      ),
    undefined,
    {
      equals: (previous, next) =>
        previous.length === next.length && previous.every((item, index) => item === next[index]),
    },
  )

  return new Proxy(message, {
    // SAFETY: every other property is the message's own, read through as it is.
    get: (target, key) => (key === "content" ? content() : target[key as keyof SessionMessageAssistant]),
  })
}

// A call that only changed files draws as those changes where no row of its own would show them; an edit, write or
// patch keeps its row, as a direct one does.
function rowKeys(run: Run) {
  const fileKey = (index: number) => `file:${index}:${run.files[index]!.file}`

  return [
    ...run.calls.flatMap((call, index) => {
      const claimed = run.claimed.get(index) ?? []
      const plain = claimed.filter((entry) => !changedFileDiff(entry.raw))

      if (call.tool === "Bun" && claimed.length && plain.length === claimed.length)
        return plain.map((entry) => fileKey(entry.index))

      return [`call:${index}`, ...(call.tool === "Bun" ? plain.map((entry) => fileKey(entry.index)) : [])]
    }),
    ...run.leftover.map((entry) => fileKey(entry.index)),
    ...(run.jobID ? ["background"] : []),
    ...(run.result ? ["result"] : []),
  ]
}

/**
 * A part read live from the script's part. A signal says when what it shows changes, so a progress report that
 * changes nothing it shows notifies none of its readers; the value is read from the script itself, as `placeFacts`
 * does, since the signal learns of a change one computation after the write.
 */
function scriptPart(script: Tool, key: string): Tool {
  let last: { signature: string; view: View } | undefined

  const current = () => {
    const next = viewOf(script, key)
    const signature = JSON.stringify(next)

    if (last?.signature === signature) return last.view
    last = { signature, view: next }

    return next
  }

  const [changed, setChanged] = createSignal(untrack(current))
  createComputed(() => setChanged(current()))
  const view = () => (changed(), untrack(current))

  return {
    type: "tool",
    id: `${script.id}:${key}`,
    get name() {
      return view().name
    },
    get state() {
      return view().state
    },
    get time() {
      return view().time
    },
  }
}

type View = Pick<Tool, "name" | "state" | "time">

const decodeCall = Schema.decodeUnknownOption(
  Schema.Struct({
    tool: Schema.String,
    status: Schema.String,
    input: Schema.optional(
      Schema.Struct({
        path: Schema.optional(Schema.String),
        method: Schema.optional(Schema.String),
        patchText: Schema.optional(Schema.String),
      }),
    ),
  }),
)

const decodeJobID = Schema.decodeUnknownOption(Schema.String)

const decodeFile = Schema.decodeUnknownOption(
  Schema.Struct({ file: Schema.String, status: Schema.optional(Schema.String) }),
)

/** A call the script made: what matching and rows read of its input, and the input itself for the rest. */
type Call = { tool: string; status: string; path?: string; method?: string; patchText?: string; input: Json }

/** A change as the script logged it: its place in the log, what a row reads, and what matching reads. */
type FileEntry = { index: number; raw: JsonValue; file: string; status?: string }

type Run = ReturnType<typeof readScript>

function record(value: JsonValue | undefined): Json | undefined {
  // SAFETY: the script's metadata is JSON, so an object in it is a record of JSON values.
  return value && !Array.isArray(value) && value === Object(value) ? (value as Json) : undefined
}

function readScript(script: Tool) {
  const metadata: Json = ("metadata" in script.state && script.state.metadata) || {}
  const list = (value: JsonValue | undefined) => (Array.isArray(value) ? value : [])

  const calls = list(metadata.toolCalls).flatMap((item) =>
    Option.toArray(decodeCall(item)).map(
      (call): Call => ({
        tool: call.tool,
        status: call.status,
        ...call.input,
        input: record(record(item)?.input) ?? {},
      }),
    ),
  )

  const files = list(metadata.files).flatMap((raw, index) =>
    Option.toArray(decodeFile(raw)).map((file): FileEntry => ({ ...file, index, raw })),
  )

  const claimed = claim(calls, files)
  const status = script.state.status
  const jobID = Option.getOrUndefined(decodeJobID(metadata.jobID))

  // An interrupted script ends with the turn's own divider; a backgrounded one reports later, in its own message.
  const result = !jobID && (status === "completed" || (status === "error" && script.state.error.type !== "aborted"))

  return { calls, files, claimed: claimed.byCall, leftover: claimed.leftover, jobID, result, metadata }
}

/**
 * Gives each change to the call that made it. Changes are logged in the order they happened, so a call takes the
 * changes that come next and name its files: an edit, a write or a Bun write one, a patch one per file it names, and a
 * Bun file writer every flush. A change no call names stops the matching, and it and the rest follow the last call.
 */
function claim(calls: Call[], files: FileEntry[]) {
  const byCall = new Map<number, FileEntry[]>()
  let next = 0

  calls.forEach((call, index) => {
    const paths = callPaths(call)
    const limit = call.tool === "Bun" && call.method === "file" ? Infinity : paths.length
    const taken: FileEntry[] = []

    while (next < files.length && taken.length < limit && paths.some((path) => samePath(path, files[next]!.file)))
      taken.push(files[next++]!)

    if (taken.length) byCall.set(index, taken)
  })

  return { byCall, leftover: files.slice(next) }
}

function callPaths(call: Call): string[] {
  if (call.tool === "patch" && call.patchText)
    return [...call.patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1]!.trim())

  if (["edit", "write", "Bun"].includes(call.tool) && call.path) return [call.path]

  return []
}

// A change names its file from the parent of the project directory; a call names it in full.
function samePath(path: string, file: string) {
  return path === file || path.endsWith(`/${file}`)
}

function viewOf(script: Tool, key: string): View {
  const run = readScript(script)
  const settled = script.state.status === "completed" || script.state.status === "error"

  // A call reports no times of its own: each takes the script's, and finishes with it.
  const time: Tool["time"] = { created: script.time.created }

  if (script.time.ran !== undefined) time.ran = script.time.ran

  if (settled && script.time.completed !== undefined) time.completed = script.time.completed

  if (key === "result") return { name: scriptResultTool, time, state: resultState(script, run.metadata) }

  if (key === "background") return { name: scriptBackgroundTool, time, state: resultState(script, run.metadata) }

  if (key.startsWith("file:")) {
    const entry = run.files[Number(key.split(":")[1])]

    return {
      name: scriptFileTool,
      time,
      state: callState(script, settled ? "completed" : "running", {}, { files: entry ? [entry.raw] : [] }),
    }
  }

  const index = Number(key.slice("call:".length))

  return { time, ...callView(script, run.calls[index]!, run.claimed.get(index) ?? []) }
}

// TODO: a call reports no output, so an opened row shows its full input: the command, the patch or the content.
function callView(script: Tool, call: Call, claimed: FileEntry[]): Pick<Tool, "name" | "state"> {
  const files = claimed.flatMap((entry) => (changedFileDiff(entry.raw) ? [entry.raw] : []))
  const metadata: Json = files.length ? { files } : {}
  const path = call.path

  // A Bun write reports its diff but not its content, which the patch row draws and the write row does not.
  if (call.tool === "Bun" && files.length)
    return { name: "patch", state: callState(script, call.status, path ? { path } : {}, metadata) }

  if (call.tool === "Bun" && call.method === "write")
    return { name: "write", state: callState(script, call.status, path ? { path } : {}, {}) }

  if (call.tool === "Bun" && call.method === "file")
    return { name: "read", state: callState(script, call.status, path ? { path } : {}, {}) }

  if (call.tool === "fetch") return { name: "webfetch", state: callState(script, call.status, call.input, {}) }

  return { name: call.tool, state: callState(script, call.status, call.input, metadata) }
}

function callState(script: Tool, status: string, input: Json, metadata: Json): Tool["state"] {
  const state = script.state
  const stopped = state.status === "error" && state.error.type === "aborted" ? state.error : undefined

  if (status === "completed") return { status: "completed", input, metadata, content: [{ type: "text", text: "" }] }

  if (status === "error" || (status === "running" && state.status !== "running"))
    return { status: "error", input, metadata, error: stopped ?? { type: "unknown", message: "" } }

  return { status: "running", input, metadata }
}

function resultState(script: Tool, metadata: Json): Tool["state"] {
  const state = script.state
  const content = "content" in state && state.content ? state.content : undefined

  if (state.status === "error")
    return {
      status: "completed",
      input: {},
      metadata: { error: true },
      content: content ?? [{ type: "text", text: state.error.message }],
    }

  return {
    status: "completed",
    input: {},
    metadata: metadata.error === true ? { error: true } : {},
    content: content ?? [{ type: "text", text: "" }],
  }
}
