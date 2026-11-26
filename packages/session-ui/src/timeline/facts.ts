import type { SessionMessageAssistant } from "@opencode/client/promise"
import { getFilename } from "@opencode/util/path"
import { Option, Predicate, Schema } from "effect"
import {
  currentToolFailed,
  currentToolHasLoadedFiles,
  currentToolInput,
  currentToolMetadata,
  executeToolCalls,
  readImagePath,
} from "../message/current-tool-state"
import { isInterruptedError } from "./turn-phase-machine"

/**
 * What the agent did, read only from message parts. Every count or summary a timeline shows comes from `summarize`,
 * never from the rows and groups the timeline happens to draw.
 */

type Content = SessionMessageAssistant["content"][number]

type Tool = Extract<Content, { type: "tool" }>

export type FactMode = "explore" | "edit" | "run" | "tool"

export type FactVerb = "started" | "ran" | "finished" | "stopped" | "updated"

/** Work that reports back where it ends: a background shell or a subagent. */
export type FactOutcome = { kind: "shell" | "subagent"; verb: FactVerb; failed: boolean; key?: string }

/** What facts are read from: a message part, a user's shell command, or what background work reported. */
export type FactPart =
  | (Tool & { id?: string; messageID?: string })
  | { type: "text"; id?: string; messageID?: string; text?: string }
  | { type: "reasoning"; id?: string; messageID?: string; text?: string }
  | { type: "shell"; id: string; messageID?: string }
  | { type: "notice"; id: string; messageID?: string }
  | { type: "outcome"; id: string; messageID?: string; outcome: FactOutcome }

/** What placing a call reads: where it shows, which group it joins and whether it starts open. */
export type PlaceFact = {
  kind: "call"
  id: string
  /** The tool's current name; `tool` keeps the name the call used. */
  name: string
  tool: string
  mode: FactMode
  status: Tool["state"]["status"] | "user"
  failed: boolean
  /** The user stopped it, by stopping the turn or cancelling its command. */
  stopped: boolean
  /** The model finished writing what to call it with. */
  called: boolean
  /** A plain file read, which reads well beside the reads around it. */
  groupedRead: boolean
  /** Runs on after the call returns, reporting back as an outcome. */
  background: boolean
  /** The changes a finished foreground script made to files, each placed like a direct edit's file. */
  changes: number
}

export type CallFact = PlaceFact & {
  path?: string
  provider?: string
  /** How a call that launches background work ended, or undefined while it is still written. */
  launch?: FactOutcome
  time?: { started?: number; completed?: number }
  toolCalls?: number
  matches?: number
}

export type FileFact = {
  kind: "file"
  id: string
  path: string
  status: Tool["state"]["status"]
  additions?: number
  deletions?: number
  /** How the file changed, and its diff, where the call recorded them. */
  change?: "added" | "deleted" | "modified"
  patch?: string
  by: string
  /** A call that edits files, or a script that changed them as it ran. */
  via: "direct" | "script"
}

export type Fact =
  | CallFact
  | FileFact
  | { kind: "thought"; id: string }
  | { kind: "text"; id: string }
  | { kind: "outcome"; id: string; outcome: FactOutcome }
  | { kind: "error"; id: string }

const renamed = new Map([
  ["bash", "shell"],
  ["task", "subagent"],
  ["apply_patch", "patch"],
])

/** A tool's current name. Sessions migrated from v1 keep the tools' old names. */
export function toolName(name: string) {
  return renamed.get(name) ?? name
}

const modes = new Map<string, FactMode>(
  Object.entries({
    read: "explore",
    list: "explore",
    glob: "explore",
    grep: "explore",
    webfetch: "explore",
    websearch: "explore",
    skill: "explore",
    edit: "edit",
    write: "edit",
    patch: "edit",
    shell: "run",
    execute: "run",
  } satisfies Record<string, FactMode>),
)

