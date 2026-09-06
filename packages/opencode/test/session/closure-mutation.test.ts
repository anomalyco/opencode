import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Exit, Layer } from "effect"
import { Workspace } from "@/control-plane/workspace"
import { InstanceBootstrap as InstanceBootstrapService } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session as SessionNs } from "@/session/session"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionMutation } from "@/session/closure/mutation"
import { Storage } from "@/storage/storage"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { MessageID, PartID } from "@/session/schema"
import type { SessionID } from "@/session/schema"
import { testInstanceStoreLayer } from "../fixture/fixture"
import { unusedJobs } from "../lib/closure"
import { testEffect } from "../lib/effect"

// The destructive-mutation lease at `Session.remove`.
//
// The coordinator here is a recording fake. The real coordinator's fence logic is proved against
// the real model in `closure-admission.test.ts`; what needs proving *here* is the seam's own
// behaviour — that one exact-subtree lease is taken rather than one per recursion level, that a
// refusal stops the removal entirely, and that a disjoint subtree is untouched. Asserting both
// through one pipeline could not distinguish a defect in one from a defect in the other.

type MutationCalls = {
  reserved: { readonly sessions: readonly SessionID[]; readonly kind: string }[]
  activated: Model.MutationID[]
  retired: Model.MutationID[]
}

const admitCalls: MutationCalls = { reserved: [], activated: [], retired: [] }
const refuseCalls: MutationCalls = { reserved: [], activated: [], retired: [] }

const reset = (calls: MutationCalls) =>
  Effect.sync(() => {
    calls.reserved.length = 0
    calls.activated.length = 0
    calls.retired.length = 0
  })

const recordingClosure = (calls: MutationCalls, admit: boolean) =>
  Layer.succeed(
    SessionClosure.Service,
    SessionClosure.Service.of({
      ...unusedJobs,
      request: () => Effect.die("unused"),
      view: Effect.die("unused"),
      identity: Effect.die("unused"),
      acquire: () => Effect.die("unused"),
      bind: () => Effect.void,
      retire: () => Effect.void,
      reserveMutation: (input) =>
        Effect.sync(() => {
          calls.reserved.push({ sessions: input.sessions, kind: input.kind })
          if (!admit) return { type: "refused" as const, reason: "fenced" as const }
          return { type: "reserved" as const, mutation: Model.id("mutation", `mutation_${calls.reserved.length}`) }
        }),
      activateMutation: (mutation) => Effect.sync(() => void calls.activated.push(mutation)),
      retireMutation: (mutation) => Effect.sync(() => void calls.retired.push(mutation)),
    }),
  )

const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)

/**
 * One graph, with the recording coordinator overriding `SessionClosure` for every dependent.
 *
 * Two properties are load-bearing. The override gives `Session` and `BackgroundJob` the SAME
 * coordinator instance rather than two, and naming `SessionClosure` in the group publishes that same
 * instance to test bodies — so a body driving `SessionMutation.leased` directly records into the
 * recorder the Session service is already using, which is what makes the ambient-reuse assertions
 * count one shared ledger rather than two.
 *
 * `InstanceStore` belongs in this group rather than beside it. Compiled separately it hands `Session`
 * a different `Database` than the one the test's own reads resolve, and nothing reports the
 * mismatch — created sessions simply read as absent.
 */
