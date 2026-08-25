import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Deferred, Effect, Layer } from "effect"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionID } from "@/session/schema"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { unusedJobs } from "../lib/closure"
import { itBounded as it } from "../lib/effect"

// K97-K100. Permission and Question replies resolve Deferreds that resume suspended tools, so they
// are execution-admission seams. The coordinator here is a fake: the *real* coordinator's fence
// logic is proved against the real model in `closure-admission.test.ts`, and asserting both through
// one pipeline could not distinguish a defect in one from a defect in the other.

const admitting: SessionClosure.Interface["acquire"] = () =>
  Effect.succeed({
    type: "admitted",
    lease: Model.id("lease", "lease_pq"),
    epoch: 0n,
    instance: Model.id("instance", "instance_pq"),
  })

const refusing: SessionClosure.Interface["acquire"] = () =>
  Effect.succeed({
    type: "fenced",
    state: "closing",
    operation: Model.id("operation", "operation_pq"),
    epoch: 0n,
  })

const closureLayer = (acquire: SessionClosure.Interface["acquire"], acquired: SessionID[]) =>
  Layer.succeed(
    SessionClosure.Service,
    SessionClosure.Service.of({
      ...unusedJobs,
      request: () => Effect.die("unused"),
      view: Effect.die("unused"),
      identity: Effect.die("unused"),
      acquire: (input) => {
        acquired.push(input.session)
        return acquire(input)
      },
      bind: () => Effect.void,
      retire: () => Effect.void,
      reserveMutation: () => Effect.die("unused"),
      activateMutation: () => Effect.void,
      retireMutation: () => Effect.void,
    }),
  )

const services = Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer)

const withPermission = <A, E, R>(
  acquire: SessionClosure.Interface["acquire"],
  body: (acquired: SessionID[]) => Effect.Effect<A, E, R | Permission.Service>,
) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const acquired: SessionID[] = []
    const layer = LayerNode.compile(Permission.node, [[SessionClosure.node, closureLayer(acquire, acquired)]])
    return yield* body(acquired).pipe(Effect.provide(layer), provideInstanceEffect(directory))
  }).pipe(Effect.provide(services))

const withQuestion = <A, E, R>(
  acquire: SessionClosure.Interface["acquire"],
  body: (acquired: SessionID[]) => Effect.Effect<A, E, R | Question.Service>,
) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const acquired: SessionID[] = []
    const layer = LayerNode.compile(Question.node, [[SessionClosure.node, closureLayer(acquire, acquired)]])
    return yield* body(acquired).pipe(Effect.provide(layer), provideInstanceEffect(directory))
  }).pipe(Effect.provide(services))

const ask = (sessionID: SessionID, id: PermissionV1.ID) =>
  ({
    id,
    sessionID,
    permission: "edit",
    patterns: ["*"],
    metadata: {},
    always: ["*"],
    ruleset: [],
  }) satisfies PermissionV1.AskInput

const questions: ReadonlyArray<Question.Info> = [
  { question: "What would you like to do?", header: "Action", options: [{ label: "Yes", description: "proceed" }] },
]

/** Fork an `ask` and resolve only when its Deferred settles, so "did the tool resume" is observable. */
const forkAsk = (run: Effect.Effect<unknown, unknown>) =>
  Effect.gen(function* () {
    const settled = yield* Deferred.make<void>()
    yield* run.pipe(Effect.exit, Effect.andThen(Deferred.succeed(settled, undefined)), Effect.forkScoped)
    return settled
  })

/**
 * Block until exactly `count` requests are registered. `ask` registers its pending entry before it
 * awaits, so this is the synchronisation point every test below needs — without it a reply races
 * ahead of registration and lands on an unknown request. Bounded by `itBounded`.
 */
const waitForPending = <A>(list: Effect.Effect<ReadonlyArray<A>>, count: number) =>
  Effect.gen(function* () {
    for (;;) {
      const pending = yield* list
      if (pending.length === count) return pending
      yield* Effect.sleep("2 millis")
    }
  })