/**
 * The facts in a list of parts, in order. Not cached: stores update a part in place as it streams, so its identity
 * says nothing about whether its facts changed. Callers read it inside a memo. Without `scriptDiffs` (the server's
 * `full_codemode` flag off), a script's changes are not facts: they neither show nor count. With `scriptSteps`, a script
 * counts as the calls it made rather than as itself.
 */
export function factsOf(parts: readonly FactPart[], scriptDiffs = true, scriptSteps = false): Fact[] {
  return parts.flatMap((part) => partFacts(part, scriptDiffs, scriptSteps))
}

function partFacts(part: FactPart, scriptDiffs: boolean, scriptSteps: boolean): Fact[] {
  const id = part.messageID ? `${part.messageID}:${part.id ?? ""}` : (part.id ?? "")

  if (part.type === "text") return [{ kind: "text", id }]

  if (part.type === "reasoning") return [{ kind: "thought", id }]

  if (part.type === "notice") return []

  if (part.type === "outcome") return [{ kind: "outcome", id, outcome: part.outcome }]

  if (part.type === "shell")
    return [
      {
        kind: "call",
        id,
        name: "shell",
        tool: "shell",
        mode: "run",
        status: "user",
        failed: false,
        stopped: false,
        called: true,
        groupedRead: false,
        background: false,
        changes: 0,
      },
    ]

  return toolFacts(part, id, scriptDiffs, scriptSteps)
}

const decodeFile = Schema.decodeUnknownOption(
  Schema.Struct({
    file: Schema.String,
    additions: Schema.optional(Schema.Number),
    deletions: Schema.optional(Schema.Number),
    status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
    patch: Schema.optional(Schema.String),
  }),
)

const decodeScript = Schema.decodeUnknownOption(
  Schema.Struct({ background: Schema.optional(Schema.Unknown), jobID: Schema.optional(Schema.Unknown) }),
)

const decodeFiles = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown))

const decodeText = Schema.decodeUnknownOption(Schema.NonEmptyString)

type Reads = { input: () => Schema.JsonObject; metadata: () => Schema.JsonObject }

// Input changes with every streamed delta and metadata with every progress report, so each is read only where it is
// needed, and once.
function reads(tool: Tool): Reads {
  let input: Schema.JsonObject | undefined
  let metadata: Schema.JsonObject | undefined

  return {
    input: () => (input ??= currentToolInput(tool)),
    metadata: () => (metadata ??= currentToolMetadata(tool)),
  }
}

/**
 * What placing a call reads of it. Reads input and metadata only where they can move the call or open it. Without
 * `scriptDiffs`, a script places no changes.
 */
export function placeFactOf(tool: Tool, id = tool.id, scriptDiffs = true): PlaceFact {
  return placeFact(tool, id, reads(tool), scriptDiffs)
}

function placeFact(tool: Tool, id: string, read: Reads, scriptDiffs = true): PlaceFact {
  const name = toolName(tool.name)
  const state = tool.state
  const stopped = toolStopped(tool)

  return {
    kind: "call",
    id,
    name,
    tool: tool.name,
    mode: modes.get(name) ?? "tool",
    status: state.status,
    failed: !stopped && currentToolFailed({ ...tool, name }),
    stopped,
    called: state.status !== "streaming" && (state.status !== "error" || Object.keys(read.input()).length > 0),
    groupedRead:
      tool.name === "read" &&
      state.status !== "error" &&
      !readImagePath(read.input()) &&
      !currentToolHasLoadedFiles(tool),
    background: name === "subagent" || (name === "shell" && read.input().background === true),
    changes: name === "execute" && scriptDiffs ? scriptChanges(tool, read).length : 0,
  }
}

// Whether a script that fails or is stopped keeps the changes it made, which really happened.
const keepFailedScriptChanges = true

