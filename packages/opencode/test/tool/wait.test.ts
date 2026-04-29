import { describe, expect } from "bun:test"
import * as fs from "fs/promises"
import * as nodePath from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { WaitTool } from "../../src/tool/wait"
import { Truncate } from "@/tool/truncate"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(CrossSpawnSpawner.defaultLayer, AppFileSystem.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer),
)

const baseCtx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.wait", () => {
  it.live("waits in the same tool execution", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const updates: Array<{ title?: string }> = []
        const toolInfo = yield* WaitTool
        const tool = yield* toolInfo.init()
        const result = yield* tool.execute(
          { seconds: 1, reason: "test delay" },
          {
            ...baseCtx,
            metadata: (input) =>
              Effect.sync(() => {
                updates.push(input)
              }),
          },
        )

        expect(updates[0]?.title).toBe("wait 1s - test delay")
        expect(result.metadata.mode).toBe("fixed")
        expect(result.metadata.aborted).toBe(false)
        expect(result.output).toContain("test delay")
      }),
    ),
  )

  it.live("returns when aborted", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 20)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            clearTimeout(timer)
          }),
        )

        const toolInfo = yield* WaitTool
        const tool = yield* toolInfo.init()
        const result = yield* tool.execute(
          { seconds: 3600, reason: "test cancel" },
          { ...baseCtx, abort: controller.signal },
        )

        expect(result.metadata.mode).toBe("fixed")
        expect(result.metadata.aborted).toBe(true)
        expect(result.output).toContain("Wait cancelled")
      }),
    ),
  )

  it.live("respects custom file polling and stability windows", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const target = nodePath.join(dir, "download.bin")
        yield* Effect.promise(() => fs.writeFile(target, Buffer.alloc(8)))

        const toolInfo = yield* WaitTool
        const tool = yield* toolInfo.init()
        const result = yield* tool.execute(
          {
            seconds: 1,
            reason: "fast file check",
            until_file: "download.bin",
            poll_interval_ms: 100,
            stable_ms: 100,
          },
          baseCtx,
        )

        expect(result.metadata.mode).toBe("until_file")
        expect(result.metadata.ready).toBe(true)
        expect(result.metadata.poll_interval_ms).toBe(100)
        expect(result.metadata.stable_ms).toBe(100)
        expect(result.metadata.elapsed_seconds ?? 999).toBeLessThan(1)
      }),
    ),
  )

  it.live("returns early when a cancel sentinel appears", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const cancelPath = nodePath.join(dir, "stop.wait")
        const timer = setTimeout(() => {
          void fs.writeFile(cancelPath, "stop")
        }, 150)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            clearTimeout(timer)
          }),
        )

        const toolInfo = yield* WaitTool
        const tool = yield* toolInfo.init()
        const result = yield* tool.execute(
          {
            seconds: 3,
            reason: "sentinel cancel",
            poll_interval_ms: 100,
            cancel_if_file: "stop.wait",
          },
          baseCtx,
        )

        expect(result.metadata.mode).toBe("fixed")
        expect(result.metadata.aborted).toBe(false)
        expect(result.metadata.cancelled_by_file).toBe(true)
        expect(result.output).toContain("sentinel file")
      }),
    ),
  )

  it.live("returns early when until_url succeeds", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const server = Bun.serve({ port: 0, fetch: () => new Response("ok", { status: 200 }) })
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            await server.stop(true)
          }),
        )
        const url = `http://127.0.0.1:${server.port}/`

        const toolInfo = yield* WaitTool
        const tool = yield* toolInfo.init()
        const result = yield* tool.execute(
          {
            seconds: 3,
            reason: "service health",
            until_url: url,
            poll_interval_ms: 100,
          },
          baseCtx,
        )

        expect(result.metadata.mode).toBe("until_url")
        expect(result.metadata.ready).toBe(true)
        expect(result.metadata.url_status).toBe(200)
        expect(result.metadata.elapsed_seconds ?? 999).toBeLessThan(2)
      }),
    ),
  )

  it.live("times out when until_url never returns the expected status", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const server = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 503 }) })
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            await server.stop(true)
          }),
        )
        const url = `http://127.0.0.1:${server.port}/`

        const toolInfo = yield* WaitTool
        const tool = yield* toolInfo.init()
        const result = yield* tool.execute(
          {
            seconds: 1,
            reason: "expect 200",
            until_url: url,
            poll_interval_ms: 100,
          },
          baseCtx,
        )

        expect(result.metadata.mode).toBe("until_url")
        expect(result.metadata.ready).toBeFalsy()
        expect(result.metadata.timed_out).toBe(true)
        expect(result.metadata.url_status).toBe(503)
      }),
    ),
  )

  it.live("returns early when until_pid_exit process is gone", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const toolInfo = yield* WaitTool
        const tool = yield* toolInfo.init()
        // Pick a pid extremely unlikely to be alive on a test runner.
        const result = yield* tool.execute(
          {
            seconds: 2,
            reason: "absent pid",
            until_pid_exit: 2_147_483_640,
            poll_interval_ms: 100,
          },
          baseCtx,
        )

        expect(result.metadata.mode).toBe("until_pid_exit")
        expect(result.metadata.exited).toBe(true)
        expect(result.metadata.elapsed_seconds ?? 999).toBeLessThan(1)
      }),
    ),
  )

  it.live("returns early when until_text pattern matches", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const target = nodePath.join(dir, "build.log")
        yield* Effect.promise(() => fs.writeFile(target, "starting...\n"))
        const timer = setTimeout(() => {
          void fs.appendFile(target, "BUILD SUCCESSFUL in 2s\n").catch(() => undefined)
        }, 200)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            clearTimeout(timer)
          }),
        )

        const toolInfo = yield* WaitTool
        const tool = yield* toolInfo.init()
        const result = yield* tool.execute(
          {
            seconds: 3,
            reason: "wait for build success",
            until_text: "build.log",
            until_text_pattern: "BUILD SUCCESSFUL",
            poll_interval_ms: 100,
          },
          baseCtx,
        )

        expect(result.metadata.mode).toBe("until_text")
        expect(result.metadata.matched).toBe(true)
        expect(result.metadata.match).toContain("BUILD SUCCESSFUL")
        expect(result.metadata.elapsed_seconds ?? 999).toBeLessThan(2)
      }),
    ),
  )

  it.live("times out when until_text pattern never matches", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const target = nodePath.join(dir, "noisy.log")
        yield* Effect.promise(() => fs.writeFile(target, "irrelevant chatter\n"))

        const toolInfo = yield* WaitTool
        const tool = yield* toolInfo.init()
        const result = yield* tool.execute(
          {
            seconds: 1,
            reason: "expect missing pattern",
            until_text: "noisy.log",
            until_text_pattern: "BUILD FAILED",
            poll_interval_ms: 100,
          },
          baseCtx,
        )

        expect(result.metadata.mode).toBe("until_text")
        expect(result.metadata.matched).toBeFalsy()
        expect(result.metadata.timed_out).toBe(true)
      }),
    ),
  )

  it.live("rejects until_text without until_text_pattern", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const toolInfo = yield* WaitTool
        const tool = yield* toolInfo.init()
        const exit = yield* Effect.exit(
          tool.execute(
            {
              seconds: 2,
              reason: "incomplete params",
              until_text: "any.log",
              poll_interval_ms: 100,
            },
            baseCtx,
          ),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.pretty(exit.cause)).toContain("until_text_pattern")
        }
      }),
    ),
  )
})
