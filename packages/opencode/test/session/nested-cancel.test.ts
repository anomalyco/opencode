import { afterEach, describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable } from "@opencode-ai/core/session/sql"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { inArray } from "drizzle-orm"
import { Effect, Layer, Option } from "effect"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Image } from "@/image/image"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { SessionPrompt } from "@/session/prompt"
import { SessionProcessor } from "@/session/processor"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { LLM } from "@/session/llm"
import { Instruction } from "@/session/instruction"
import { SystemPrompt } from "@/session/system"
import { MessageID, SessionID } from "@/session/schema"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { disposeAllInstances } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

// Abort-/cancel hardening for nested subagent trees (design-final §4.5, plan
// T3): the background-job cancel cascade must survive a completed mid-tree
// job (the release race), match jobs by their rootSessionId metadata, and use
// the session tree itself as a second cancel source when the metadata chain
// is broken.

afterEach(async () => {
  await disposeAllInstances()
})

const base = Layer.mergeAll(
  BackgroundJob.defaultLayer,
  Database.defaultLayer,
  EventV2Bridge.defaultLayer,
  Session.defaultLayer,
  SessionRunState.defaultLayer,
  SessionStatus.defaultLayer,
)

const it = testEffect(base)

// SessionPrompt with every service the cancel path never touches stubbed out:
// the tests pin the real cancel wiring (Session.descendants seeding
// SessionRunState.cancel) against the real Session/RunState/BackgroundJob.
// Any call into a stub would fail the test — which is exactly right, because
// cancel must not depend on prompt-path services.
const dead = <I>() => ({}) as unknown as I
const stubs = Layer.mergeAll(
  Layer.succeed(Agent.Service, dead<Agent.Interface>()),
  Layer.succeed(Provider.Service, dead<Provider.Interface>()),
  Layer.succeed(SessionProcessor.Service, dead<SessionProcessor.Interface>()),
  Layer.succeed(SessionCompaction.Service, dead<SessionCompaction.Interface>()),
  Layer.succeed(Plugin.Service, dead<Plugin.Interface>()),
  Layer.succeed(Command.Service, dead<Command.Interface>()),
  Layer.succeed(Config.Service, dead<Config.Interface>()),
  Layer.succeed(Permission.Service, dead<Permission.Interface>()),
  Layer.succeed(FSUtil.Service, dead<FSUtil.Interface>()),
  Layer.succeed(MCP.Service, dead<MCP.Interface>()),
  Layer.succeed(LSP.Service, dead<LSP.Interface>()),
  Layer.succeed(ToolRegistry.Service, dead<ToolRegistry.Interface>()),
  Layer.succeed(Truncate.Service, dead<Truncate.Interface>()),
  Layer.succeed(Image.Service, dead<Image.Interface>()),
  Layer.succeed(Instruction.Service, dead<Instruction.Interface>()),
  Layer.succeed(SessionRevert.Service, dead<SessionRevert.Interface>()),
  Layer.succeed(SessionSummary.Service, dead<SessionSummary.Interface>()),
  Layer.succeed(SystemPrompt.Service, dead<SystemPrompt.Interface>()),
  Layer.succeed(LLM.Service, dead<LLM.Interface>()),
  CrossSpawnSpawner.defaultLayer,
  RuntimeFlags.layer({}),
)

const prompt = testEffect(SessionPrompt.layer.pipe(Layer.provide(stubs), Layer.provideMerge(base)))

/** Root → child → grandchild session tree (depths 1–3). */
const seedTree = Effect.fn("NestedCancelTest.seedTree")(function* () {
  const sessions = yield* Session.Service
  const root = yield* sessions.create({ title: "root" })
  const child = yield* sessions.create({ parentID: root.id, title: "child" })
  const grandchild = yield* sessions.create({ parentID: child.id, title: "grandchild" })
  return { root, child, grandchild }
})

const startHangingJob = Effect.fn("NestedCancelTest.startHangingJob")(function* (
  id: SessionID,
  metadata: Record<string, unknown>,
) {
  const jobs = yield* BackgroundJob.Service
  yield* jobs.start({ id, type: "task", metadata, run: Effect.never })
})

