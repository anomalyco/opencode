import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { expect } from "bun:test"
import { ConfigMCP } from "@opencode-ai/schema/config/mcp"
import { Session } from "@opencode-ai/schema/session"
import { McpClient } from "@opencode-ai/core/mcp/client"
import { Effect, Fiber, Schedule, Schema } from "effect"
import { testEffect } from "./lib/effect"
import { hostEnvironmentLayer } from "./fixture/environment"

const it = testEffect(hostEnvironmentLayer)
const row = Schema.fromJsonString(Schema.Struct({ pid: Schema.Number, method: Schema.String }))
const read = (log: string) =>
  Effect.promise(() => Bun.file(log).text()).pipe(
    Effect.map((text) =>
      text
        .trim()
        .split("\n")
        .map((line) => Schema.decodeUnknownSync(row)(line)),
    ),
  )

const fixture = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(path.join(tmpdir(), "opencode-mcp-protocol-"))),
  (directory) => Effect.promise(() => rm(directory, { force: true, recursive: true })),
)

function config(mode: string, log: string, startup = 4_000, execution = 1_000) {
  return new ConfigMCP.Local({
    type: "local",
    command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-protocol-stdio.ts"), mode, log],
    timeout: { startup, execution },
  })
}

for (const mode of ["modern", "dual", "legacy-exit", "legacy-error", "legacy-silent"]) {
  it.live(`stdio ${mode} uses a disposable probe and the correct live protocol`, () =>
    Effect.gen(function* () {
      const log = path.join(yield* fixture, "messages.jsonl")
      const modern = mode === "modern" || mode === "dual"
      yield* Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* McpClient.connect("stdio", config(mode, log), import.meta.dir)
          expect(connection.instructions).toBe("stdio instructions")
          const toolsChanged = Promise.withResolvers<void>()
          const promptsChanged = Promise.withResolvers<void>()
          const resourcesChanged = Promise.withResolvers<void>()
          connection.onToolsChanged(toolsChanged.resolve)
          connection.onPromptsChanged(promptsChanged.resolve)
          connection.onResourcesChanged(resourcesChanged.resolve)
          expect((yield* connection.tools()).map((tool) => tool.name)).toEqual(["echo"])
          const result = yield* connection.callTool({ name: "echo", sessionID: Session.ID.make("ses_mcp_stdio") })
          expect(result.content).toEqual([{ type: "text", text: "stdio complete" }])
          expect(result.structured).toMatchObject({ roots: { roots: [{ uri: expect.stringContaining("file://") }] } })
          expect(result.structured).toHaveProperty("sessionID", "ses_mcp_stdio")
          yield* Effect.promise(() =>
            Promise.all([toolsChanged.promise, promptsChanged.promise, resourcesChanged.promise]),
          ).pipe(Effect.timeout("1 second"))
          const requests = yield* read(log)
          const pids = requests.filter((entry) => entry.method === "spawn").map((entry) => entry.pid)
          expect(pids).toHaveLength(2)
          expect(pids[0]).not.toBe(pids[1])
          expect(requests.filter((entry) => entry.pid === pids[0]).map((entry) => entry.method)).toEqual([
            "spawn",
            "server/discover",
          ])
          const live = requests.filter((entry) => entry.pid === pids[1]).map((entry) => entry.method)
          expect(live.includes("server/discover")).toBe(false)
          expect(live.includes("initialize")).toBe(!modern)
          expect(live.includes("notifications/initialized")).toBe(!modern)
          expect(live.includes("subscriptions/listen")).toBe(modern)
        }),
      )
      for (const entry of (yield* read(log)).filter((entry) => entry.method === "spawn")) {
        expect(() => process.kill(entry.pid, 0)).toThrow()
      }
    }),
  )
}

it.live("stdio startup interruption reaps the probe without launching a session process", () =>
  Effect.gen(function* () {
    const log = path.join(yield* fixture, "messages.jsonl")
    const fiber = yield* McpClient.connect("stdio", config("stall", log, 5_000), import.meta.dir).pipe(
      Effect.forkScoped,
    )
    yield* Effect.promise(() => Bun.file(log).exists()).pipe(
      Effect.repeat({ while: (exists) => !exists, schedule: Schedule.spaced("10 millis") }),
      Effect.timeout("2 seconds"),
    )
    yield* Fiber.interrupt(fiber)
    const requests = yield* read(log)
    const spawns = requests.filter((entry) => entry.method === "spawn")
    expect(spawns).toHaveLength(1)
    expect(requests.some((entry) => entry.method === "initialize")).toBe(false)
    for (const entry of spawns) expect(() => process.kill(entry.pid, 0)).toThrow()
  }),
)

it.live("modern stdio timeout sends cancellation and does not resume MRTR", () =>
  Effect.gen(function* () {
    const log = path.join(yield* fixture, "messages.jsonl")
    yield* Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* McpClient.connect("stdio", config("modern", log, 4_000, 150), import.meta.dir)
        yield* connection.tools()
        const error = yield* connection.callTool({ name: "echo", args: { slow: true } }).pipe(Effect.flip)
        expect(error.message).toBe("Request timed out")
      }),
    )
    const requests = yield* read(log)
    expect(requests.filter((entry) => entry.method === "tools/call")).toHaveLength(1)
    expect(requests.some((entry) => entry.method === "notifications/cancelled")).toBe(true)
    expect(requests.some((entry) => entry.method === "aborted")).toBe(true)
  }),
)

it.live("startup deadline closes both processes without cancelling initialize", () =>
  Effect.gen(function* () {
    const log = path.join(yield* fixture, "messages.jsonl")
    const error = yield* McpClient.connect("stdio", config("legacy-hang", log, 1_500), import.meta.dir).pipe(
      Effect.flip,
    )
    expect(error.message).toBe("MCP startup timed out")
    const requests = yield* read(log)
    expect(requests.filter((entry) => entry.method === "spawn")).toHaveLength(2)
    expect(requests.some((entry) => entry.method === "initialize")).toBe(true)
    expect(requests.some((entry) => entry.method === "notifications/cancelled")).toBe(false)
    for (const entry of requests.filter((entry) => entry.method === "spawn"))
      expect(() => process.kill(entry.pid, 0)).toThrow()
  }),
)
