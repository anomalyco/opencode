export * as GoalPlugin from "./goal.js"

import { isContextOverflowFailure, Message } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionIdleBackground } from "@opencode/plugin/effect/session"
import { Goal } from "@opencode/schema/goal"
import { Session } from "@opencode/schema/session"
import { isExactRootFallback } from "@opencode/util/session-title-fallback"
import { Cause, Clock, DateTime, Duration, Effect, FiberMap, Option, Schema, Stream } from "effect"
import CONTINUATION from "./goal/continuation.txt"
import JUDGE from "./goal/judge.txt"
import KICKOFF from "./goal/kickoff.txt"
import REMINDER from "./goal/reminder.txt"

export const MAX_OBJECTIVE = 4_000
export const MAX_ROUNDS = 50
export const MAX_STALLS = 3
/** How long an active goal may sit idle, waiting on background work that never reports, before it pauses. */
export const WAIT_LIMIT = Duration.minutes(30)
// Identifies this server process. A goal armed by an earlier process comes back paused instead of resuming on its own.
// Created on first use: Workers forbid random values while a module loads.
let processBoot: string | undefined
const boot = () => (processBoot ??= crypto.randomUUID())

type State = Goal.State
const decodeState = Schema.decodeUnknownOption(Goal.State)
// Storage key prefix of a Session's goal. Plugin storage is the plugin's own, so children and forks start without one.
const PREFIX = "session:"

const Verdict = Schema.Struct({
  verdict: Schema.Literals(["done", "continue", "blocked", "paused", "wait"]),
  reason: Schema.String,
  next_step: Schema.optionalKey(Schema.String),
})
type Verdict = typeof Verdict.Type
const decodeVerdict = Schema.decodeUnknownOption(Schema.fromJsonString(Verdict))

const USAGE = "Usage: /goal <objective> | pause | resume | clear"

