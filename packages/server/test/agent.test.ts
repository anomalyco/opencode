import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

const reviewer = ["---", "description: Reviews changes", "mode: primary", "---", "Review the change."].join("\n")

it.live("waits for plugin initialization before listing agents", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-agent-endpoint-")))
    yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "agents")))
    yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "agents", "reviewer.md"), reviewer))
    const server = yield* startServer(tmp.path)
    const url = new URL("/api/agent", server.base)
    url.searchParams.set("location[directory]", tmp.path)
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))

    expect(response.status).toBe(200)
    const body: unknown = yield* Effect.promise(() => response.json())
    if (!isRecord(body) || !Array.isArray(body["data"])) throw new Error("Expected an agent list response")
    expect(body["data"].some((agent) => isRecord(agent) && agent["id"] === "reviewer")).toBeTrue()
  }),
)

it.live("waits for plugin initialization before getting an agent", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-agent-endpoint-")))
    yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "agents")))
    yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "agents", "reviewer.md"), reviewer))
    const server = yield* startServer(tmp.path)
    const url = new URL("/api/agent/reviewer", server.base)
    url.searchParams.set("location[directory]", tmp.path)
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))

    expect(response.status).toBe(200)
    const body: unknown = yield* Effect.promise(() => response.json())
    if (!isRecord(body) || !isRecord(body["data"])) throw new Error("Expected an agent response")
    expect(body["data"]["description"]).toBe("Reviews changes")
  }),
)

it.live("waits for plugin activation after a location reload", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-agent-endpoint-")))
    const file = path.join(tmp.path, "agents", "reviewer.md")
    yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "agents")))
    yield* Effect.promise(() => fs.writeFile(file, reviewer))
    const server = yield* startServer(tmp.path)
    const url = new URL("/api/agent/reviewer", server.base)
    url.searchParams.set("location[directory]", tmp.path)
    // Setup only: let the first location finish activating so the assertion below is about the reload.
    yield* Effect.promise(() => fetch(url, { headers: server.headers })).pipe(
      Effect.filterOrFail((response) => response.status === 200),
      Effect.retry({ times: 50, schedule: Schedule.spaced("100 millis") }),
    )

    yield* Effect.promise(() => fs.writeFile(file, reviewer.replace("Reviews changes", "Reviews diffs")))
    const reload = yield* Effect.promise(() =>
      fetch(new URL("/api/location/reload", server.base), { method: "POST", headers: server.headers }),
    )
    expect(reload.status).toBe(204)
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))

    expect(response.status).toBe(200)
    const body: unknown = yield* Effect.promise(() => response.json())
    if (!isRecord(body) || !isRecord(body["data"])) throw new Error("Expected an agent response")
    expect(body["data"]["description"]).toBe("Reviews diffs")
  }),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
