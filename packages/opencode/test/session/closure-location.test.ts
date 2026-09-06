import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Effect, Layer } from "effect"
import { Workspace } from "@/control-plane/workspace"
import { InstanceBootstrap as InstanceBootstrapService } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import { SessionClosureLocation } from "@/session/closure/location"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { provideInstanceEffect, tmpdirScoped } from "../fixture/fixture"
import { testEffectBounded } from "../lib/effect"

// The Location gate: a caller first resolves the durable Session and validates its persisted
// Location/workspace metadata against the currently routed Instance, and only then may it resolve
// that Instance's coordinator.
//
// Why this suite exists separately from `closure-layer.test.ts`. That file proves the gate is
// SUPPLIED and reaches the coordinator, using real rows through the composed graph. This one proves
// the gate DISCRIMINATES. Those are different claims, and the second is the one that matters for a
// safety guard: a validator answering `true` unconditionally would satisfy every assertion in the
// other file while enforcing nothing. No default or no-op admission capability may make a safety
// guard permissive, so each case below pairs a refusal with a positive.

const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)

/**
 * One graph containing the Instance store, the Session store and the gate under test.
 *
 * `InstanceStore` belongs INSIDE this group rather than beside it. `validate` resolves the session
 * through the routed Instance, so an Instance store compiled in a separate graph hands the gate a
 * different `Database` than the one a created session was written to — every session then reads as
 * absent, the gate refuses everything, and each positive control fails for a reason that has nothing
 * to do with Location. `validate` catches its own resolution defects and answers `false`, so that
 * misconfiguration is silent and looks exactly like a working refusal.
 */
const appLayer = AppNodeBuilder.build(
  LayerNode.group([
    InstanceStore.node,
    Project.node,
    Session.node,
    Workspace.node,
    Database.node,
    CrossSpawnSpawner.node,
    SessionClosureLocation.node,
  ]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)

const it = testEffectBounded(appLayer)

const createIn = (directory: string, input: { title: string; workspaceID?: WorkspaceV2.ID }) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    return yield* session.create(input)
  }).pipe(provideInstanceEffect(directory))

const validateIn = (directory: string, session: string) =>
  Effect.gen(function* () {
    const location = yield* SessionClosureLocation.Service
    return yield* location.validate(Model.id("session", session))
  }).pipe(provideInstanceEffect(directory))

describe("closure.location", () => {
  it.live("admits a session of this Instance and refuses one that was never persisted", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const created = yield* createIn(directory, { title: "location-self" })

      // Positive control. Without it the refusal below could equally come from a validator that
      // refuses everything.
      expect(yield* validateIn(directory, created.id)).toBe(true)

      // Missing registry state is never treated as an admission: an absent row is a refusal.
      expect(yield* validateIn(directory, "ses_location_never_persisted")).toBe(false)
    }),
  )

  it.live("refuses a session belonging to a different directory-keyed Instance", () =>
    Effect.gen(function* () {
      const alpha = yield* tmpdirScoped()
      const beta = yield* tmpdirScoped()

      const inAlpha = yield* createIn(alpha, { title: "location-alpha" })

      // One session, two Instances, deliberately. The claim is about Instance identity, so holding
      // the session fixed and varying only the routed Instance removes the confound of comparing two
      // different rows, and each answer is the control for the other: the same id cannot be admitted
      // by construction and refused by construction.
      //
      // The load-bearing claim: every claim, fence, edge, job, lease, participant and record belongs
      // to exactly one Instance/Location coordinator, so distinct globally unique Sessions in
      // separate directory-keyed Instances cannot cross-claim.
      expect(yield* validateIn(alpha, inAlpha.id)).toBe(true)
      expect(yield* validateIn(beta, inAlpha.id)).toBe(false)
    }),
  )

  it.live("refuses a same-directory session whose persisted workspace differs", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const ambient = yield* createIn(directory, { title: "location-workspace-ambient" })
      // Same directory, explicitly foreign workspace. This is the case a directory comparison alone
      // cannot catch, which is why the gate validates Location and workspace rather than directory.
      const foreign = yield* createIn(directory, {
        title: "location-workspace-foreign",
        workspaceID: WorkspaceV2.ID.make("wrk_location_foreign"),
      })

      expect(yield* validateIn(directory, ambient.id)).toBe(true)
      expect(yield* validateIn(directory, foreign.id)).toBe(false)
    }),
  )
})
