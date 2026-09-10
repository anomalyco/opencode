import { afterEach, describe, expect, mock } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { Workspace } from "@/control-plane/workspace"
import { InstanceBootstrap as InstanceBootstrapService } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureRunState } from "@/session/closure/run-state"
import { Session as SessionNs } from "@/session/session"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "../server/httpapi-layer"

/**
 * The public fence producer.
 *
 * These rows run through the REAL HTTP graph and the real `SessionClosureRunState` assembly, which
 * supplies all nine capabilities to the coordinator. That matters more than it looks: the whole
 * chain — driver, discovery, lineage, ToolPart, Location, identity, high-water, record — is reached
 * only once `abort` is wired to service-owned closure, so a suite verifying the HTTP surface alone
 * would satisfy its own criterion while leaving every one of those capabilities unexercised.
 *
 * These cases cover the compatibility and idempotency edges of the route. The discover/signal/rescan
 * loop the route drives is covered against the driver directly rather than through HTTP.
 */
const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)

// The Instance store belongs in the same group as `Session` and `Database`. Compiled separately it
// hands the routes a different database than the one a created session was written to, and the
// failure is silent because the Location gate answers `false` on any resolution defect.
const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, SessionNs.node, Workspace.node, Database.node, Ripgrep.node]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)

const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer))

const unsetRequest: SessionClosureRunState.Interface["request"] = () =>
  Effect.die("controlled closure request was not installed")
const controlled = {
  requests: [] as string[],
  request: unsetRequest,
}
const controlledRunState = Layer.succeed(
  SessionClosureRunState.Service,
  SessionClosureRunState.Service.of({
    request: (root) =>
      Effect.sync(() => controlled.requests.push(root)).pipe(
        Effect.andThen(Effect.suspend(() => controlled.request(root))),
      ),
    view: Effect.die("unused controlled closure view"),
    identity: Effect.die("unused controlled closure identity"),
  }),
)
const replacements = [
  [SessionClosureRunState.node, controlledRunState],
] as const satisfies LayerNode.Replacements
const served: Layer.Layer<never, unknown, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.createRoutes(undefined, replacements),
  {
    disableListenLog: true,
    disableLogger: true,
  },
)
const controlledHttp = served.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const mappedIt = testEffect(controlledHttp)

afterEach(async () => {
  mock.restore()
  controlled.requests.length = 0
  controlled.request = unsetRequest
  await disposeAllInstances()
})

const abort = (session: string, directory: string) =>
  requestInDirectory(`/session/${session}/abort`, directory, { method: "POST" })

const create = (directory: string) =>
  requestInDirectory("/session", directory, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).pipe(
    Effect.flatMap((response) => response.json),
    Effect.map((body) => body as { id: string }),
  )

const messages = {
  scope_incomplete: "The Task branch could not be proven completely; cancellation remains incomplete.",
  quiescence_failed: "The Task branch did not reach conversational quiescence.",
  planning_failed: "Closure evidence could not be prepared.",
  record_failed: "Closure evidence could not be recorded or verified.",
  closure_unavailable: "Task branch cancellation is temporarily unavailable.",
} as const