const harness = (closure: Layer.Layer<SessionClosure.Service>) =>
  testEffect(
    AppNodeBuilder.build(
      LayerNode.group([
        InstanceStore.node,
        Project.node,
        SessionNs.node,
        Workspace.node,
        Database.node,
        Storage.node,
        BackgroundJob.node,
        EventV2Bridge.node,
        CrossSpawnSpawner.node,
        SessionClosure.node,
      ]),
      [
        [InstanceStore.bootstrapNode, noopBootstrapLayer],
        [SessionClosure.node, closure],
        [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      ],
    ),
  )

const itAdmit = harness(recordingClosure(admitCalls, true))
const itRefuse = harness(recordingClosure(refuseCalls, false))

describe("Session.remove destructive-mutation lease", () => {
  itAdmit.instance("takes ONE exact-subtree lease covering every descendant, not one per level", () =>
    Effect.gen(function* () {
      yield* reset(admitCalls)
      const session = yield* SessionNs.Service
      const root = yield* session.create({ title: "mutation-root" })
      const child = yield* session.create({ title: "mutation-child", parentID: root.id })
      const grandchild = yield* session.create({ title: "mutation-grandchild", parentID: child.id })

      yield* session.remove(root.id)

      // Positive precondition: the removal actually happened, so the lease assertions below are
      // about a real three-node subtree removal and not a no-op.
      expect(Exit.isFailure(yield* session.get(root.id).pipe(Effect.exit))).toBe(true)
      expect(Exit.isFailure(yield* session.get(grandchild.id).pipe(Effect.exit))).toBe(true)

      // The load-bearing claim. Per-level leases would give three reservations; the exact-subtree
      // scope gives exactly one, covering the whole subtree. That is what makes the admission
      // decision atomic for the removal, and the overlap window checkable.
      expect(admitCalls.reserved).toHaveLength(1)
      expect(admitCalls.reserved[0]!.kind).toBe("remove_session")
      expect([...admitCalls.reserved[0]!.sessions].sort()).toEqual([root.id, child.id, grandchild.id].sort())

      // All three lease states are actually driven: reserved -> active -> retired.
      expect(admitCalls.activated).toHaveLength(1)
      expect(admitCalls.retired).toEqual(admitCalls.activated)
    }),
  )

  itAdmit.instance("scopes the lease to the removed subtree only, leaving a disjoint tree untouched", () =>
    Effect.gen(function* () {
      yield* reset(admitCalls)
      const session = yield* SessionNs.Service
      const target = yield* session.create({ title: "mutation-target" })
      const disjoint = yield* session.create({ title: "mutation-disjoint" })

      yield* session.remove(target.id)

      expect(admitCalls.reserved).toHaveLength(1)
      expect(admitCalls.reserved[0]!.sessions).toEqual([target.id])
      // The disjoint root is neither scoped nor removed, so an unrelated closure cannot block it.
      expect(Exit.isSuccess(yield* session.get(disjoint.id).pipe(Effect.exit))).toBe(true)
    }),
  )

  itRefuse.instance("refuses at the core seam and removes nothing, so a direct call cannot evade", () =>
    Effect.gen(function* () {
      yield* reset(refuseCalls)
      const session = yield* SessionNs.Service
      const root = yield* session.create({ title: "mutation-fenced" })
      const child = yield* session.create({ title: "mutation-fenced-child", parentID: root.id })

      // The direct core call, not the HTTP route and not the CLI. The guard lives at this seam
      // precisely so those cannot be the only place it is enforced.
      const exit = yield* session.remove(root.id).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)

      // Positive precondition plus the load-bearing negative: admission was consulted for the whole
      // subtree, and nothing was deleted.
      expect(refuseCalls.reserved).toHaveLength(1)
      expect([...refuseCalls.reserved[0]!.sessions].sort()).toEqual([root.id, child.id].sort())
      expect(Exit.isSuccess(yield* session.get(root.id).pipe(Effect.exit))).toBe(true)
      expect(Exit.isSuccess(yield* session.get(child.id).pipe(Effect.exit))).toBe(true)

      // A refused reservation is never activated and has nothing to retire.
      expect(refuseCalls.activated).toEqual([])
      expect(refuseCalls.retired).toEqual([])
    }),
  )

  itRefuse.instance("answers NotFound for a missing session rather than a refusal", () =>
    Effect.gen(function* () {
      yield* reset(refuseCalls)
      const session = yield* SessionNs.Service

      const exit = yield* session.remove("ses_does_not_exist" as SessionID).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)

      // `get` stays ahead of the lease, so a missing session is decided before admission is ever
      // consulted — the same ordering as Permission's unknown-request check.
      expect(refuseCalls.reserved).toEqual([])
    }),
  )
})

// The message and part removal leases. `remove_message` / `remove_part` / `replace_part` can exist
// as reservation kinds and in `MutationRefused` while no production `leased` call uses any of them —
// schema without wiring. `Session.removeMessage`/`removePart` only publish; the projector executes
// the `db.delete(...)`, so guarding the publication is what guards the SQL.

const seedMessage = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const session = yield* SessionNs.Service
    return yield* session.updateMessage({
      id: MessageID.ascending(),
      role: "user" as const,
      sessionID,
      agent: "default",
      model: { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-4") },
      time: { created: Date.now() },
    })
  })

