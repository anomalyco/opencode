import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Truncate } from "@/tool/truncate"
import { BashJobsTool } from "../../src/tool/bash-jobs"
import { testInstanceStoreLayer, tmpdirScoped, provideInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const jobsLayer = Layer.mergeAll(
  LayerNode.compile(LayerNode.group([BackgroundJob.node, CrossSpawnSpawner.node, Truncate.node, Agent.node])),
  testInstanceStoreLayer,
)
const it = testEffect(jobsLayer)

const initJobsTool = Effect.fn("BashJobsTest.init")(function* () {
  const info = yield* BashJobsTool
  return yield* info.init()
})

describe("tool.bash_jobs", () => {
  it.live("lists background shell jobs with status and log path", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* provideInstance(tmp)(
        Effect.gen(function* () {
          const jobs = yield* BackgroundJob.Service
          const started = yield* jobs.start({
            type: "bash",
            title: "sleep 30",
            metadata: { command: "sleep 30", logPath: "/tmp/fake-log.txt" },
            run: Effect.gen(function* () {
              yield* Effect.sleep("30 seconds")
              return "done"
            }),
          })
          const subagent = yield* jobs.start({
            type: "task",
            title: "inspect bug",
            metadata: { sessionId: "ses_child", background: true },
            run: Effect.gen(function* () {
              yield* Effect.sleep("30 seconds")
              return "done"
            }),
          })
          const def = yield* initJobsTool()

          const result = yield* def.execute(
            { action: "list" },
            {
              sessionID: started.id as never,
              messageID: started.id as never,
              agent: "build",
              abort: new AbortController().signal,
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )

          expect(result.metadata.action).toBe("list")
          expect(result.metadata.count).toBe(2)
          expect(result.output).toContain(started.id)
          expect(result.output).toContain("[bash] [running]")
          expect(result.output).toContain("sleep 30")
          expect(result.output).toContain("/tmp/fake-log.txt")
          expect(result.output).toContain("[task] [running]")
          expect(result.output).toContain("inspect bug")
          expect(result.output).toContain("(session: ses_child)")

          yield* jobs.cancel(started.id)
          yield* jobs.cancel(subagent.id)
        }),
      )
    }),
  )

  it.live("kills a running background job", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* provideInstance(tmp)(
        Effect.gen(function* () {
          const jobs = yield* BackgroundJob.Service
          const started = yield* jobs.start({
            type: "bash",
            title: "sleep 30",
            metadata: { command: "sleep 30" },
            run: Effect.gen(function* () {
              yield* Effect.sleep("30 seconds")
              return "done"
            }),
          })
          const def = yield* initJobsTool()

          const result = yield* def.execute(
            { action: "kill", job_id: started.id },
            {
              sessionID: started.id as never,
              messageID: started.id as never,
              agent: "build",
              abort: new AbortController().signal,
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )

          expect(result.metadata.status).toBe("cancelled")
          expect(result.output).toContain("Cancelled")

          const waited = yield* jobs.wait({ id: started.id })
          expect(waited.info?.status).toBe("cancelled")
        }),
      )
    }),
  )

  it.live("reports unknown job ids", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* provideInstance(tmp)(
        Effect.gen(function* () {
          const def = yield* initJobsTool()
          const result = yield* def.execute(
            { action: "kill", job_id: "job_missing" },
            {
              sessionID: "job_missing" as never,
              messageID: "job_missing" as never,
              agent: "build",
              abort: new AbortController().signal,
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )
          expect(result.output).toContain("No background job found")
        }),
      )
    }),
  )
})
