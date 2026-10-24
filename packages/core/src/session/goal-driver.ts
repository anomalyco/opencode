export * as SessionGoalDriver from "./goal-driver.js"

import { Event } from "@opencode/schema/event"
import { SessionGoal as SessionGoalSchema } from "@opencode/schema/session-goal"
import { Effect, Scope, Stream } from "effect"
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
 * The round is counted by its inbox row's projection, because a verifier that
 * publishes nothing would otherwise let the budget never trigger.
 */
export const scheduleRound = Effect.fn("SessionGoalDriver.scheduleRound")(function* (sessionID: SessionSchema.ID) {
  const activation = yield* SessionGoalActivation.Service
  if (!(yield* activation.isArmed(sessionID))) return
  const goal = yield* SessionGoal.Service
  const state = yield* goal.readState(sessionID)
  if (state.goal?.phase !== "active") return
  const sessions = yield* Session.Service
  // The round is counted by this row's projection, in the same transaction, so the
  // count is durable before the row exists and a restart reads the same value.
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
 * The idle boundary. A human turn disarms the goal so it cannot preempt that
 * turn; once the human queue is empty this boundary re-arms it. The same path
 * recovers a goal that a failure, a compaction failure, or a restart left
 * disarmed, so the user never has to pause and resume to get it running again.
 * Every later check is a gate that admits no round rather than a retry: the
 * next `session.execution.succeeded` re-evaluates all of them.
 */
export const onSucceeded = Effect.fn("SessionGoalDriver.onSucceeded")(function* (
  sessionID: SessionSchema.ID,
  context: SessionContext.Interface,
) {
  const activation = yield* SessionGoalActivation.Service
  const goal = yield* SessionGoal.Service
  const current = yield* goal.read(sessionID)
  if (current?.phase !== "active") return
  const sessions = yield* Session.Service
  const pending = yield* sessions.inbox(sessionID).pipe(Effect.orElseSucceed(() => []))
  const humanWaiting = pending.some((item) => item.type === "user")
  if (!humanWaiting && !(yield* activation.isArmed(sessionID))) yield* activation.arm(sessionID)
  if (!(yield* activation.isArmed(sessionID))) return
  const verify = yield* SessionGoalVerify.Service
  yield* verify.verify(sessionID, context)
  const state = yield* goal.readState(sessionID)
  if (state.goal?.phase !== "active") return
  // An empty list is not done: the model still has to write the work down.
  if (state.todo.length > 0 && state.todo.every(isSettled)) return
  if (state.rounds >= state.maxGoalRounds) {
    yield* goal.block(sessionID, {
      code: "max_rounds",
      message: `Goal reached its ${state.maxGoalRounds}-round limit`,
    })
    return
  }
  // A human item may have arrived while the verifier was in flight; the
  // per-session queue has not processed its disarm event yet.
  const pendingAfter = yield* sessions.inbox(sessionID).pipe(Effect.orElseSucceed(() => []))
  if (pendingAfter.some((item) => item.type === "user")) return
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

/**
 * Runs the driver over an event stream. Events are grouped per session, so a
 * slow verification for one session cannot delay another session's disarm.
 * Order within a session is preserved, and an idle group is torn down after a
 * minute so a long-lived process does not keep a fiber per session forever.
 */
export const run = <E>(
  events: Stream.Stream<SessionGoalDriverEvent, E>,
  context: SessionContext.Interface,
): Effect.Effect<
  void,
  E,
  | Scope.Scope
  | SessionGoalActivation.Service
  | SessionGoal.Service
  | SessionGoalVerify.Service
  | Session.Service
> =>
  Effect.gen(function* () {
    const activation = yield* SessionGoalActivation.Service
    yield* events.pipe(
      Stream.groupByKey((event) => event.data.sessionID, { idleTimeToLive: "1 minute" }),
      Stream.mapEffect(([sessionID, sessionEvents]) =>
        sessionEvents.pipe(
          Stream.runForEach((event) =>
            handle(event, context).pipe(
              // A failure anywhere in the driver — a failed verification, a failed
              // checkpoint write — leaves the durable phase alone and stops this
              // process from driving the goal until the next idle boundary re-arms it.
              Effect.catchCause((cause) =>
                Effect.logError("goal driver failed", cause).pipe(
                  Effect.andThen(activation.disarm(sessionID)),
                ),
              ),
            ),
          ),
          Effect.forkScoped({ startImmediately: true }),
        ),
      ),
      Stream.runDrain,
    )
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
    "Keep the list accurate with the goal_todo tool. Only the verifier marks an item completed, so finish the work rather than the list.",
  ].join("\n\n")
}

const renderTodo = (todo: ReadonlyArray<SessionGoalSchema.TodoItem>) =>
  todo.length === 0
    ? "(the list is empty; write it with the goal_todo tool)"
    : todo.map((item) => `- [${item.position}] ${item.status}: ${item.content}`).join("\n")