const waitSettled = (settled: Deferred.Deferred<void>) =>
  Effect.gen(function* () {
    for (;;) {
      if (yield* Deferred.isDone(settled)) return
      yield* Effect.sleep("2 millis")
    }
  })

describe("Permission admission (K97, K98)", () => {
  it.live("K97 pre-fence: an affirmative reply resolves the request and resumes the tool", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_pq_k97_pre")
      const id = PermissionV1.ID.ascending()

      yield* withPermission(admitting, (acquired) =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const settled = yield* forkAsk(permission.ask(ask(session, id)))
          yield* waitForPending(permission.list(), 1)

          yield* permission.reply({ requestID: id, reply: "once" })
          yield* waitSettled(settled)

          // The reply was lease-tracked: admission was consulted for this session before the
          // Deferred resolved.
          expect(acquired).toEqual([session])
          expect(yield* permission.list()).toHaveLength(0)
        }),
      )
    }),
  )

  it.live("K97 post-fence: an affirmative reply refuses and the suspended tool is not resumed", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_pq_k97_post")
      const id = PermissionV1.ID.ascending()

      yield* withPermission(refusing, (acquired) =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const settled = yield* forkAsk(permission.ask(ask(session, id)))
          yield* waitForPending(permission.list(), 1)

          const refused = yield* permission.reply({ requestID: id, reply: "always" }).pipe(Effect.flip)
          expect(refused._tag).toBe("SessionClosureAdmissionRefused")
          expect(acquired).toEqual([session])

          // The load-bearing half: no later tool side effect. The Deferred is untouched and the
          // request is still pending, so nothing resumed.
          expect(yield* Deferred.isDone(settled)).toBe(false)
          expect(yield* permission.list()).toHaveLength(1)
        }),
      )
    }),
  )

  it.live("K98 unknown-request behaviour is unchanged and is decided before admission", () =>
    Effect.gen(function* () {
      const unknown = PermissionV1.ID.ascending()

      yield* withPermission(refusing, (acquired) =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const error = yield* permission.reply({ requestID: unknown, reply: "reject" }).pipe(Effect.flip)

          // Even under a coordinator that refuses everything, an unknown request still answers
          // NotFound rather than a refusal — and admission was never consulted for it.
          expect(error._tag).toBe("Permission.NotFoundError")
          expect(acquired).toEqual([])
        }),
      )
    }),
  )

  it.live("K98 one reject resolves the whole same-session cascade under a single lease", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_pq_cascade")
      const first = PermissionV1.ID.ascending()
      const second = PermissionV1.ID.ascending()

      yield* withPermission(admitting, (acquired) =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const one = yield* forkAsk(permission.ask(ask(session, first)))
          const two = yield* forkAsk(permission.ask(ask(session, second)))
          yield* waitForPending(permission.list(), 2)

          yield* permission.reply({ requestID: first, reply: "reject" })
          yield* waitSettled(one)
          yield* waitSettled(two)

          // Two continuations resumed from one reply, and admission was consulted exactly once.
          // That is what makes I-31 checkable here: release has one lease to complete or suppress,
          // not one per resumed tool, so a partial settle cannot strand a resumed tool.
          expect(acquired).toEqual([session])
          expect(yield* permission.list()).toHaveLength(0)
        }),
      )
    }),
  )

  it.live("K98 the cascade cannot reach another session, so one session lease covers it", () =>
    Effect.gen(function* () {
      const target = SessionID.make("ses_pq_target")
      const other = SessionID.make("ses_pq_other")
      const inTarget = PermissionV1.ID.ascending()
      const inOther = PermissionV1.ID.ascending()

      yield* withPermission(admitting, (acquired) =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const targetSettled = yield* forkAsk(permission.ask(ask(target, inTarget)))
          const otherSettled = yield* forkAsk(permission.ask(ask(other, inOther)))
          yield* waitForPending(permission.list(), 2)

          yield* permission.reply({ requestID: inTarget, reply: "reject" })
          yield* waitSettled(targetSettled)

          // The resolved set is confined to the replied session. If this ever changed, a single
          // session-scoped lease would silently under-cover the cascade.
          expect(yield* Deferred.isDone(otherSettled)).toBe(false)
          expect(acquired).toEqual([target])
          expect((yield* permission.list()).map((item) => item.sessionID)).toEqual([other])
        }),
      )
    }),
  )
})

