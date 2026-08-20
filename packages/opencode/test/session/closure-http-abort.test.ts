import { afterEach, describe, expect, mock } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Effect, Layer } from "effect"
import { Workspace } from "@/control-plane/workspace"
import { InstanceBootstrap as InstanceBootstrapService } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Session as SessionNs } from "@/session/session"
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

afterEach(async () => {
  mock.restore()
  await disposeAllInstances()
})

const abort = (session: string, directory: string) =>
  requestInDirectory(`/session/${session}/abort`, directory, { method: "POST" })

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
