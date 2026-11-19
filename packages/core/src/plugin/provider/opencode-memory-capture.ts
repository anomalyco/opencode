export * as OpencodeMemoryCapture from "./opencode-memory-capture.js"

import { Option, Schema } from "effect"

/**
 * One thing a session did, as the harness saw it: recorded every turn, mechanically, without a model. `prompt` is the
 * user's message, `shell` a finished command, `edit` and `read` the files a tool changed or read, `commit` a commit
 * the session made, `subtask` a subagent finishing, `compaction` the conversation being compacted.
 */
export type Event =
  | { readonly type: "prompt"; readonly text: string; readonly correction: boolean }
  | {
      readonly type: "shell"
      readonly command: string
      readonly exit: number
      readonly failed: boolean
      readonly test: boolean
      /** The end of what it printed, where errors and test results are. */
      readonly tail: string
    }
  | { readonly type: "edit"; readonly files: ReadonlyArray<string> }
  | { readonly type: "read"; readonly files: ReadonlyArray<string> }
  | { readonly type: "commit"; readonly sha: string }
  | { readonly type: "subtask" }
  | { readonly type: "compaction" }

/** A work-unit boundary the harness sees, where what happened since the last one may hold a lesson. */
export type Boundary = "task" | "commit" | "test" | "correction" | "subtask" | "compaction"

/**
 * The boundary `event` closes after `segment`, the events since the last one, or undefined. A new task message, a
 * commit, a test-like run passing after one failed, a user's correction, a subagent finishing, and compaction as a
 * backstop. Only a commit or a passing run closes a segment without work (no command run, no file changed): a message
 * that reads as a correction corrects work.
 */
export function boundary(segment: ReadonlyArray<Event>, event: Event): Boundary | undefined {
  const worked = segment.some((item) => item.type === "shell" || item.type === "edit")
  if (event.type === "commit") return "commit"
  if (event.type === "shell" && event.test && !event.failed)
    return segment.some((item) => item.type === "shell" && item.test && item.failed) ? "test" : undefined
  if (!worked) return undefined
  if (event.type === "prompt") return event.correction ? "correction" : "task"
  if (event.type === "subtask") return "subtask"
  if (event.type === "compaction") return "compaction"
  return undefined
}

const MAX_LOG = 16_000

/** The segment as the distiller reads it: one line per event, newest kept when it's long. */
export function render(segment: ReadonlyArray<Event>) {
  const lines = segment.map((event, index) => {
    const at = `#${index + 1}`
    if (event.type === "prompt") return `${at} user${event.correction ? " (correcting)" : ""}: ${event.text}`
    if (event.type === "shell")
      return `${at} ran \`${event.command}\` → exit ${event.exit}${event.failed ? " FAILED" : ""}\n${event.tail}`
    if (event.type === "edit") return `${at} changed ${event.files.join(", ")}`
    if (event.type === "read") return `${at} read ${event.files.join(", ")}`
    if (event.type === "commit") return `${at} committed ${event.sha}`
    if (event.type === "subtask") return `${at} a subtask finished`
    return `${at} the conversation was compacted`
  })
  const kept = lines.reduceRight<string[]>(
    (all, line) => (all.join("\n").length + line.length > MAX_LOG ? all : [line, ...all]),
    [],
  )
  return kept.join("\n")
}

/** The distiller's instructions: at most a few typed candidates, usually none. */
export function prompt(input: { readonly segment: ReadonlyArray<Event>; readonly boundary: Boundary }) {
  return [
    "You read the record of a coding agent's work since its last work boundary and propose lessons for the team's shared memory. Most records yield nothing: then answer {\"candidates\": []}.",
    "Propose only a verified, non-obvious finding that an agent on a DIFFERENT task in this repository would need, as it holds for the repository as committed: a cause found behind a failure, a dead end and why, a command or setting the repository needs, a correction the user made. Use only what the record shows; never guess. Never: task status or a summary of the change, what the code or docs already say, facts about this machine, files the agent added and didn't commit, secrets.",
    'Answer only JSON: {"candidates": [{"kind": "bug|convention|procedure|gotcha|decision|failed-approach", "title": "...", "body": "...", "paths": ["repository-relative paths"], "errors": ["exact error messages"]}]}, at most 2. Each body has these lines: Claim: / Applies when: / Action: / Verify: (or Avoid:) / Anchors: / Evidence:.',
    `The boundary: ${input.boundary}.`,
    "The record:",
    render(input.segment),
  ].join("\n\n")
}

const Candidate = Schema.Struct({
  kind: Schema.Literals(["bug", "convention", "procedure", "gotcha", "decision", "failed-approach"]),
  title: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
  body: Schema.String.check(Schema.isNonEmpty()),
  paths: Schema.optional(Schema.Array(Schema.String)),
  errors: Schema.optional(Schema.Array(Schema.String)),
})
export type Candidate = typeof Candidate.Type
const Distilled = Schema.Struct({ candidates: Schema.Array(Schema.Unknown) })

/** The candidates in the distiller's answer that have every field right; the rest, and anything unparsable, dropped. */
export function candidates(text: string): ReadonlyArray<Candidate> {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
  return Option.match(Schema.decodeUnknownOption(Schema.fromJsonString(Distilled))(json), {
    onNone: () => [],
    onSome: (answer) =>
      answer.candidates.flatMap((item) => Option.toArray(Schema.decodeUnknownOption(Candidate)(item))),
  }).slice(0, 2)
}

/**
 * What outside the agent's own say-so the segment shows, for Console to weigh: commits it made and test-like commands
 * that passed after failing. In-session passes alone are weak evidence; Console holds candidates until stronger
 * evidence arrives (a commit that survives with CI, a user's confirmation, the same lesson from other sessions).
 */
export function evidence(segment: ReadonlyArray<Event>) {
  const failing = new Set<string>()
  return segment.flatMap((event): Array<{ readonly kind: "commit" | "test"; readonly ref: string }> => {
    if (event.type === "commit") return [{ kind: "commit", ref: event.sha }]
    if (event.type !== "shell" || !event.test) return []
    if (event.failed) {
      failing.add(event.command)
      return []
    }
    return failing.size > 0 ? [{ kind: "test", ref: event.command.slice(0, 500) }] : []
  })
}