// A script reports the files it changes as it runs and when it ends in the foreground; one moved to the background has
// none. Placement reads only their count, so progress reports that add no change never move it. Entries that don't
// decode are dropped here, so every reader numbers the changes alike.
function scriptChanges(tool: Tool, read: Reads) {
  const status = tool.state.status

  if (status !== "running" && status !== "completed" && !(status === "error" && keepFailedScriptChanges)) return []
  const metadata = read.metadata()
  const script = Option.getOrUndefined(decodeScript(metadata))

  // Until a script finishes, its background flag says only that it can move there: one stopped or declined keeps it.
  if (script?.jobID !== undefined || (status === "completed" && script?.background === true)) return []

  return Option.getOrElse(decodeFiles(metadata.files), () => [])
    .flatMap((file) => Option.toArray(decodeFile(file)))
    .filter((file) => file.file !== "")
}

/** The paths of the changes a finished script made, in order. */
export function scriptChangePaths(tool: Tool) {
  return scriptChanges(tool, reads(tool)).map((file) => file.file)
}

/** How a call that launches background work ended, or undefined for any other call or while it is still written. */
export function launchOf(tool: Tool) {
  const read = reads(tool)

  return placeFact(tool, tool.id, read).background ? launch(tool, toolName(tool.name), read) : undefined
}

function toolFacts(tool: Tool, id: string, scriptDiffs: boolean, scriptSteps = false): Fact[] {
  const read = reads(tool)
  const fact = placeFact(tool, id, read, scriptDiffs)
  const raw = read.input().path
  const path = Predicate.isString(raw) && raw ? raw : undefined
  const metadata = read.metadata()
  const state = tool.state
  const call: CallFact = { ...fact }

  if (path) call.path = path

  // Each field is read on its own, so one of the wrong type leaves the others.
  if (Predicate.isString(metadata.provider) && metadata.provider) call.provider = metadata.provider

  if (fact.background) call.launch = launch(tool, fact.name, read)

  if ("time" in state && state.time) call.time = state.time

  // A script lists the calls it made; their count is how many it made.
  if (Array.isArray(metadata.toolCalls)) call.toolCalls = metadata.toolCalls.length

  if (Predicate.isNumber(metadata.matches)) call.matches = metadata.matches

  if (fact.name === "execute" && !scriptDiffs) return [call]

  if (fact.name === "execute")
    return [
      ...(scriptSteps ? stepFacts(tool, id) : [call]),
      // One fact per change, in order: a script can change the same file more than once.
      ...scriptChanges(tool, read).map((file, index) => scriptFileFactOf(file, index, id, state.status)),
    ]

  if (fact.mode !== "edit") return [call]

  const changed = Option.getOrElse(decodeFiles(metadata.files), () => []).flatMap((file) =>
    Option.toArray(decodeFile(file)),
  )

  const files = changed.length ? changed : path ? [{ file: path }] : []

  return [call, ...files.map((file) => fileFact(file, id, state.status, "direct"))]
}

// A script's steps, each counted as a direct call of its tool. Edits count by the files the script changed instead, and
// `Bun` file calls are not tools, so neither adds a call.
function stepFacts(tool: Tool, id: string): CallFact[] {
  return executeToolCalls(currentToolMetadata(tool)).flatMap(({ index, call }) => {
    const name = toolName(call.tool)
    const mode = modes.get(name) ?? "tool"

    if (mode === "edit" || call.tool === "Bun") return []

    const input = call.input ?? {}

    const fact: CallFact = {
      kind: "call",
      id: `${id}:step:${index}`,
      name,
      tool: call.tool,
      mode,
      status: call.status,
      failed: call.status === "error",
      stopped: false,
      called: true,
      groupedRead: name === "read",
      background: name === "shell" && input.background === true,
      changes: 0,
    }

    if (Predicate.isString(input.path) && input.path) fact.path = input.path

    return [fact]
  })
}