describe("session abort", () => {
  // The missing-Session compatibility path. Requesting closure for an unknown Session must not reach
  // the fail-closed Location gate and answer a typed 500 where callers expect 200/true.
  it.instance(
    "answers 200/true for a missing Session without creating a closure operation",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const response = yield* abort("ses_missing00000000000000000", test.directory)
        expect(response.status).toBe(200)
        expect(yield* response.text).toBe("true")
      }),
    { git: true },
  )

  mappedIt.instance(
    "K90 maps every expected domain failure to its exact safe HTTP 500 without leaking operation data",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* create(test.directory)
        const sentinel = "operation=C:/secret/path;token=tok_SECRET;row=row_SECRET;payload=payload_SECRET"

        for (const kind of Object.keys(messages) as Array<keyof typeof messages>) {
          const failure = new SessionClosure.Failure({ kind, operation: sentinel })
          // Standing-check precondition: the injected object really carries every string the wire
          // assertions below claim the mapper can suppress. A fixture without the field cannot prove
          // that forwarding the domain error would leak it.
          expect(failure.operation).toBe(sentinel)
          controlled.request = () => Effect.fail(failure)

          const response = yield* abort(session.id, test.directory)
          const text = yield* response.text

          expect(response.status).toBe(500)
          expect(JSON.parse(text)).toEqual({ _tag: "SessionClosureError", kind, message: messages[kind] })
          expect(text).not.toContain("C:/secret/path")
          expect(text).not.toContain("tok_SECRET")
          expect(text).not.toContain("row_SECRET")
          expect(text).not.toContain("payload_SECRET")
        }
        expect(controlled.requests).toEqual(Array.from({ length: 5 }, () => session.id))
      }),
    { git: true },
  )

  mappedIt.instance(
    "K90 maps Location refusal to scope_incomplete rather than worker failure and hides both coordinates",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* create(test.directory)
        const failure = new SessionClosure.LocationError({
          expected: "C:/secret/location/path",
          actual: "token=tok_LOCATION_SECRET",
        })
        expect(failure.expected).toContain("secret/location")
        expect(failure.actual).toContain("tok_LOCATION_SECRET")
        controlled.request = () => Effect.fail(failure)

        const response = yield* abort(session.id, test.directory)
        const text = yield* response.text

        expect(response.status).toBe(500)
        expect(JSON.parse(text)).toEqual({
          _tag: "SessionClosureError",
          kind: "scope_incomplete",
          message: messages.scope_incomplete,
        })
        expect(text).not.toContain("C:/secret/location/path")
        expect(text).not.toContain("tok_LOCATION_SECRET")
        expect(controlled.requests).toEqual([session.id])
      }),
    { git: true },
  )

  mappedIt.instance(
    "K90 emits true only after the closure request releases",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* create(test.directory)
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const state = { completed: false }
        controlled.request = () =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.as({ operation: "operation-k90", view: "view-k90" } as SessionClosure.Outcome),
          )

        const fiber = yield* abort(session.id, test.directory).pipe(
          Effect.ensuring(Effect.sync(() => (state.completed = true))),
          Effect.forkChild,
        )
        yield* Deferred.await(entered)

        // Positive precondition: the real handler reached the replacement request. While that
        // request is held before release, no HTTP success is available to the caller.
        expect(controlled.requests).toEqual([session.id])
        expect(state.completed).toBe(false)

        yield* Deferred.succeed(release, undefined)
        const response = yield* Fiber.join(fiber)
        expect(state.completed).toBe(true)
        expect(response.status).toBe(200)
        expect(yield* response.text).toBe("true")
      }),
    { git: true },
  )

  // The idle no-work request. Minting a generation for zero facts fails release verification, and an
  // ordinary abort then answers 500 record_failed instead of succeeding.
  it.instance(
    "answers 200/true for an idle Session and writes no record",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* Effect.acquireRelease(SessionNs.use.create({}), (created) =>
          SessionNs.use.remove(created.id).pipe(Effect.ignore),
        )

        // Positive precondition: the transcript is empty BEFORE the abort, so "no record written"
        // below is a statement about this operation rather than about an already-empty Session.
        expect(yield* SessionNs.use.messages({ sessionID: session.id })).toHaveLength(0)

        const response = yield* abort(session.id, test.directory)
        expect(response.status).toBe(200)
        expect(yield* response.text).toBe("true")

        // The record is the observable half of the defect: a work-free operation used to freeze a
        // generation with no referent.
        expect(yield* SessionNs.use.messages({ sessionID: session.id })).toHaveLength(0)
      }),
    { git: true },
  )

  /**
   * Repeat abort, measured rather than assumed.
   *
   * Before the repair this sequence returned `record_failed`, then `closure_unavailable`, then
   * `record_failed` — alternating kinds while empty generations accumulated 1, 2, 3. That alternation
   * was itself a second symptom: `closure_unavailable` is reserved for a genuine worker defect, and a
   * `record_failed` retry is required to re-enter the writer on the frozen triple and fail
   * IDENTICALLY. This row pins the repaired behaviour: an idle branch is idempotently closeable.
   */
  it.instance(
    "repeat abort of an idle Session stays successful and idempotent",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* Effect.acquireRelease(SessionNs.use.create({}), (created) =>
          SessionNs.use.remove(created.id).pipe(Effect.ignore),
        )

        const first = yield* abort(session.id, test.directory)
        const second = yield* abort(session.id, test.directory)
        const third = yield* abort(session.id, test.directory)

        expect([first.status, second.status, third.status]).toEqual([200, 200, 200])
        expect([yield* first.text, yield* second.text, yield* third.text]).toEqual(["true", "true", "true"])
        expect(yield* SessionNs.use.messages({ sessionID: session.id })).toHaveLength(0)
      }),
    { git: true },
  )
})
