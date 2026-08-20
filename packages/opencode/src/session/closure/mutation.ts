import { Context, Effect, Option, Schema } from "effect"
import type { SessionID } from "../schema"
import { SessionClosure } from "./coordinator"
import type { SessionClosureModel as Model } from "./model"
import { SessionReplayPermit } from "./replay-permit"

// Destructive endpoints handle refusal differently from conversational admission.
export class MutationRefused extends Schema.TaggedErrorClass<MutationRefused>()("SessionClosureMutationRefused", {
  sessions: Schema.Array(Schema.String),
  kind: Schema.Literals([
    "revert",
    "unrevert",
    "remove_session",
    "remove_message",
    "remove_part",
    "replace_part",
    "revert_cleanup",
    "replay",
  ]),
  reason: Schema.Literals(["fenced", "stale_epoch", "duplicate", "wrong_instance"]),
}) {}

export type Input = {
  /** The complete subtree is reserved at once so a fence cannot leave a partially removed branch. */
  readonly sessions: readonly SessionID[]
  readonly kind: Model.MutationInput["kind"]
}

/**
 * Fiber-local reuse lets lower services enforce the guard without multiplying leases for nested
 * calls or putting authority in HTTP payloads.
 */
export interface ActiveScope {
  readonly sessions: ReadonlySet<SessionID>
}

export class Active extends Context.Service<Active, ActiveScope>()("@opencode/SessionMutationActive") {}

/** Reuse requires total coverage; partial overlap must not widen an enclosing lease. */
const covered = (scope: readonly SessionID[]) =>
  Effect.serviceOption(Active).pipe(
    Effect.map((found) => Option.isSome(found) && scope.every((session) => found.value.sessions.has(session))),
  )

/** A covering ambient lease passes through without adding another refusal point. */
export const leased = <A, E, R>(
  closure: SessionClosure.Interface,
  input: Input,
  body: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | MutationRefused, R> =>
  Effect.gen(function* () {
    if (yield* covered(input.sessions)) return yield* body
    const decision = yield* closure
      .reserveMutation({ sessions: input.sessions, kind: input.kind })
      // A coordinator for another Instance cannot authorize this mutation.
      .pipe(Effect.catchTag("SessionClosureLocationError", () => Effect.succeed(misrouted)))
    if (decision.type === "refused")
      return yield* new MutationRefused({
        sessions: input.sessions.map(String),
        kind: input.kind,
        reason: decision.reason,
      })
    yield* closure.activateMutation(decision.mutation).pipe(Effect.ignore)
    return yield* body.pipe(
      Effect.provideService(Active, { sessions: new Set(input.sessions) }),
      Effect.ensuring(closure.retireMutation(decision.mutation).pipe(Effect.ignore)),
    )
  })

/** One batch lease prevents a fence from leaving only a prefix of replay projected. */
export const replayLeased = <A, E, R>(
  closure: SessionClosure.Interface,
  aggregates: readonly string[],
  body: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | MutationRefused, R> => {
  const distinct = [...new Set(aggregates)]
  return leased(
    closure,
    // The permit stays keyed by raw aggregate so the core bridge need not assume every aggregate is a Session.
    { sessions: distinct.map((aggregate) => aggregate as SessionID), kind: "replay" },
    body.pipe(Effect.provideService(SessionReplayPermit.Service, { aggregates: new Set(distinct) })),
  )
}

const misrouted = { type: "refused", reason: "wrong_instance" } as const satisfies SessionClosure.MutationAdmission

export * as SessionMutation from "./mutation"