describe("Session message/part removal leases", () => {
  itAdmit.instance("takes a remove_message lease and removes the row", () =>
    Effect.gen(function* () {
      yield* reset(admitCalls)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "remove-message-admit" })
      const message = yield* seedMessage(created.id)

      // Positive precondition: the row exists, so the removal below is a real deletion.
      expect((yield* session.messages({ sessionID: created.id })).map((item) => item.info.id)).toEqual([message.id])

      yield* session.removeMessage({ sessionID: created.id, messageID: message.id })

      expect(yield* session.messages({ sessionID: created.id })).toEqual([])
      expect(admitCalls.reserved).toHaveLength(1)
      expect(admitCalls.reserved[0]!.kind).toBe("remove_message")
      expect(admitCalls.reserved[0]!.sessions.map(String)).toEqual([created.id])
      expect(admitCalls.retired).toEqual(admitCalls.activated)
    }),
  )

  itRefuse.instance("refuses remove_message on a fenced session and keeps the row", () =>
    Effect.gen(function* () {
      yield* reset(refuseCalls)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "remove-message-refuse" })
      const message = yield* seedMessage(created.id)

      const exit = yield* session.removeMessage({ sessionID: created.id, messageID: message.id }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)

      // The load-bearing negative, with admission proven to have been consulted for this scope.
      expect(refuseCalls.reserved).toHaveLength(1)
      expect(refuseCalls.reserved[0]!.kind).toBe("remove_message")
      expect((yield* session.messages({ sessionID: created.id })).map((item) => item.info.id)).toEqual([message.id])
      expect(refuseCalls.activated).toEqual([])
    }),
  )

  itRefuse.instance("refuses remove_part on a fenced session", () =>
    Effect.gen(function* () {
      yield* reset(refuseCalls)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "remove-part-refuse" })
      const message = yield* seedMessage(created.id)

      const exit = yield* session
        .removePart({ sessionID: created.id, messageID: message.id, partID: PartID.ascending() })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(refuseCalls.reserved).toHaveLength(1)
      expect(refuseCalls.reserved[0]!.kind).toBe("remove_part")
    }),
  )
})

describe("SessionMutation ambient reuse", () => {
  itAdmit.instance("nested removals under an enclosing lease take ONE lease, not one per call", () =>
    Effect.gen(function* () {
      yield* reset(admitCalls)
      const session = yield* SessionNs.Service
      const closure = yield* SessionClosure.Service
      const created = yield* session.create({ title: "ambient-reuse" })
      const first = yield* seedMessage(created.id)
      const second = yield* seedMessage(created.id)

      // Stands in for `revert.cleanup`: one enclosing destructive operation that deletes N rows
      // through the lower guarded service. Tested here at the helper's own boundary rather than
      // through the revert stack, so a defect in one cannot be masked by the other.
      yield* SessionMutation.leased(closure, { sessions: [created.id], kind: "revert_cleanup" }, ambientBody(created.id))

      // Positive precondition: both deletions really happened.
      expect(yield* session.messages({ sessionID: created.id })).toEqual([])
      void first
      void second

      // The load-bearing claim. Without ambient reuse this would be 3 — the enclosing
      // `revert_cleanup` plus one `remove_message` per row — and cancellation would read three
      // concurrent destructive mutations where there is one.
      expect(admitCalls.reserved).toHaveLength(1)
      expect(admitCalls.reserved[0]!.kind).toBe("revert_cleanup")
    }),
  )

  itAdmit.instance("does NOT reuse an enclosing lease for a session it does not cover", () =>
    Effect.gen(function* () {
      yield* reset(admitCalls)
      const session = yield* SessionNs.Service
      const closure = yield* SessionClosure.Service
      const covered = yield* session.create({ title: "ambient-covered" })
      const other = yield* session.create({ title: "ambient-other" })
      const message = yield* seedMessage(other.id)

      // Coverage must be TOTAL. A lease held on one session must not license destruction in
      // another, or the scope whose fences were actually checked would be silently widened.
      yield* SessionMutation.leased(
        closure,
        { sessions: [covered.id], kind: "revert_cleanup" },
        Effect.gen(function* () {
          const inner = yield* SessionNs.Service
          yield* inner.removeMessage({ sessionID: other.id, messageID: message.id })
        }),
      )

      expect(admitCalls.reserved).toHaveLength(2)
      expect(admitCalls.reserved[0]!.kind).toBe("revert_cleanup")
      expect(admitCalls.reserved[1]!.kind).toBe("remove_message")
      expect(admitCalls.reserved[1]!.sessions.map(String)).toEqual([other.id])
    }),
  )
})

const ambientBody = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const session = yield* SessionNs.Service
    const all = yield* session.messages({ sessionID })
    for (const item of all) {
      yield* session.removeMessage({ sessionID, messageID: item.info.id })
    }
  })
