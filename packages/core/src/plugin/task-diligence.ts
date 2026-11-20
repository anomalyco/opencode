export * as TaskDiligence from "./task-diligence.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import type { Task } from "@opencode/schema/task"
import { Effect, Option, Schema } from "effect"

/** How many times in a row the monitor pushes a stopped session back to work before it lets the session rest. */
export const MAX_NUDGES = 2

export const PROMPT = `# Finish the work

You are done only when the user's request is fully met and you have checked it. Do not stop early.

- Do the whole job. Do not hand the remaining steps back to the user ("you can now...", "left as an exercise"), and do not stop at a plan when the user asked for a change.
- Never write placeholder code or comments that stand in for real code, such as "// ... rest of the code" or "existing code here". Write the complete content. Do not use "for brevity" as a reason to omit code.
- Verify before you claim success: run the tests, build, or program, and read the output. If you could not verify something, say exactly that rather than implying it worked.
- If the project has an unfinished task list, finish those tasks or mark them cancelled with a reason before you stop.
- Stop and ask only when you are blocked by a decision that is the user's to make. Say what you need.`

// Phrases that hand work back to the user or announce stopping short. Each needs a first-person or imperative frame so
// that discussing the same words in an explanation does not match.
const DEFERRALS = [
  /\b(?:i(?:'ll| will| would)?|let me|i'm going to)\s+leave\b[^.\n]{0,80}\b(?:to you|for you|as an exercise|up to you)\b/i,
  /\byou(?:'ll| will)?\s+(?:now\s+)?(?:need to|have to|can|could|should|may want to|will want to)\s+(?:now\s+)?(?:implement|finish|complete|fill in|write the rest|add the rest)\b/i,
  /\b(?:the\s+)?(?:rest|remainder|remaining\s+(?:parts?|steps?|work|code))\b[^.\n]{0,60}\b(?:is|are)\s+(?:left\s+)?(?:as an exercise|up to you|for you)\b/i,
  /\bfor (?:the sake of )?brevity\b[^.\n]{0,80}\b(?:omit|omitted|skip|skipped|left out|not show|not include)/i,
  /\b(?:i'll|i will|i'm going to|let me)\s+stop here\b/i,
  /\b(?:i\s+)?(?:won't|will not|can't|cannot)\s+(?:implement|finish|complete)\s+(?:all|the rest|everything)\b/i,
  /\bto be continued\b/i,
]

// Comment lines that stand in for code. A bare "..." line is left alone: it is valid Python and TypeScript.
const PLACEHOLDERS = [
  /^\s*(?:\/\/|#|\/\*+|\*|<!--|--)\s*\.{3}\s*\(?(?:rest|remaining|existing|other|more|same|unchanged|previous|implementation|code|etc)\b/im,
  /^\s*(?:\/\/|#|\/\*+|\*|<!--|--)\s*(?:rest of (?:the )?(?:file|code|implementation|function|class|component)|remaining (?:code|implementation)|same as before|existing code (?:here|goes here|remains)|(?:previous|existing) (?:code|implementation) (?:here|unchanged))\b/im,
]

export function deferral(text: string) {
  const trimmed = text.trim()
  // A question hands the turn to the user on purpose.
  if (trimmed === "" || trimmed.endsWith("?")) return undefined
  return DEFERRALS.find((pattern) => pattern.test(trimmed))?.exec(trimmed)?.[0]
}

export function placeholder(text: string) {
  return PLACEHOLDERS.find((pattern) => pattern.test(text))?.exec(text)?.[0].trim()
}

const decodeWrite = Schema.decodeUnknownOption(Schema.Struct({ content: Schema.String }))
const decodeEdit = Schema.decodeUnknownOption(Schema.Struct({ oldString: Schema.String, newString: Schema.String }))

/** The placeholder a write or edit would leave in the file, if any. An edit only counts what it adds. */
export function introduced(tool: string, input: unknown) {
  if (tool === "write") return Option.flatMap(decodeWrite(input), (value) => Option.fromNullishOr(placeholder(value.content)))
  if (tool === "edit")
    return Option.flatMap(decodeEdit(input), (value) =>
      placeholder(value.oldString) === undefined ? Option.fromNullishOr(placeholder(value.newString)) : Option.none(),
    )
  return Option.none<string>()
}

export function unfinishedReminder(tasks: ReadonlyArray<Task.Item>) {
  return [
    `You stopped, but ${tasks.length} task${tasks.length === 1 ? " is" : "s are"} still unfinished:`,
    ...tasks.map((task) => `- [${task.status === "in_progress" ? "in progress" : "pending"}] ${task.content} (${task.id})`),
    "",
    "Continue with the next one now. If a task is already done, verify it and mark it completed with task_update; if it no longer applies, mark it cancelled and say why. Only stop if you are blocked on a decision that is the user's.",
  ].join("\n")
}

export function deferralReminder(phrase: string) {
  return [
    `Your last message ended with work still undone ("${phrase}").`,
    "Do that work now instead of handing it back. Finish it, verify it, and then report what you actually did. If you are truly blocked, say exactly what you need from the user.",
  ].join("\n")
}

/**
 * Installs the diligence monitor on a plugin context: the system prompt, a nudge when a Session stops with unfinished
 * tasks or hands its work back, and a guard against placeholder code in written files. `read` is the project's task
 * list, which only the task plugin's storage holds.
 */
export const install = Effect.fn("TaskDiligence.install")(function* (
  ctx: Context,
  input: { readonly enabled: () => boolean; readonly read: Effect.Effect<ReadonlyArray<Task.Item>> },
) {
  // Consecutive nudges per Session, reset by the user's next prompt.
  const nudges = new Map<string, number>()

  yield* ctx.session.hook("prompt", (event) => Effect.sync(() => void nudges.delete(event.sessionID)))

  yield* ctx.session.hook("context", (event) =>
    Effect.sync(() => {
      if (!input.enabled()) return
      event.system.push({ type: "text", text: PROMPT })
    }),
  )

  yield* ctx.tool.hook("execute.before", (event) =>
    Effect.gen(function* () {
      if (!input.enabled()) return
      const found = introduced(event.tool, event.input)
      if (Option.isNone(found)) return
      return yield* new ToolFailure({
        message: `This ${event.tool} was not applied: it contains a placeholder (${JSON.stringify(found.value)}) where real code belongs. Write the complete content, including every part you would have skipped.`,
      })
    }),
  )

  const nudge = Effect.fn("TaskDiligence.nudge")(function* (
    sessionID: Session.ID,
    background: ReadonlyArray<{ readonly sessionID: Session.ID }>,
  ) {
    if (!input.enabled()) return
    // Work this Session started still runs, and its notice will wake the Session again.
    if (background.some((work) => work.sessionID === sessionID)) return
    if ((nudges.get(sessionID) ?? 0) >= MAX_NUDGES) return
    // A subagent finishing is its normal end, and the project's tasks belong to its parent.
    const session = yield* ctx.session.get({ sessionID })
    if (session.parentID !== undefined) return

    const messages = yield* ctx.session.context({ sessionID })
    const lastInput = messages.findLast((message) => message.type === "user" || message.type === "synthetic")
    // The goal loop has its own reviewer, which judges whether the work is finished.
    if (lastInput?.metadata?.source === "goal") return
    const last = messages.at(-1)
    if (last?.type !== "assistant") return
    const text = last.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
    if (text.trim().endsWith("?")) return

    const unfinished = (yield* input.read).filter((task) => task.status === "pending" || task.status === "in_progress")
    const phrase = deferral(text)
    const reminder = unfinished.length > 0 ? unfinishedReminder(unfinished) : phrase ? deferralReminder(phrase) : undefined
    if (reminder === undefined) return

    nudges.set(sessionID, (nudges.get(sessionID) ?? 0) + 1)
    yield* ctx.session.synthetic({
      sessionID,
      text: reminder,
      description: unfinished.length > 0 ? "Unfinished tasks" : "Unfinished work",
      metadata: { source: "diligence" },
    })
  })

  yield* ctx.session.hook("experimental.idle", (event) =>
    nudge(event.sessionID, event.background).pipe(
      Effect.catchCause((cause) => Effect.logWarning("diligence check failed", { sessionID: event.sessionID, cause })),
    ),
  )
})