describe("session.nested-cancel cancelBackgroundJobs", () => {
  it.instance("root cancel reaches a running grandchild job across a completed mid-tree job", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const { root, child, grandchild } = yield* seedTree()

      // The release race (design-final §4.5 Ü1): the mid-tree job has already
      // completed, but its metadata record must still bridge the chain from
      // the root to the running grandchild job.
      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: root.id, sessionId: child.id },
        run: Effect.succeed("done"),
      })
      const settled = yield* awaitWithTimeout(jobs.wait({ id: child.id }), "mid-tree job never completed")
      expect(settled.info?.status).toBe("completed")

      yield* startHangingJob(grandchild.id, { parentSessionId: child.id, sessionId: grandchild.id })

      yield* runState.cancel(root.id)

      expect((yield* jobs.get(grandchild.id))?.status).toBe("cancelled")
      // Completed jobs are bridges, never cancel targets.
      expect((yield* jobs.get(child.id))?.status).toBe("completed")
    }),
  )

  it.instance("root cancel matches jobs by rootSessionId when the parent metadata chain is missing", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { root, grandchild } = yield* seedTree()

      // No parentSessionId and no mid-tree job record at all: only the
      // rootSessionId ties the job to the tree.
      yield* startHangingJob(grandchild.id, { rootSessionId: root.id, sessionId: grandchild.id })

      // A job in a foreign tree must survive the cancel untouched.
      const otherRoot = yield* sessions.create({ title: "other root" })
      const otherChild = yield* sessions.create({ parentID: otherRoot.id, title: "other child" })
      yield* startHangingJob(otherChild.id, { rootSessionId: otherRoot.id, sessionId: otherChild.id })

      yield* runState.cancel(root.id)

      expect((yield* jobs.get(grandchild.id))?.status).toBe("cancelled")
      expect((yield* jobs.get(otherChild.id))?.status).toBe("running")
    }),
  )

  it.instance("cancel cascade converges on jobs started detached during the cascade", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const { root, child, grandchild } = yield* seedTree()

      // The escape window: cancelling the child's job starts a fresh detached
      // job under the tree from its interrupt finalizer — i.e. after the
      // cascade took its list() snapshot. BackgroundJob.cancel closes the job
      // scope and awaits the finalizer, so the late job deterministically
      // exists (and runs) before the cascade's next step.
      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: root.id, sessionId: child.id },
        run: Effect.never.pipe(
          Effect.onInterrupt(() =>
            jobs.start({
              id: grandchild.id,
              type: "task",
              metadata: { parentSessionId: child.id, sessionId: grandchild.id },
              run: Effect.never,
            }),
          ),
        ),
      })

      yield* runState.cancel(root.id)

      expect((yield* jobs.get(child.id))?.status).toBe("cancelled")
      // A one-shot snapshot lets the late job escape; the cascade must
      // re-list to convergence.
      expect((yield* jobs.get(grandchild.id))?.status).toBe("cancelled")
    }),
  )
})

describe("session.nested-cancel SessionPrompt.cancel", () => {
  prompt.instance("mid-tree cancel reaches a grandchild job whose metadata chain is broken", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessionPrompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const { root, child, grandchild } = yield* seedTree()

      // Broken metadata chain: neither parentSessionId nor rootSessionId —
      // only the session tree (Session.descendants) knows the grandchild
      // hangs below `child`.
      yield* startHangingJob(grandchild.id, { sessionId: grandchild.id })

      // Sibling subtree: cancelling `child` must seed descendants(child),
      // not the whole tree of `root`.
      const sibling = yield* sessions.create({ parentID: root.id, title: "sibling" })
      yield* startHangingJob(sibling.id, { sessionId: sibling.id })

      yield* sessionPrompt.cancel(child.id)

      expect((yield* jobs.get(grandchild.id))?.status).toBe("cancelled")
      expect((yield* jobs.get(sibling.id))?.status).toBe("running")
    }),
  )
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const seedUserMessage = Effect.fn("NestedCancelTest.seedUserMessage")(function* (sessionID: SessionID) {
  const sessions = yield* Session.Service
  yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
})

describe("session.nested-cancel remove", () => {
  it.instance("removing the root deletes the 3-level tree, its messages, and cancels jobs on every level", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { db } = yield* Database.Service
      const { root, child, grandchild } = yield* seedTree()
      const ids = [root.id, child.id, grandchild.id]

      for (const id of ids) yield* seedUserMessage(id)
      yield* startHangingJob(root.id, { sessionId: root.id })
      yield* startHangingJob(child.id, { parentSessionId: root.id, sessionId: child.id })
      yield* startHangingJob(grandchild.id, { parentSessionId: child.id, sessionId: grandchild.id })

      const before = yield* db.select().from(MessageTable).where(inArray(MessageTable.session_id, ids)).all()
      expect(before.length).toBe(3)

      yield* sessions.remove(root.id)

      for (const id of ids) {
        expect(Option.isNone(yield* sessions.get(id).pipe(Effect.option))).toBe(true)
        expect((yield* jobs.get(id))?.status).toBe("cancelled")
      }
      const after = yield* db.select().from(MessageTable).where(inArray(MessageTable.session_id, ids)).all()
      expect(after.length).toBe(0)
    }),
  )

  it.instance("remove converges on children spawned inside the deletion window", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { root, child } = yield* seedTree()

      // The deletion window: the cascade's recursive remove(child) cancels the
      // child's job, whose interrupt finalizer creates a NEW child under the
      // root — after the root's children() snapshot was already taken.
      // BackgroundJob.cancel awaits the finalizer, so the late child
      // deterministically exists before the cascade returns to the root.
      const late: { id?: SessionID } = {}
      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { sessionId: child.id },
        run: Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              const info = yield* sessions.create({ parentID: root.id, title: "late child" })
              late.id = info.id
            }),
          ),
        ),
      })

      yield* sessions.remove(root.id)

      // The late child must have been created inside the window…
      expect(late.id).toBeDefined()
      // …and the cascade must not leave it behind as an orphan that would
      // become a new root (resetting depth/tree limits for its subtree).
      expect(Option.isNone(yield* sessions.get(late.id!).pipe(Effect.option))).toBe(true)
      expect(yield* sessions.children(root.id)).toEqual([])
    }),
  )
})
