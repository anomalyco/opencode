export * as SessionGoalDriver from "./goal-driver.js"

import { Event } from "@opencode/schema/event"
import { SessionGoal as SessionGoalSchema } from "@opencode/schema/session-goal"
import { Effect } from "effect"
import { Session } from "../session.js"
import { SessionContext } from "./context.js"
import { SessionEvent } from "./event.js"
import { SessionGoal } from "./goal.js"
import { SessionGoalActivation } from "./goal-activation.js"
import { SessionGoalVerify } from "./goal-verify.js"
import { SessionSchema } from "./schema.js"

/** The events the driver reacts to: one scheduling boundary and the disarm list. */
export const watched = [
  SessionEvent.Execution.Succeeded,
  SessionEvent.Execution.Failed,
  SessionEvent.Execution.Interrupted,
  SessionEvent.InboxEnqueued,
  SessionEvent.Moved,
  SessionEvent.Forked,
  SessionEvent.Compaction.Failed,
] as const

export type SessionGoalDriverEvent = Event.Payload<(typeof watched)[number]>

/** Narrows the plugin's event stream to the events the driver reacts to. */
export const isDriverEvent = (event: { readonly type: string }): event is SessionGoalDriverEvent =>
  watched.some((definition) => definition.type === event.type)

/**
 * The round driver. It owns no loop, no timer and no polling: a round is one
 * synthetic inbox row plus one wake, and the existing execution machinery drains it.
 * `session.execution.succeeded` is the only place a round is scheduled, so a
 * round can only follow a verification, and `maxGoalRounds` bounds the sequence.
 */
export const scheduleRound = Effect.fn("SessionGoalDriver.scheduleRound")(function* (sessionID: SessionSchema.ID) {
  const activation = yield* SessionGoalActivation.Service
  if (!(yield* activation.isArmed(sessionID))) return
  const goal = yield* SessionGoal.Service
  const state = yield* goal.readState(sessionID)
  if (state.goal?.phase !== "active") return
  const sessions = yield* Session.Service
  yield* sessions.synthetic({
    sessionID,
    text: renderRoundPrompt(state),
    description: "goal round",
    metadata: { source: "goal", round: state.rounds + 1 },
    delivery: "steer",
    resume: true,
  })
})

/**
 * The idle boundary. Every check is a gate that keeps the goal disarmed rather
 * than a retry: the next `session.execution.succeeded` re-evaluates all of them.
 */
export const onSucceeded = Effect.fn("SessionGoalDriver.onSucceeded")(function* (
  sessionID: SessionSchema.ID,
  context: SessionContext.Interface,
) {
  const activation = yield* SessionGoalActivation.Service
  if (!(yield* activation.isArmed(sessionID))) return
  const goal = yield* SessionGoal.Service
  const current = yield* goal.read(sessionID)
  if (current?.phase !== "active") return
  const verify = yield* SessionGoalVerify.Service
  yield* verify.verify(sessionID, context)
  const state = yield* goal.readState(sessionID)
  if (state.goal?.phase !== "active") return
  if (state.todo.every(isSettled)) return
  if (state.rounds >= state.maxGoalRounds) {
    yield* goal.block(sessionID, {
      code: "max_rounds",
      message: `Goal reached its ${state.maxGoalRounds}-round limit`,
    })
    return
  }
  const sessions = yield* Session.Service
  const pending = yield* sessions.inbox(sessionID).pipe(Effect.orElseSucceed(() => []))
  if (pending.some((item) => item.type === "user")) return
  yield* scheduleRound(sessionID)
})

export const handle = (
  event: SessionGoalDriverEvent,
  context: SessionContext.Interface,
): Effect.Effect<
  void,
  unknown,
  SessionGoalActivation.Service | SessionGoal.Service | SessionGoalVerify.Service | Session.Service
> =>
  Effect.gen(function* () {
    const activation = yield* SessionGoalActivation.Service
    if (event.type === "session.execution.succeeded") return yield* onSucceeded(event.data.sessionID, context)
    if (event.type === "session.inbox.enqueued") {
      // A human turn takes the floor; the goal resumes at the next idle boundary.
      if (event.data.item.type !== "user") return
      return yield* activation.disarm(event.data.sessionID)
    }
    if (event.type === "session.execution.failed") return yield* activation.disarm(event.data.sessionID)
    if (event.type === "session.execution.interrupted") {
      // A deliberate stop already disarmed; a shutdown keeps the durable claim for
      // restart recovery, and the goal must not resume itself after that restart.
      if (event.data.reason !== "shutdown") return
      return yield* activation.disarm(event.data.sessionID)
    }
    if (event.type === "session.moved" || event.type === "session.forked")
      return yield* activation.disarm(event.data.sessionID)
    if (event.type === "session.compaction.failed") return yield* activation.disarm(event.data.sessionID)
  })

const isSettled = (item: SessionGoalSchema.TodoItem) =>
  item.status === "completed" || item.status === "cancelled"

const renderRoundPrompt = (state: SessionGoalSchema.State) => {
  const unmet = state.todo.flatMap((item) =>
    item.feedback === undefined || item.feedback === ""
      ? []
      : [`- [${item.position}] ${item.content}: ${item.feedback}`],
  )
  return [
    `Continue working on the goal: ${state.goal?.objective ?? ""}`,
    `Round ${state.rounds + 1} of ${state.maxGoalRounds}.`,
    `Todo list:\n${renderTodo(state.todo)}`,
    unmet.length === 0
      ? "The verifier has not rejected anything yet."
      : `The verifier did not accept these items:\n${unmet.join("\n")}`,
    "Keep the list accurate with the todo tool. Only the verifier marks an item completed, so finish the work rather than the list.",
  ].join("\n\n")
}

const renderTodo = (todo: ReadonlyArray<SessionGoalSchema.TodoItem>) =>
  todo.length === 0
    ? "(the list is empty; write it with the todo tool)"
    : todo.map((item) => `- [${item.position}] ${item.status}: ${item.content}`).join("\n")
