import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Deferred, Effect, Layer, Ref, Scope } from "effect"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { HeartbeatScheduler } from "@/heartbeat/scheduler"
import { HeartbeatStore } from "@/heartbeat/store"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { MessageID, SessionID } from "@/session/schema"
import type { SessionPrompt } from "@/session/prompt"
import { HeartbeatTool } from "@/tool/heartbeat"
import type { TaskPromptOps } from "@/tool/task"
import { Truncate } from "@/tool/truncate"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const layer = LayerNode.compile(
  LayerNode.group([
    Agent.node,
    BackgroundJob.node,
    Database.node,
    HeartbeatStore.node,
    Config.node,
    CrossSpawnSpawner.node,
    Truncate.node,
    RuntimeFlags.node,
    Ripgrep.node,
  ]),
  [[RuntimeFlags.node, RuntimeFlags.layer()]],
)
const it = testEffect(layer)

afterEach(async () => {
  await disposeAllInstances()
})

function reply(sessionID: SessionID): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: MessageID.ascending(),
      sessionID,
      mode: "build",
      agent: "build",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: ModelV2.ID.make("test-model"),
      providerID: ProviderV2.ID.make("test"),
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [],
  }
}

const seedSession = Effect.fn("HeartbeatTest.seedSession")(function* (sessionID: SessionID) {
  const { db } = yield* Database.Service
  const projectID = ProjectV2.ID.global
  yield* db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make("/"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: projectID,
      slug: "heartbeat-session",
      directory: "/tmp",
      title: "heartbeat session",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

describe("tool.heartbeat", () => {
  it.instance("fires once and replaces a pending heartbeat for the same task", () =>
    Effect.gen(function* () {
      const fired = yield* Deferred.make<SessionPrompt.PromptInput>()
      const count = yield* Ref.make(0)
      const promptOps: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (text) => Effect.succeed([{ type: "text", text }]),
        prompt: (input) =>
          Effect.all([Ref.update(count, (value) => value + 1), Deferred.succeed(fired, input)], { discard: true }).pipe(
            Effect.as(reply(input.sessionID)),
          ),
      }
      const sessionID = SessionID.make("ses_heartbeat")
      yield* seedSession(sessionID)
      const jobs = yield* BackgroundJob.Service
      const store = yield* HeartbeatStore.Service
      const tool = yield* HeartbeatTool
      const heartbeat = yield* tool.init()
      const context = {
        sessionID,
        messageID: MessageID.make("msg_heartbeat"),
        callID: "call_heartbeat",
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        extra: { promptOps },
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const first = yield* heartbeat.execute(
        {
          task: "fuzz matrix",
          delay_seconds: 2,
          interval_seconds: 10,
          backoff: "exponential",
          max_interval_seconds: 60,
          max_checks: 3,
        },
        context,
      )
      const second = yield* heartbeat.execute({ task: "fuzz matrix", delay_seconds: 1 }, context)
      expect(first.metadata.jobId).toBe(second.metadata.jobId)
      expect(second.metadata).toMatchObject({ checkNumber: 1, nextDelaySeconds: 10 })

      const running = yield* heartbeat.execute({ action: "status", task: "fuzz matrix" }, context)
      expect(running.metadata).toMatchObject({ status: "running", checkNumber: 1 })
      expect(yield* store.get(String(second.metadata.jobId))).toMatchObject({
        status: "scheduled",
        revision: 2,
        checkNumber: 1,
      })

      const input = yield* Deferred.await(fired).pipe(Effect.timeout("3 seconds"))
      expect(input.sessionID).toBe(sessionID)
      expect(input.agent).toBe("build")
      expect(input.parts[0]).toMatchObject({
        type: "text",
        synthetic: true,
      })
      if (input.parts[0]?.type !== "text") throw new Error("expected heartbeat text")
      expect(input.parts[0].text).toContain('<heartbeat task="fuzz matrix" check="1/3">')
      expect(input.parts[0].text).toContain("No-thinking monitoring turn")

      const settled = yield* jobs.wait({ id: String(second.metadata.jobId), timeout: 2000 })
      expect(settled.info?.status).toBe("completed")
      yield* Effect.sleep("20 millis")

      const completed = yield* heartbeat.execute({ action: "status", task: "fuzz matrix" }, context)
      expect(completed.metadata).toMatchObject({ status: "completed", checkNumber: 1 })

      const followup = yield* heartbeat.execute({ action: "schedule", task: "fuzz matrix" }, context)
      expect(followup.metadata).toMatchObject({
        checkNumber: 2,
        delaySeconds: 10,
        nextDelaySeconds: 20,
        backoff: "exponential",
      })
      const cancelled = yield* heartbeat.execute({ action: "cancel", task: "fuzz matrix" }, context)
      expect(cancelled.metadata.status).toBe("cancelled")

      yield* Effect.sleep("1200 millis")
      expect(yield* Ref.get(count)).toBe(1)
    }),
  )

  it.instance("re-arms a persisted pending heartbeat without incrementing its check", () =>
    Effect.gen(function* () {
      const sessionID = SessionID.make("ses_heartbeat_restart")
      yield* seedSession(sessionID)
      const delivered = yield* Deferred.make<HeartbeatStore.Info>()
      const promptOps: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (text) => Effect.succeed([{ type: "text", text }]),
        prompt: (input) => Effect.succeed(reply(input.sessionID)),
      }
      const jobs = yield* BackgroundJob.Service
      const store = yield* HeartbeatStore.Service
      const scope = yield* Scope.Scope
      const tool = yield* HeartbeatTool
      const heartbeat = yield* tool.init()
      const context = {
        sessionID,
        messageID: MessageID.make("msg_heartbeat_restart"),
        callID: "call_heartbeat_restart",
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        extra: { promptOps },
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const scheduled = yield* heartbeat.execute({ task: "restart recovery", delay_seconds: 1, max_checks: 5 }, context)
      const jobID = String(scheduled.metadata.jobId)
      const saved = yield* store.get(jobID)
      if (!saved) throw new Error("expected durable heartbeat row")
      yield* jobs.cancel(jobID)

      expect(yield* store.get(jobID)).toMatchObject({ status: "scheduled", checkNumber: 1 })
      yield* HeartbeatScheduler.arm({
        background: jobs,
        store,
        scope,
        heartbeat: saved,
        deliver: (current) => Deferred.succeed(delivered, current),
      })

      const fired = yield* Deferred.await(delivered).pipe(Effect.timeout("3 seconds"))
      expect(fired).toMatchObject({ revision: saved.revision, checkNumber: 1 })
      yield* Effect.sleep("20 millis")
      expect(yield* store.get(jobID)).toMatchObject({ status: "fired", checkNumber: 1 })
    }),
  )

  it.instance("retains the persisted timing policy when scheduling the next check", () =>
    Effect.gen(function* () {
      const sessionID = SessionID.make("ses_heartbeat_policy")
      yield* seedSession(sessionID)
      const store = yield* HeartbeatStore.Service
      const tool = yield* HeartbeatTool
      const heartbeat = yield* tool.init()
      const jobID = `heartbeat:${sessionID}:persisted policy`
      const now = Date.now()
      const saved = yield* store.schedule({
        jobID,
        sessionID,
        task: "persisted policy",
        directory: "/tmp",
        agent: "build",
        checkNumber: 1,
        maxChecks: 8,
        delaySeconds: 37,
        initialDelaySeconds: 37,
        intervalSeconds: 41,
        backoff: "linear",
        maxIntervalSeconds: 97,
        nextDelaySeconds: 41,
        scheduledAt: now,
        firesAt: now + 37_000,
      })
      const claimed = yield* store.claim(jobID, saved.revision)
      if (!claimed) throw new Error("expected heartbeat claim")
      yield* store.complete(jobID, claimed.revision)

      const promptOps: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (text) => Effect.succeed([{ type: "text", text }]),
        prompt: (input) => Effect.succeed(reply(input.sessionID)),
      }
      const context = {
        sessionID,
        messageID: MessageID.make("msg_heartbeat_policy"),
        callID: "call_heartbeat_policy",
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        extra: { promptOps },
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const next = yield* heartbeat.execute({ task: "persisted policy", delay_seconds: 60 }, context)
      expect(next.metadata).toMatchObject({
        initialDelaySeconds: 37,
        intervalSeconds: 41,
        backoff: "linear",
        maxIntervalSeconds: 97,
        checkNumber: 2,
      })
      expect(yield* store.get(jobID)).toMatchObject({
        initialDelaySeconds: 37,
        intervalSeconds: 41,
        backoff: "linear",
        maxIntervalSeconds: 97,
        checkNumber: 2,
      })
      yield* heartbeat.execute({ action: "cancel", task: "persisted policy" }, context)
    }),
  )
})
