import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { CronService } from "@opencode-ai/core/cron/service"
import { CronJob } from "@opencode-ai/core/cron/job"
import { Agent } from "@/agent/agent"
import { Truncate } from "@/tool/truncate"
import { CronAddTool, CronListTool, CronDeleteTool } from "@/tool/cron"
import { SessionID, MessageID } from "@/session/schema"
import * as TestClock from "effect/testing/TestClock"
import * as TestConsole from "effect/testing/TestConsole"

type AddInput = {
  sessionID: string
  prompt: string
  intervalMs: number
  agent?: string
  model?: string
  context?: unknown
}

function ctx(): any {
  return {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    callID: "call_test",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

let addedJobs: Array<AddInput> = []
let listedSessions: string[] = []
let removedJobs: Array<{ sessionID: string; jobId: string }> = []

const mockCron = Layer.succeed(
  CronService,
  CronService.of({
    add: (input: AddInput) =>
      Effect.gen(function* () {
        addedJobs.push(input)
        const now = 0
        return {
          id: `job_${addedJobs.length}`,
          sessionID: input.sessionID,
          prompt: input.prompt,
          intervalMs: input.intervalMs,
          agent: input.agent,
          model: input.model,
          createdAt: now,
          expiresAt: now + 7 * 24 * 60 * 60 * 1000,
          nextRunAt: now + input.intervalMs,
          runCount: 0,
          context: input.context,
        } satisfies CronJob
      }),
    list: (sessionID: string) =>
      Effect.gen(function* () {
        listedSessions.push(sessionID)
        return addedJobs
          .filter((j) => j.sessionID === sessionID)
          .map((j, i) => ({
            id: `job_${i + 1}`,
            sessionID: j.sessionID,
            prompt: j.prompt,
            intervalMs: j.intervalMs,
            agent: j.agent,
            model: j.model,
            createdAt: 0,
            expiresAt: 0,
            nextRunAt: 0,
            runCount: 0,
          })) satisfies Array<CronJob>
      }),
    remove: (sessionID: string, jobId: string) =>
      Effect.gen(function* () {
        removedJobs.push({ sessionID, jobId })
        return jobId === "all" ? addedJobs.filter((j) => j.sessionID === sessionID).length : 1
      }),
  }),
)

const mockTruncate = Layer.mock(Truncate.Service, {
  output: (text: string) => Effect.succeed({ content: text, truncated: false }),
})

const mockAgent = Layer.mock(Agent.Service, {
  get: () => Effect.succeed({} as any),
})

const testLayer = Layer.provideMerge(
  Layer.mergeAll(mockCron, mockTruncate, mockAgent),
  Layer.mergeAll(TestConsole.layer, TestClock.layer()),
)

const run = (effect: Effect.Effect<any, any, any>) => (Effect.runPromise as any)(effect.pipe(Effect.provide(testLayer)))

describe("cron tools", () => {
  test("cron_add registers a job and returns JSON output", async () => {
    addedJobs = []
    await run(
      Effect.gen(function* () {
        const toolInfo = yield* CronAddTool
        const tool = yield* toolInfo.init()
        const result = yield* (tool.execute as any)({ interval: "5m", prompt: "run tests" }, ctx())

        expect(result.title).toBe("cron: every 5m")
        const parsed = JSON.parse(result.output)
        expect(parsed.id).toBe("job_1")
        expect(parsed.prompt).toBe("run tests")
        expect(parsed.intervalMs).toBe(300_000)
        expect(addedJobs.length).toBe(1)
        expect(addedJobs[0].prompt).toBe("run tests")
        expect(addedJobs[0].intervalMs).toBe(300_000)
        expect(addedJobs[0].context).toEqual({ instance: undefined, workspace: undefined })
      }),
    )
  })

  test("cron_add catches errors and returns error JSON (renderError)", async () => {
    addedJobs = []
    await run(
      Effect.gen(function* () {
        const toolInfo = yield* CronAddTool
        const tool = yield* toolInfo.init()
        const result = yield* (tool.execute as any)({ interval: "30s", prompt: "too short" }, ctx())

        expect(result.title).toBe("cron error")
        const parsed = JSON.parse(result.output)
        expect(parsed.error).toContain("at least 1 minute")
      }),
    )
  })

  test("cron_list returns jobs for the session", async () => {
    addedJobs = [{ sessionID: "ses_test", prompt: "p", intervalMs: 120_000 }]
    listedSessions = []
    await run(
      Effect.gen(function* () {
        const toolInfo = yield* CronListTool
        const tool = yield* toolInfo.init()
        const result = yield* (tool.execute as any)({}, ctx())

        expect(result.title).toBe("1 cron job(s)")
        const parsed = JSON.parse(result.output)
        expect(parsed.length).toBe(1)
        expect(parsed[0].prompt).toBe("p")
        expect(listedSessions).toEqual(["ses_test"])
      }),
    )
  })

  test("cron_delete removes jobs and returns count", async () => {
    addedJobs = [
      { sessionID: "ses_test", prompt: "a", intervalMs: 120_000 },
      { sessionID: "ses_test", prompt: "b", intervalMs: 120_000 },
    ]
    removedJobs = []
    await run(
      Effect.gen(function* () {
        const toolInfo = yield* CronDeleteTool
        const tool = yield* toolInfo.init()
        const result = yield* (tool.execute as any)({ id: "all" }, ctx())

        expect(result.title).toBe("removed 2 job(s)")
        const parsed = JSON.parse(result.output)
        expect(parsed.removed).toBe(2)
        expect(removedJobs).toEqual([{ sessionID: "ses_test", jobId: "all" }])
      }),
    )
  })
})