export const Plugin = define({
  id: "opencode.goal",
  effect: Effect.fn(function* (ctx) {
    const read = Effect.fn("GoalPlugin.read")(function* (sessionID: string) {
      return Option.getOrUndefined(decodeState(yield* ctx.storage.get(PREFIX + sessionID)))
    })

    const rpc = yield* ctx.rpc
      .register(Goal.Definition, {
        get: (input) => read(input.sessionID).pipe(Effect.map((goal) => goal ?? null)),
      })
      .pipe(Effect.orDie)

    // Clients read the goal through `get` and follow `changed`, so every write publishes the new value.
    const write = Effect.fn("GoalPlugin.write")(function* (sessionID: string, goal: State | undefined) {
      yield* goal ? ctx.storage.set(PREFIX + sessionID, goal) : ctx.storage.remove(PREFIX + sessionID)
      yield* rpc.events
        .emit("changed", { sessionID, goal: goal ?? null })
        .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to publish a goal change", { sessionID, cause })))
    })

    // The loop's own writes only apply to the goal they were decided on. Storage has no compare-and-set, so this
    // re-reads first: a `/goal pause`, `clear` or new goal that landed since wins instead of being overwritten.
    const replace = Effect.fn("GoalPlugin.replace")(function* (sessionID: Session.ID, expected: State, next: State) {
      const current = yield* read(sessionID)
      if (current?.id !== expected.id || current.updatedAt !== expected.updatedAt || current.status !== expected.status)
        return false
      yield* write(sessionID, next)
      return true
    })

    const settle = Effect.fn("GoalPlugin.settle")(function* (
      sessionID: Session.ID,
      goal: State,
      status: "paused" | "complete",
      reason: string,
    ) {
      yield* replace(sessionID, goal, { ...goal, status, reason, updatedAt: yield* Clock.currentTimeMillis })
    })

    const pauseActive = (sessionID: Session.ID, reason: string) =>
      read(sessionID).pipe(
        Effect.flatMap((goal) => (goal?.status === "active" ? settle(sessionID, goal, "paused", reason) : Effect.void)),
      )

    // One compaction per round when the reviewer's request is too large; a second overflow pauses instead. An entry
    // lives only until the reviewer answers or the goal pauses.
    const compacted = new Map<Session.ID, string>()

    // Whether the model called any tool since the goal's last kickoff or continuation. Without that message in view,
    // for example after a compaction, the round counts as progress.
    const usedTools = Effect.fn("GoalPlugin.usedTools")(function* (sessionID: Session.ID, goalID: string) {
      const messages = yield* ctx.session.context({ sessionID })
      const start = messages.findLastIndex(
        (message) => (message.type === "synthetic" || message.type === "user") && message.metadata?.goalID === goalID,
      )
      return (
        start === -1 ||
        messages
          .slice(start + 1)
          .some((message) => message.type === "assistant" && message.content.some((part) => part.type === "tool"))
      )
    })

    const judge = Effect.fn("GoalPlugin.judge")(function* (
      sessionID: Session.ID,
      goal: State,
      shells: ReadonlyArray<string>,
    ) {
      const prompt = render(JUDGE, {
        objective: escape(goal.objective),
        background:
          shells.length === 0
            ? "No background shells are running."
            : [
                "Background shells still running:",
                ...shells.map((command) => `- ${command}`),
                "",
                'Answer "wait" only when the goal needs the result of one of these shells. Never wait for a long-running server such as a dev server.',
              ].join("\n"),
        wait:
          shells.length === 0 ? "" : '{"verdict":"wait","reason":"<the running shell whose result the goal needs>"}\n',
      })
      const attempt = ctx.session.generate({ sessionID, prompt }).pipe(
        Effect.map((result) => {
          const verdict = parseVerdict(result.text)
          // "wait" is only offered while a shell runs; without one, nothing would wake the Session to judge again.
          return verdict?.verdict === "wait" && shells.length === 0 ? undefined : verdict
        }),
        // The reviewer runs right after the last step, before the next step's automatic compaction, so a long final
        // step can leave more history than the model takes.
        Effect.catchIf(isContextOverflowFailure, () => Effect.succeed("overflow" as const)),
      )
      const first = yield* attempt
      if (first !== undefined) return first
      return yield* attempt
    })

    // Stop-hook style loop: the runner fires this only once the Session would go idle with nothing pending, and input
    // admitted here continues the same execution.
    const idle = Effect.fn("GoalPlugin.idle")(function* (
      sessionID: Session.ID,
      background: ReadonlyArray<SessionIdleBackground>,
    ) {
      const goal = yield* read(sessionID)
      if (goal?.status !== "active") return
      if (goal.boot !== boot())
        return yield* settle(sessionID, goal, "paused", "The server restarted while the goal was active")
      // The Session's own running subagent or image job wakes it with its notice, and the hook runs again then. A
      // grandchild reports to its own parent, so it would never wake this Session.
      if (
        background.some((work) => (work.kind === "subagent" || work.kind === "image") && work.sessionID === sessionID)
      )
        return
      if (goal.rounds >= goal.maxRounds)
        return yield* settle(sessionID, goal, "paused", `Reached the limit of ${goal.maxRounds} rounds`)

      // Only the Session's own shells wake it when they finish. A subagent's leftover shell wakes the subagent, so
      // waiting on it would leave this Session idle until the wait limit pauses the goal.
      const shells = background.flatMap((work) =>
        work.kind === "shell" && work.sessionID === sessionID ? [work.command] : [],
      )
      const verdict = yield* judge(sessionID, goal, shells)
      if (verdict !== "overflow") compacted.delete(sessionID)
      // `/goal pause`, `clear` or a new goal may have landed while the reviewer ran.
      const latest = yield* read(sessionID)
      if (latest?.id !== goal.id || latest.status !== "active") return
      if (verdict === "overflow") {
        const key = `${latest.id}:${latest.rounds}`
        if (compacted.get(sessionID) === key) {
          compacted.delete(sessionID)
          return yield* settle(sessionID, latest, "paused", "The goal reviewer's request is too large for the model")
        }
        compacted.set(sessionID, key)
        // The runner compacts before going idle, then runs this hook again on the smaller history.
        yield* ctx.session.compact({ sessionID })
        return
      }
      if (verdict === undefined)
        return yield* settle(sessionID, latest, "paused", "The goal reviewer gave no usable verdict")
      if (verdict.verdict === "wait") return
      if (verdict.verdict === "done") return yield* settle(sessionID, latest, "complete", verdict.reason)
      if (verdict.verdict !== "continue") return yield* settle(sessionID, latest, "paused", verdict.reason)

      const stalled = sameReason(latest.reason, verdict.reason) || !(yield* usedTools(sessionID, latest.id))
      const stalls = stalled ? (latest.stalls ?? 0) + 1 : 0
      if (stalls >= MAX_STALLS)
        return yield* settle(sessionID, latest, "paused", `Not making progress: ${verdict.reason}`)

      const next = {
        ...latest,
        rounds: latest.rounds + 1,
        stalls,
        reason: verdict.reason,
        updatedAt: yield* Clock.currentTimeMillis,
      }
      if (!(yield* replace(sessionID, latest, next))) return
      // No description: timelines hide the continuation, and the pinned goal shows that the loop is still running.
      yield* ctx.session.synthetic({
        sessionID,
        text: continuation(next, [verdict.reason, verdict.next_step && `Next step: ${verdict.next_step}`]),
        metadata: { source: "goal", goalID: next.id },
      })
    })

    yield* ctx.session.hook("experimental.idle", (event) =>
      idle(event.sessionID, event.background).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("goal continuation failed", { sessionID: event.sessionID, cause }).pipe(
                Effect.andThen(pauseActive(event.sessionID, "The goal stopped after an error")),
                Effect.catchCause(() => Effect.void),
              ),
        ),
      ),
    )

    // Until the next continuation restates the objective, a compacted history may not show it. Add it near the tail,
    // without persisting it, so the cached prefix stays warm and the reminder stops once a continuation lands.
    yield* ctx.session.hook("context", (event) =>
      read(event.sessionID).pipe(
        Effect.map((goal) => {
          if (goal?.status !== "active") return
          const objective = objectiveBlock(goal.objective)
          if (event.messages.some((message) => message.role === "user" && textOf(message).includes(objective))) return
          const at = event.messages.at(-1)?.role === "user" ? event.messages.length - 1 : event.messages.length
          event.messages.splice(at, 0, Message.user(render(REMINDER, { objective: escape(goal.objective) })))
        }),
        Effect.catchCause((cause) => Effect.logWarning("failed to remind the model of the goal", { cause })),
      ),
    )

    // An active goal only sits idle while it waits on background work, whose notice wakes the Session. If nothing has
    // run in the Session or below it for WAIT_LIMIT (a hung subagent, a shell that never exits, a missed wake), pause
    // instead of staying active.
    const timers = yield* FiberMap.make<string>()
    const watch = (sessionID: Session.ID) =>
      read(sessionID).pipe(
        Effect.flatMap((goal) =>
          goal?.status !== "active"
            ? Effect.void
            : FiberMap.run(
                timers,
                sessionID,
                Effect.sleep(WAIT_LIMIT).pipe(
                  Effect.andThen(
                    settle(
                      sessionID,
                      goal,
                      "paused",
                      `Nothing ran for ${Duration.toMinutes(WAIT_LIMIT)} minutes while the goal waited on background work`,
                    ),
                  ),
                  Effect.catchCause((cause) =>
                    Effect.logWarning("failed to pause a waiting goal", { sessionID, cause }),
                  ),
                ),
              ).pipe(Effect.asVoid),
        ),
      )

    // A subagent's executions carry its own Session ID, so a step anywhere below a waiting goal restarts its timer.
    // Otherwise a healthy subagent working past WAIT_LIMIT would pause the goal it works for.
    const touch = Effect.fn("GoalPlugin.touch")(function* (sessionID: Session.ID) {
      if ((yield* FiberMap.size(timers)) === 0) return
      let current = (yield* ctx.session.get({ sessionID })).parentID
      while (current !== undefined) {
        if (yield* FiberMap.has(timers, current)) return yield* watch(current)
        current = (yield* ctx.session.get({ sessionID: current })).parentID
      }
    })

    yield* ctx.event
      .subscribe({
        types: [
          "session.execution.started",
          "session.execution.succeeded",
          "session.execution.interrupted",
          "session.execution.failed",
          "session.step.started",
          "session.step.ended",
          "session.deleted",
        ],
      })
      .pipe(
        Stream.runForEach((event) => {
          const sessionID = event.data.sessionID
          if (event.type === "session.deleted")
            return FiberMap.remove(timers, sessionID).pipe(Effect.andThen(ctx.storage.remove(PREFIX + sessionID)))
          if (event.type === "session.step.started" || event.type === "session.step.ended")
            return touch(sessionID).pipe(
              Effect.catchCause((cause) => Effect.logWarning("failed to note goal activity", { sessionID, cause })),
            )
          if (event.type === "session.execution.started") return FiberMap.remove(timers, sessionID)
          if (event.type === "session.execution.succeeded")
            return watch(sessionID).pipe(
              Effect.catchCause((cause) => Effect.logWarning("failed to watch a waiting goal", { sessionID, cause })),
            )
          // Shutdown keeps the goal active; the next process sees the boot change and pauses it.
          if (event.type === "session.execution.interrupted" && event.data.reason !== "user") return Effect.void
          const reason =
            event.type === "session.execution.failed"
              ? `The session failed: ${event.data.error.message}`
              : "Stopped by the user"
          return pauseActive(event.data.sessionID, reason).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to pause goal", { sessionID: event.data.sessionID, cause }),
            ),
          )
        }),
        Effect.forkScoped({ startImmediately: true }),
      )

    // A goal an earlier process left active would show as running while nothing drives it, unless something wakes the
    // Session, so pause those now; the boot check in the hook covers any that wake first. Goals of Sessions deleted
    // while no instance listened are dropped. This assumes one server process per database: a second one would pause
    // the first one's live goals.
    yield* Effect.gen(function* () {
      let after: string | undefined
      do {
        const page = yield* ctx.storage.scan({ prefix: PREFIX, after, limit: 100 })
        yield* Effect.forEach(
          page.entries,
          (entry) =>
            Effect.gen(function* () {
              const session = yield* ctx.session
                .get({ sessionID: Session.ID.make(entry.key.slice(PREFIX.length)) })
                .pipe(Effect.option)
              if (Option.isNone(session)) return yield* ctx.storage.remove(entry.key)
              const goal = Option.getOrUndefined(decodeState(entry.value))
              if (goal?.status !== "active" || goal.boot === boot()) return
              yield* settle(session.value.id, goal, "paused", "The server restarted while the goal was active")
            }),
          { discard: true },
        )
        after = page.next
      } while (after !== undefined)
    }).pipe(
      Effect.catchCause((cause) => Effect.logWarning("failed to pause goals left by an earlier process", { cause })),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* ctx.command.transform((editor) => {
      editor.add({
        name: "goal",
        description: "keep working until an objective is met [pause|resume|clear]",
        execute: (input) =>
          Effect.gen(function* () {
            const text = unquote(input.prompt.text.trim())
            const control = text.toLowerCase()
            const goal = yield* read(input.sessionID)
            if (text === "") return yield* Effect.fail(new Error(goal ? `${describe(goal)}\n${USAGE}` : USAGE))

            if (control === "pause") {
              if (goal?.status !== "active") return yield* Effect.fail(new Error("No active goal to pause."))
              // The user's command wins over the loop, so it writes without the loop's guard.
              return yield* write(input.sessionID, {
                ...goal,
                status: "paused",
                reason: "Paused by the user",
                updatedAt: yield* Clock.currentTimeMillis,
              })
            }
            if (control === "resume") {
              if (goal?.status !== "paused") return yield* Effect.fail(new Error("No paused goal to resume."))
              const resumed: State = {
                id: goal.id,
                objective: goal.objective,
                status: "active",
                // The resume continuation is the first round of the new budget.
                rounds: 1,
                maxRounds: goal.maxRounds,
                boot: boot(),
                updatedAt: yield* Clock.currentTimeMillis,
              }
              yield* write(input.sessionID, resumed)
              return yield* ctx.session.synthetic({
                sessionID: input.sessionID,
                text: continuation(resumed, ["The user resumed the goal."]),
                metadata: { source: "goal", goalID: resumed.id },
              })
            }
            if (control === "clear") {
              if (!goal) return yield* Effect.fail(new Error("No goal is set."))
              return yield* write(input.sessionID, undefined)
            }

            if (text.length > MAX_OBJECTIVE)
              return yield* Effect.fail(
                new Error(`A goal objective is limited to ${MAX_OBJECTIVE} characters (got ${text.length}).`),
              )
            const created: State = {
              id: crypto.randomUUID(),
              objective: text,
              status: "active",
              rounds: 0,
              maxRounds: MAX_ROUNDS,
              boot: boot(),
              updatedAt: yield* Clock.currentTimeMillis,
            }
            yield* write(input.sessionID, created)
            const session = yield* ctx.session.get({ sessionID: input.sessionID })
            // Titles come from the first user message, and a notice kickoff is not one, so name the Session here.
            if (
              isExactRootFallback({
                title: session.title,
                time: { created: DateTime.toEpochMillis(session.time.created) },
              })
            )
              yield* ctx.session.update({ sessionID: input.sessionID, title: truncate(text, 60) })
            const kickoff = render(KICKOFF, { objective: escape(text) })
            const metadata = { source: "goal", goalID: created.id }
            const attached = [input.prompt.files, input.prompt.agents, input.prompt.skills].some(
              (items) => items !== undefined && items.length > 0,
            )
            // Timelines show a described synthetic message as one notice row instead of the whole kickoff. Only a
            // prompt can carry attachments, so those still go through as the user's message.
            if (attached)
              return yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: kickoff,
                metadata,
                delivery: input.delivery,
              })
            yield* ctx.session.synthetic({
              sessionID: input.sessionID,
              text: kickoff,
              description: `Goal: ${truncate(text, 120)}`,
              metadata,
              delivery: input.delivery,
            })
          }).pipe(Effect.asVoid),
      })
    })
  }),
})