function fileFact(
  file: { file: string; additions?: number; deletions?: number; status?: FileFact["change"]; patch?: string },
  by: string,
  status: Tool["state"]["status"],
  via: FileFact["via"],
): FileFact {
  const fact: FileFact = { kind: "file", id: `${by}:file:${file.file}`, path: file.file, status, by, via }

  if (file.additions !== undefined) fact.additions = file.additions

  if (file.deletions !== undefined) fact.deletions = file.deletions

  if (file.status !== undefined) fact.change = file.status

  if (file.patch !== undefined) fact.patch = file.patch

  return fact
}

// How a call that launches background work ended. Older sessions marked a foreground subagent's result as completed.
function launch(tool: Tool, name: string, read: Reads): FactOutcome | undefined {
  const kind = name === "shell" ? "shell" : "subagent"
  const state = tool.state

  if (state.status === "streaming") return undefined
  const input = read.input()
  const metadata = read.metadata()
  const followUp = kind === "subagent" ? Option.getOrUndefined(decodeText(input.sessionID)) : undefined

  const id =
    kind === "shell"
      ? Option.getOrUndefined(decodeText(metadata.shellID))
      : (Option.getOrUndefined(decodeText(metadata.sessionID)) ?? followUp)

  const key = id ? `${kind}:${id}` : undefined

  if (state.status === "running") return { kind, key, verb: followUp ? "updated" : "started", failed: false }

  const background =
    kind === "subagent" ? metadata.status !== "completed" : metadata.status === "running" || input.background === true

  if (state.status === "error") {
    if (state.error.type === "aborted") return { kind, key, verb: "stopped", failed: false }

    return { kind, key, verb: background ? "started" : "ran", failed: true }
  }

  if (followUp) return { kind, key, verb: "updated", failed: false }

  return { kind, key, verb: background ? "started" : "ran", failed: false }
}

/**
 * Whether the user stopped a call, by stopping the turn or cancelling its command. The shell reports a cancelled
 * command as its own error, "Command cancelled".
 */
export function toolStopped(tool: Tool) {
  if (tool.state.status !== "error") return false

  return isInterruptedError(tool.state.error) || tool.state.error.message === "Command cancelled"
}

export type ShellVerb = Exclude<FactVerb, "updated">

export type Summary = {
  /** Every call, a user's shell command included. */
  calls: number
  /** Each call's tool once, as the call named it, in order. */
  toolNames: { tool: string; provider?: string }[]
  /** Calls by mode, leaving out work that runs on in the background. */
  modes: Record<FactMode, number>
  /** The current names of the other tools used, once each. */
  tools: string[]
  /** Paths read, once each. A read still being written counts once, without a path. */
  reads: number
  /** Named files read, once each. */
  readFiles: string[]
  searches: number
  pages: number
  webSearches: number
  skills: number
  commands: number
  /** Files changed, once each. */
  files: string[]
  thoughts: number
  /** Background shells by how they ended, in the order they happened. Each one counts once. */
  background: { verbs: { verb: ShellVerb; count: number }[]; failed: number }
  failed: number
}

/** Counts what a list of facts did. Nothing else counts. */
export function summarize(facts: readonly Fact[]): Summary {
  const calls = facts.flatMap((fact) => (fact.kind === "call" ? [fact] : []))
  const foreground = calls.filter((call) => !call.background)
  const count = (names: string[]) => foreground.filter((call) => names.includes(call.name)).length
  const reads = foreground.filter((call) => call.tool === "read")

  const toolNames = new Map(
    calls.map((call) => [`${call.tool}:${call.provider ?? ""}`, { tool: call.tool, provider: call.provider }]),
  )

  return {
    calls: calls.length,
    toolNames: [...toolNames.values()],
    modes: {
      explore: foreground.filter((call) => call.mode === "explore").length,
      edit: foreground.filter((call) => call.mode === "edit").length,
      run: foreground.filter((call) => call.mode === "run").length,
      tool: foreground.filter((call) => call.mode === "tool").length,
    },
    tools: [...new Set(foreground.flatMap((call) => (call.mode === "tool" ? [call.name] : [])))],
    reads: new Set(reads.map((call) => call.path)).size,
    readFiles: [...new Set(reads.flatMap((call) => (call.path && getFilename(call.path) ? [call.path] : [])))],
    searches: count(["glob", "grep", "list"]),
    pages: count(["webfetch"]),
    webSearches: count(["websearch"]),
    skills: count(["skill"]),
    commands: foreground.filter((call) => call.mode === "run").length,
    files: [...new Set(facts.flatMap((fact) => (fact.kind === "file" ? [fact.path] : [])))],
    thoughts: facts.filter((fact) => fact.kind === "thought").length,
    background: shells(facts),
    failed: calls.filter((call) => call.failed).length,
  }
}

