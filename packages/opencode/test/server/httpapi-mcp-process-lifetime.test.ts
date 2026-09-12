import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { McpPaths } from "../../src/server/routes/instance/httpapi/groups/mcp"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const stdioFixture = path.join(import.meta.dir, "../fixture/mcp-proc-lifetime.ts")
const pidFile = path.join(os.tmpdir(), `mcp-proc-lifetime-${process.pid}.pid`)

const context = Context.empty() as Context.Context<unknown>
const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()).pipe(Effect.ignore))
  }),
)
const it = testEffect(testStateLayer)

// Every process the fixture is asked to spawn appends its pid. A process we
// spawn but never dispose stays alive and remains visible here — that is the
// exact "never disposed" leak from #47727.
const childPids = Effect.sync(() => {
  try {
    const values = readFileSync(pidFile, "utf8").trim().split("\n").filter(Boolean)
    return values.map((v) => Number.parseInt(v, 10)).filter(Number.isInteger)
  } catch {
    return [] as number[]
  }
})

const alivePids = Effect.gen(function* () {
  const pids = yield* childPids
  return pids.filter((pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })
})

const aliveCount = Effect.map(alivePids, (pids) => pids.length)

function request(
  handler: ReturnType<typeof HttpApiApp.webHandler>,
  route: string,
  directory: string,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers)
  headers.set("x-opencode-directory", directory)
  return Effect.promise(() =>
    Promise.resolve(
      handler.handler(new Request(`http://localhost${route}`, { ...init, headers }), context),
    ),
  )
}

describe("MCP subprocess lifetime under the instance HttpApi", () => {
  it.instance(
    "keeps one live MCP child per directory across repeated interactions and reaps it on disconnect",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const dir = tmp.directory
        const handler = HttpApiApp.webHandler()
        const routeFor = (route: string) => route.replace(":name", "demo")

        const connected = yield* request(handler, routeFor(McpPaths.connect), dir, { method: "POST" })
        expect(connected.status).toBe(200)
        yield* pollWithTimeout(
          Effect.map(aliveCount, (n) => (n >= 1 ? true : undefined)),
          "MCP child did not come alive after connect",
          "10 seconds",
        )

        // OpenChamber-style clients keep polling MCP state for the same
        // directory. Every interaction must reuse the connected child instead
        // of piling up fresh processes per request.
        // Ref: https://github.com/anomalyco/opencode/issues/47727
        for (let i = 0; i < 5; i++) {
          const status = yield* request(handler, McpPaths.status, dir)
          expect(status.status).toBe(200)
          const again = yield* request(handler, routeFor(McpPaths.connect), dir, { method: "POST" })
          expect(again.status).toBe(200)
        }
        yield* pollWithTimeout(
          Effect.map(aliveCount, (n) => (n === 1 ? true : undefined)),
          "Live MCP children accumulated across repeated interactions",
        )

        const disconnected = yield* request(handler, routeFor(McpPaths.disconnect), dir, { method: "POST" })
        expect(disconnected.status).toBe(200)
        yield* pollWithTimeout(
          Effect.map(aliveCount, (n) => (n === 0 ? true : undefined)),
          "MCP child was not reaped after disconnect",
        )
      }),
    {
      config: {
        mcp: {
          demo: {
            type: "local",
            command: [process.execPath, stdioFixture],
            environment: { PROCLIFETIME_PID_FILE: pidFile },
          },
        },
      },
    },
  )
})