function continuation(goal: State, feedback: ReadonlyArray<string | undefined>) {
  return render(CONTINUATION, {
    objective: escape(goal.objective),
    feedback: feedback.filter(Boolean).join("\n"),
  })
}

// Every goal prompt wraps the objective the same way, so this marks the objective as visible to the model.
function objectiveBlock(objective: string) {
  return `<untrusted_objective>\n${escape(objective)}\n</untrusted_objective>`
}

function textOf(message: Message) {
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
}

function sameReason(previous: string | undefined, next: string) {
  const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ")
  return previous !== undefined && normalize(previous) === normalize(next)
}

function describe(goal: State) {
  const status = goal.status === "active" ? "Goal active" : goal.status === "paused" ? "Goal paused" : "Goal achieved"
  return [`${status}: ${goal.objective}`, goal.reason].filter(Boolean).join("\n")
}

// Reviewers sometimes wrap the JSON in a code fence or add a sentence around it.
function parseVerdict(text: string): Verdict | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end < start) return undefined
  return Option.getOrUndefined(decodeVerdict(text.slice(start, end + 1)))
}

// `/goal "Ship the release"` and `/goal Ship the release` set the same objective.
function unquote(text: string) {
  const quoted = /^(["'“‘])([\s\S]*)(["'”’])$/.exec(text)
  if (!quoted) return text
  const pairs: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’" }
  return pairs[quoted[1] ?? ""] === quoted[3] ? (quoted[2] ?? "").trim() : text
}

// One pass, so an objective that contains a placeholder is not expanded again.
function render(template: string, values: Record<string, string>) {
  return template.replace(/\$\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

function truncate(text: string, length: number) {
  const line = text.replace(/\s+/g, " ")
  return line.length > length ? `${line.slice(0, length - 1)}…` : line
}

function escape(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