// Work that reports back in the same facts that launched it counts once, as how it ended.
function shells(facts: readonly Fact[]) {
  const launched = new Set(facts.flatMap((fact) => (fact.kind === "call" && fact.launch?.key ? [fact.launch.key] : [])))

  const reports = new Map(
    facts.flatMap((fact) =>
      fact.kind === "outcome" && fact.outcome.key ? [[fact.outcome.key, fact.outcome] as const] : [],
    ),
  )

  const outcomes = facts.flatMap((fact): FactOutcome[] => {
    if (fact.kind === "outcome") return fact.outcome.key && launched.has(fact.outcome.key) ? [] : [fact.outcome]

    if (fact.kind !== "call" || !fact.launch) return []
    const report = fact.launch.key ? reports.get(fact.launch.key) : undefined

    return [
      report && fact.launch.verb === "started"
        ? { ...fact.launch, verb: report.verb, failed: report.failed }
        : fact.launch,
    ]
  })

  const counts = new Map<ShellVerb, number>()
  const list = outcomes.filter((outcome) => outcome.kind === "shell")

  list.forEach(({ verb }) => {
    if (verb !== "updated") counts.set(verb, (counts.get(verb) ?? 0) + 1)
  })

  return {
    verbs: Array.from(counts, ([verb, count]) => ({ verb, count })),
    failed: list.filter((outcome) => outcome.failed).length,
  }
}

/** Where a script's change stands in a message: its part id is the script's, then the change's place and path. */
export function scriptFilePartID(scriptID: string, index: number, path: string) {
  return `${scriptID}:file:${index}:${path}`
}

function scriptFileFactOf(
  file: Parameters<typeof fileFact>[0],
  index: number,
  by: string,
  status: Tool["state"]["status"],
): FileFact {
  return { ...fileFact(file, by, status, "script"), id: `${by}:file:${index}:${file.file}` }
}

const fileFactKeys = ["id", "path", "status", "additions", "deletions", "change", "patch", "by", "via"] as const

/** Whether two reads of a change show the same: a script's changes never change once made, only its status does. */
export function sameFileFact(previous: FileFact, next: FileFact) {
  return fileFactKeys.every((key) => previous[key] === next[key])
}

const scriptFilePart = /^(.*?):file:(\d+):/

/** Whether a part id names a change a script made, which draws as part of the script's block. */
export function isScriptFilePartID(partID: string) {
  return scriptFilePart.test(partID)
}

/** The change a script made that a part id names, read from that one entry of the script's part in the message. */
export function scriptFileFact(content: readonly Content[], messageID: string, partID: string) {
  const match = scriptFilePart.exec(partID)

  if (!match) return undefined
  const [, scriptID, index] = match
  const tool = content.find((item) => item.type === "tool" && item.id === scriptID)

  if (tool?.type !== "tool") return undefined
  const file = scriptChanges(tool, reads(tool))[Number(index)]

  return file ? scriptFileFactOf(file, Number(index), `${messageID}:${scriptID}`, tool.state.status) : undefined
}
