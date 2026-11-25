import type { SessionMessageInfo } from "@opencode/client/promise"
import type { SessionDocument } from "../../document"

/**
 * Code Mode `execute` parts captured from real core and server runs (origin/dev 7b8a065e29, opencode-drive with its
 * simulated model). Each scenario holds `GET /api/session/:id/message` as returned (newest first) and the tool part as
 * the client store held it after each event that changed it. The drive run directory is shortened to `/repo`, and the
 * 300 KB string literal in `large-patch`'s script is replaced by the expression that builds it.
 */
export type CodeModeToolPart = Extract<
  Extract<SessionMessageInfo, { type: "assistant" }>["content"][number],
  { type: "tool" }
>

export type CodeModeState = {
  file: string
  /** `called`, `first-progress`, `progress`, `files-N` or `final`. */
  reason: string
  at: number
  eventIndex: number
  part: CodeModeToolPart
}

type Capture = {
  session: { id: string; title: string; directory: string; time: { created: number; updated: number } }
  messages: { data: SessionMessageInfo[]; cursor?: unknown }
  states: CodeModeState[]
}

const captures = new Map(
  Object.entries(import.meta.glob<Capture>("./*.json", { eager: true, import: "default" })).map(([path, capture]) => [
    path.slice(2, -".json".length),
    capture,
  ]),
)

export const codeModeScenarios = [
  { name: "running", description: "Sleeps between writes, so files grow 1, 2, 3 while it runs and 4 at the end." },
  { name: "edits-patch", description: "Two patches to one file, a Bun write and a delete. app.ts is listed twice." },
  { name: "edits-editwrite", description: "Inner edit and write calls. Too fast for files to show before the final." },
  { name: "appends", description: "Writer flushes, one entry each with no patch, and a binary logo.png." },
  { name: "many-calls", description: "85 inner reads, past the toolCalls display cap." },
  { name: "errors", description: "A caught failing read, then a write and an edit before the script throws." },
  { name: "interrupted", description: "Interrupted during a sleep. The error part keeps the last progress metadata." },
  { name: "backgrounded", description: "background: true. The final part has only jobID; the result comes later." },
  { name: "timeout-bg", description: "timeout: 1500 moves the script to the background partway through." },
  { name: "large-patch", description: "A 6000-line write over the 200 KB budget: counts but no patch." },
  { name: "shell-truncated", description: "An inner shell with truncated output, visible only in the returned value." },
  { name: "direct", description: "Direct edit and write tools with Code Mode off. A direct write has no files." },
  { name: "direct-patch", description: "Two direct patch calls, each with metadata.files." },
] as const

export type CodeModeScenario = (typeof codeModeScenarios)[number]["name"]

function capture(name: CodeModeScenario) {
  const found = captures.get(name)

  if (!found) throw new Error(`No captured Code Mode scenario ${name}`)

  return found
}

export const codeModeSession = (name: CodeModeScenario) => capture(name).session

/** The session's messages in time order. */
export const codeModeMessages = (name: CodeModeScenario) => [...capture(name).messages.data].reverse()

export const codeModeStates = (name: CodeModeScenario) => capture(name).states

/**
 * The session as the timeline reads it. With a state file the session is cut at that moment: messages after the
 * part's assistant message are dropped, the part is the client-store snapshot, and later content in that message is
 * removed. While the part is running, the message is still open. `now` moves every timestamp so that moment is now, which keeps running durations realistic.
 */
export function codeModeDocument(
  name: CodeModeScenario,
  stateFile?: string,
  options: { now?: number } = {},
): SessionDocument {
  const session = capture(name).session
  let list = codeModeMessages(name)
  let busy = false
  let moment = Math.max(...list.map((message) => message.time.created))

  if (stateFile) {
    const state = codeModeStates(name).find((item) => item.file === stateFile || item.file.startsWith(stateFile))

    if (!state) throw new Error(`No state ${stateFile} in ${name}`)

    const at = list.findIndex(
      (message) =>
        message.type === "assistant" &&
        message.content.some((part) => part.type === "tool" && part.id === state.part.id),
    )

    // SAFETY: `at` is the assistant message that holds the part, found just above.
    const message = structuredClone(list[at]) as Extract<SessionMessageInfo, { type: "assistant" }>
    const index = message.content.findIndex((part) => part.type === "tool" && part.id === state.part.id)

    message.content = [...message.content.slice(0, index), structuredClone(state.part)]
    busy = state.part.state.status === "running" || state.part.state.status === "streaming"

    // What the end of the step sets had not happened yet. load.ts keeps `error`, which drew an interrupted turn
    // while the script was still running.
    if (busy) {
      delete message.time.completed
      delete message.finish
      delete message.rawFinish
      delete message.error
    }

    list = [...list.slice(0, at), message]
    moment = state.at
  }

  const messages = options.now === undefined ? list : shiftTimes(list, options.now - moment)

  return {
    sessionID: session.id,
    messages,
    status: busy ? { type: "busy" } : { type: "idle" },
    diffs: [],
  }
}

function shiftTimes(messages: SessionMessageInfo[], delta: number): SessionMessageInfo[] {
  return messages.map((message) => {
    if (message.type !== "assistant") return { ...message, time: shift(message.time, delta) }

    return {
      ...message,
      time: shift(message.time, delta),
      content: message.content.map((part) =>
        part.type === "tool" ? { ...part, time: shift(part.time, delta) } : part,
      ),
    }
  })
}

function shift<T extends object>(time: T, delta: number): T {
  // SAFETY: every field of a message's or a tool part's `time` is epoch milliseconds.
  return Object.fromEntries(Object.entries(time).map(([key, value]) => [key, (value as number) + delta])) as T
}

/** The `execute` metadata fields this capture holds, as `core/src/codemode/tool.ts` writes them. */
export type CodeModeMetadata = {
  toolCalls?: { tool: string; status: string }[]
  files?: { file: string; status?: string; additions?: number; deletions?: number; patch?: string }[]
  background?: boolean
  jobID?: string
  error?: boolean
  truncated?: boolean
}

export function codeModeMetadata(part: CodeModeToolPart): CodeModeMetadata {
  const state = part.state

  if (state.status !== "running" && state.status !== "completed" && state.status !== "error") return {}

  // SAFETY: the fixtures are the captured parts, whose metadata is Code Mode's output schema (tool.ts:47-52) or a
  // direct edit or patch part's `files`.
  return (state.metadata ?? {}) as CodeModeMetadata
}