describe("Question admission (K99, K100)", () => {
  it.live("K99 pre-fence: a reply resolves the request and resumes the tool", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_pq_k99_pre")

      yield* withQuestion(admitting, (acquired) =>
        Effect.gen(function* () {
          const question = yield* Question.Service
          const settled = yield* forkAsk(question.ask({ sessionID: session, questions }))
          const pending = yield* waitForPending(question.list(), 1)

          yield* question.reply({ requestID: pending[0]!.id, answers: [["Yes"]] })
          yield* waitSettled(settled)
          expect(acquired).toEqual([session])
        }),
      )
    }),
  )

  it.live("K99 post-fence: a reply refuses and cannot resume the suspended tool", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_pq_k99_post")

      yield* withQuestion(refusing, (acquired) =>
        Effect.gen(function* () {
          const question = yield* Question.Service
          const settled = yield* forkAsk(question.ask({ sessionID: session, questions }))
          const pending = yield* waitForPending(question.list(), 1)

          const refused = yield* question
            .reply({ requestID: pending[0]!.id, answers: [["Yes"]] })
            .pipe(Effect.flip)
          expect(refused._tag).toBe("SessionClosureAdmissionRefused")
          expect(acquired).toEqual([session])
          expect(yield* Deferred.isDone(settled)).toBe(false)
          expect(yield* question.list()).toHaveLength(1)
        }),
      )
    }),
  )

  it.live("K100 post-fence: reject is leased-continuation, not proven-terminal, so it refuses", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_pq_k100")

      yield* withQuestion(refusing, (acquired) =>
        Effect.gen(function* () {
          const question = yield* Question.Service
          const settled = yield* forkAsk(question.ask({ sessionID: session, questions }))
          const pending = yield* waitForPending(question.list(), 1)

          // §7.3 permits a lease-free negative reject only where source proves termination without
          // continuation. `SessionProcessor.failToolCall` writes the ToolPart to `error` and then
          // sets `ctx.blocked = ctx.shouldBreak` — a conditional break — so that proof does not
          // hold and this reject is leased like the affirmative path.
          const refused = yield* question.reject(pending[0]!.id).pipe(Effect.flip)
          expect(refused._tag).toBe("SessionClosureAdmissionRefused")
          expect(acquired).toEqual([session])
          expect(yield* Deferred.isDone(settled)).toBe(false)
        }),
      )
    }),
  )

  it.live("K100 unknown-request behaviour is unchanged for both reply and reject", () =>
    Effect.gen(function* () {
      const unknown = QuestionID.ascending()

      yield* withQuestion(refusing, (acquired) =>
        Effect.gen(function* () {
          const question = yield* Question.Service
          const replyError = yield* question.reply({ requestID: unknown, answers: [] }).pipe(Effect.flip)
          const rejectError = yield* question.reject(unknown).pipe(Effect.flip)

          expect(replyError._tag).toBe("Question.NotFoundError")
          expect(rejectError._tag).toBe("Question.NotFoundError")
          expect(acquired).toEqual([])
        }),
      )
    }),
  )

  it.live("K99 no deprecated Session Question route exists to guard", () =>
    Effect.gen(function* () {
      // K99 requires asserting that no deprecated Session Question route is invented for symmetry
      // with Permission, which does have one (`handlers/session.ts`). The asymmetry is deliberate.
      // This guards the source: it fails if a session-scoped question route is ever added.
      const group = yield* Effect.promise(() =>
        Bun.file(new URL("../../src/server/routes/instance/httpapi/groups/session.ts", import.meta.url)).text(),
      )
      expect(group.toLowerCase()).not.toContain("question")
      // Positive control: the same file *does* carry the deprecated Permission route, so a
      // vacuously-empty read cannot pass this test.
      expect(group.toLowerCase()).toContain("permission")
    }),
  )
})
