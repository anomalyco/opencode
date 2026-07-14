import { NodeFileSystem } from "@effect/platform-node"
import { Service } from "@opencode-ai/client/effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Global } from "@opencode-ai/core/global"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { expect, test } from "bun:test"
import { Effect, Schedule, Schema } from "effect"
import { createServer } from "node:http"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServiceConfig } from "../src/services/service-config"
import { Server } from "../src/services/server"

test("managed reconnect ensures the service on the first failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-reconnect-"))
  const starts: Service.StartReason[] = []
  try {
    const exit = await Effect.runPromise(
      Server.managedReconnect({
        file: path.join(root, "service.json"),
        onStart: (reason) => {
          starts.push(reason)
          throw new Error("service ensure invoked")
        },
      }).pipe(Effect.provide(NodeFileSystem.layer), Effect.exit),
    )
    expect(exit._tag).toBe("Failure")
    expect(starts).toEqual(["missing"])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("managed reconnect reuses a healthy service from another version", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-reconnect-version-"))
  const server = createServer((request, response) => {
    if (request.url !== "/api/health") {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ healthy: true, version: "older", pid: process.pid }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("Expected TCP server address")
  const file = path.join(root, "service.json")
  const url = `http://127.0.0.1:${address.port}`
  await Bun.write(file, JSON.stringify({ url, pid: process.pid, version: "older" }))
  try {
    const endpoint = await Effect.runPromise(
      Server.managedReconnect({ file, version: "newer", command: [path.join(root, "must-not-start")] }).pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(endpoint.url).toBe(url)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    )
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("local channel stores service config with the local service filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-"))
  try {
    await Effect.runPromise(
      ServiceConfig.set("hostname", "127.0.0.2").pipe(
        Effect.provide(Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(path.join(root, "config", "service-local.json")).json()).toEqual({
      hostname: "127.0.0.2",
    })
    expect(await Bun.file(path.join(root, "config", "service.json")).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("concurrent service processes elect one server", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-election-"))
  const database = path.join(root, "opencode.db")
  const env = {
    ...process.env,
    HOME: root,
    OPENCODE_DB: database,
    OPENCODE_TEST_HOME: root,
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
  }
  const sessionID = SessionV2.ID.make("ses_service_recovery")
  await withDatabase(
    database,
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make(root), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "recovery",
          directory: root,
          title: "recovery",
          version: "test",
          time_suspended: Date.now(),
        })
        .run()
        .pipe(Effect.orDie)
    }),
  )
  const command = [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"]
  const first = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })
  const second = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })

  try {
    const registration = path.join(root, "state", "opencode", "service-local.json")
    const info = await waitForInfo(registration)
    const winner = info.pid === first.pid ? first : second
    const loser = info.pid === first.pid ? second : first
    const exited = await Promise.race([loser.exited.then(() => true), Bun.sleep(10_000).then(() => false)])

    expect(exited).toBe(true)
    expect(winner.exitCode).toBe(null)
    expect(
      await withDatabase(
        database,
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          return yield* db
            .select({ timeSuspended: SessionTable.time_suspended })
            .from(SessionTable)
            .get()
            .pipe(Effect.orDie)
        }),
      ),
    ).toEqual({ timeSuspended: null })
    expect(await waitForExecutionStart(database, sessionID)).toBe(1)
  } finally {
    first.kill("SIGTERM")
    second.kill("SIGTERM")
    await Promise.all([first.exited, second.exited])
    await fs.rm(root, { recursive: true, force: true })
  }
})

function withDatabase<A, E>(file: string, effect: Effect.Effect<A, E, Database.Service>) {
  return Effect.runPromise(effect.pipe(Effect.provide(Database.layerFromPath(file)), Effect.scoped))
}

function waitForExecutionStart(file: string, sessionID: SessionV2.ID) {
  return withDatabase(
    file,
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      return yield* db
        .select({ id: EventTable.id, sessionID: EventTable.aggregate_id, type: EventTable.type })
        .from(EventTable)
        .all()
        .pipe(
          Effect.orDie,
          Effect.map((rows) =>
            rows.filter(
              (row) =>
                row.sessionID === sessionID &&
                row.type ===
                  EventV2.versionedType(
                    SessionEvent.Execution.Started.type,
                    SessionEvent.Execution.Started.durable.version,
                  ),
            ),
          ),
          Effect.filterOrFail((rows) => rows.length > 0),
          Effect.map((rows) => rows.length),
          Effect.retry(Schedule.spaced("50 millis").pipe(Schedule.both(Schedule.recurs(200)))),
        )
    }),
  )
}

async function waitForInfo(file: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await Bun.file(file)
      .json()
      .catch(() => undefined)
    if (value !== undefined) return Schema.decodeUnknownPromise(Service.Info)(value)
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for service registration")
}
