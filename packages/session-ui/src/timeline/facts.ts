import type { SessionMessageAssistant } from "@opencode/client/promise"
import { getFilename } from "@opencode/util/path"
import { Option, Schema } from "effect"
import { currentToolFailed, currentToolInput, currentToolMetadata } from "../message/current-tool-state"
import type { TimelineDetail } from "./detail"
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
  | (Content & { id?: string; messageID?: string })
  | { type: "shell"; id: string; messageID?: string }
  | { type: "notice"; id: string; messageID?: string }
  | { type: "outcome"; id: string; messageID?: string; outcome: FactOutcome }

export type CallFact = {
  kind: "call"
  id: string
  /** The tool's current name; `tool` keeps the name the call used. */
  name: string
  tool: string
  mode: FactMode
  status: Tool["state"]["status"] | "user"
  failed: boolean
  /** Runs on after the call returns, reporting back as an outcome. */
  background: boolean
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
  by: string
  via: "direct"
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
 * says nothing about whether its facts changed. Callers read it inside a memo.
 */
export function factsOf(parts: readonly FactPart[]): Fact[] {
  return parts.flatMap(partFacts)
}

function partFacts(part: FactPart): Fact[] {
  const id = part.messageID ? `${part.messageID}:${part.id ?? ""}` : (part.id ?? "")

  if (part.type === "text") return [{ kind: "text", id }]

  if (part.type === "reasoning") return [{ kind: "thought", id }]

  if (part.type === "notice") return []

  if (part.type === "outcome") return [{ kind: "outcome", id, outcome: part.outcome }]

  if (part.type === "shell")
    return [
      { kind: "call", id, name: "shell", tool: "shell", mode: "run", status: "user", failed: false, background: false },
    ]

  return toolFacts(part, id)
}

const decodeInput = Schema.decodeUnknownOption(
  Schema.Struct({ path: Schema.optional(Schema.String), background: Schema.optional(Schema.Unknown) }),
)

const decodeMetadata = Schema.decodeUnknownOption(
  Schema.Struct({
    provider: Schema.optional(Schema.String),
    toolCalls: Schema.optional(Schema.Number),
    matches: Schema.optional(Schema.Number),
  }),
)

const decodeFile = Schema.decodeUnknownOption(
  Schema.Struct({
    file: Schema.String,
    additions: Schema.optional(Schema.Number),
    deletions: Schema.optional(Schema.Number),
  }),
)

const decodeFiles = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown))

const decodeText = Schema.decodeUnknownOption(Schema.NonEmptyString)

function toolFacts(tool: Tool, id: string): Fact[] {
  const name = toolName(tool.name)

  const input = Option.getOrElse(decodeInput(currentToolInput(tool)), () => ({
    path: undefined,
    background: undefined,
  }))

  const metadata = currentToolMetadata(tool)
  const details = Option.getOrUndefined(decodeMetadata(metadata))
  const state = tool.state
  const background = name === "subagent" || (name === "shell" && input.background === true)
  const path = input.path || undefined
  const mode = modes.get(name) ?? "tool"

  const call: CallFact = {
    kind: "call",
    id,
    name,
    tool: tool.name,
    mode,
    status: state.status,
    failed: !stopped(tool) && currentToolFailed({ ...tool, name }),
    background,
  }

  if (path) call.path = path

  if (details?.provider) call.provider = details.provider

  if (background) call.launch = launch(tool, name)

  if ("time" in state && state.time) call.time = state.time

  if (details?.toolCalls !== undefined) call.toolCalls = details.toolCalls

  if (details?.matches !== undefined) call.matches = details.matches

  if (mode !== "edit") return [call]

  const changed = Option.getOrElse(decodeFiles(metadata.files), () => []).flatMap((file) =>
    Option.toArray(decodeFile(file)),
  )

  const files = changed.length ? changed : path ? [{ file: path }] : []

  return [
    call,
    ...files.map((file): FileFact => {
      const fact: FileFact = {
        kind: "file",
        id: `${id}:file:${file.file}`,
        path: file.file,
        status: state.status,
        by: id,
        via: "direct",
      }

      if (file.additions !== undefined) fact.additions = file.additions

      if (file.deletions !== undefined) fact.deletions = file.deletions

      return fact
    }),
  ]
}

// How a call that launches background work ended. Older sessions marked a foreground subagent's result as completed.
function launch(tool: Tool, name: string): FactOutcome | undefined {
  const kind = name === "shell" ? "shell" : "subagent"
  const state = tool.state

  if (state.status === "streaming") return undefined
  const input = currentToolInput(tool)
  const metadata = currentToolMetadata(tool)
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

function stopped(tool: Tool) {
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

/** The detail setting that shows or hides a fact. */
export function categoryOf(fact: Fact): keyof TimelineDetail | undefined {
  if (fact.kind === "thought") return "thinking"

  if (fact.kind === "file") return "edit"

  if (fact.kind === "outcome") return "notices"

  if (fact.kind !== "call") return

  if (fact.name === "shell" || fact.name === "execute") return "shell"

  if (fact.mode === "edit") return "edit"

  if (fact.name === "subagent") return "subagents"

  return "tools"
}
