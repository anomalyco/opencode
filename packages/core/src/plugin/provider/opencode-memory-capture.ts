export * as OpencodeMemoryCapture from "./opencode-memory-capture.js"

import { Option, Schema } from "effect"

/**
 * One thing a session did, as the harness saw it: recorded every turn, mechanically, without a model. `prompt` is a
 * message the session was given, `user` when it is the user's own (typed, or a command they ran; not a subagent's task
 * from its parent or an automation's), `shell` a finished command, `edit` and `read` the files a tool changed or read,
 * `commit` a commit the session made, `subtask` a subagent finishing, `compaction` the conversation being compacted.
 */
export type Event =
  | { readonly type: "prompt"; readonly text: string; readonly correction: boolean; readonly user: boolean }
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
export type Boundary = "task" | "commit" | "test" | "correction" | "rule" | "subtask" | "compaction"

/**
 * A user's message that states a standing team rule or decision rather than asking for this task's work. Narrow on
 * purpose: each one is a distillation of its own, so a phrase ordinary task requests use ("in this repo") isn't one.
 */
const STATED =
  /\b(?:from now on|going forward|(?:we|our team|the team) (?:always|never|use|prefer|don'?t|do not)|our (?:convention|rule|policy|style)|team (?:rule|convention|decision|policy))\b/i

/**
 * The boundary `event` closes after `segment`, the events since the last one, or undefined. A new task message, a
 * commit, a test-like run passing after one failed, a user's correction, a subagent finishing, and compaction as a
 * backstop. A message stating a team rule is a boundary of its own, so a rule the user states in a session's last turn
 * isn't lost waiting for the next one. Only these, a commit and a passing run close a segment without work (no command
 * run, no file changed): a message that reads as a correction corrects work.
 */
export function boundary(segment: ReadonlyArray<Event>, event: Event): Boundary | undefined {
  if (event.type === "prompt" && event.user && STATED.test(event.text)) return "rule"
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
    if (event.type === "prompt")
      return `${at} ${event.user ? "user" : "given task"}${event.correction ? " (correcting)" : ""}: ${event.text}`
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

/** An entry the session knows (in its standing block, injected, read or published by it), which a correction may reverse. */
export interface Known {
  readonly id: string
  readonly title: string
  readonly text: string
}

/** The distiller's instructions: at most a few typed candidates, usually none. */
export function prompt(input: {
  readonly segment: ReadonlyArray<Event>
  readonly boundary: Boundary
  readonly known?: ReadonlyArray<Known>
}) {
  return [
    "You read the record of a coding agent's work since its last work boundary and propose lessons for the team's shared memory. Most records yield nothing: then answer {\"candidates\": []}.",
    "Propose only a verified, non-obvious finding that an agent on a DIFFERENT task in this repository would need, as it holds for the repository as committed: a cause found behind a failure, a dead end and why, a command or setting the repository needs, a team rule, decision or correction the user stated. Use only what the record shows; never guess. Never: task status or a summary of the change, what the code or docs already say, facts about this machine, files the agent added and didn't commit, secrets.",
    'The user\'s task requests are not lessons: what they asked for in this task (add this, fix that, make the tests pass, commit your change) and what this task required hold for this task only; never record them. basis "user" is only for a durable team rule, decision or correction the user stated, one that holds for future work in this repository, with their exact words in quote. Everything else is basis "observed".',
    'Answer only JSON: {"candidates": [{"kind": "bug|convention|procedure|gotcha|decision|failed-approach", "title": "...", "body": "...", "paths": ["repository-relative paths"], "errors": ["exact error messages"], "basis": "user|observed", "quote": "the user\'s exact words, for basis user"}]}, at most 2. Each body has these lines: Claim: / Applies when: / Action: / Verify: (or Avoid:) / Anchors: / Evidence:.',
    ...((input.known ?? []).length === 0
      ? []
      : [
          'Entries already in the shared memory that this session knows. When the user\'s correction reverses or replaces one of them, name it in "supersedes": ["<id>"] on the new candidate; never propose a candidate that repeats one.',
          (input.known ?? [])
            .map((entry) => `- ${entry.id}: ${entry.title} — ${entry.text.split("\n")[0]?.slice(0, 200) ?? ""}`)
            .join("\n"),
        ]),
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
  basis: Schema.optional(Schema.Literals(["user", "observed"])),
  quote: Schema.optional(Schema.String),
  supersedes: Schema.optional(Schema.Array(Schema.String)),
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

/** Words that make a sentence a rule, a decision or a correction rather than a request for this task. */
const RULE =
  /\b(?:always|never|must|should(?:n'?t)?|don'?t|do not|avoid|instead|from now on|going forward|in this repo(?:sitory)?|we (?:use|prefer|always|never|don'?t)|our|convention|rule|policy|prefer(?:red)?|required?|no longer|not anymore|actually|wrong)\b/i
const MIN_QUOTE = 12

/**
 * Whether the user's own words back a candidate: `confirmed` when it says the user stated it and quotes, word for word,
 * a message a person typed in the segment that reads as a rule, decision or correction (the user's confirmation, which
 * Console promotes on); `observed` for a candidate from the work itself; `dropped` for a claimed user statement that
 * isn't one: a misquote, or a task request, which holds for that task only.
 */
export function backing(candidate: Candidate, segment: ReadonlyArray<Event>): "confirmed" | "observed" | "dropped" {
  if (candidate.basis !== "user") return "observed"
  const quote = flat(candidate.quote ?? "")
  if (quote.length < MIN_QUOTE || !RULE.test(quote)) return "dropped"
  return segment.some((event) => event.type === "prompt" && event.user && flat(event.text).includes(quote))
    ? "confirmed"
    : "dropped"
}

function flat(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase()
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
