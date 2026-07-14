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
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServiceConfig } from "../src/services/service-config"

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

test("service filenames isolate installation channels", () => {
  expect(ServiceConfig.filename("latest")).toBe("service.json")
  expect(ServiceConfig.filename("local")).toBe("service-local.json")
  expect(ServiceConfig.filename("preview-a")).not.toBe(ServiceConfig.filename("preview-b"))
  expect(ServiceConfig.filename("preview-a")).not.toBe(ServiceConfig.filename("latest"))
  expect(ServiceConfig.versionBelongsToChannel("0.0.0-preview-a-1234", "preview-a")).toBe(true)
  expect(ServiceConfig.versionBelongsToChannel("0.0.0-preview-a-1234.2", "preview-a")).toBe(true)
  expect(ServiceConfig.versionBelongsToChannel("0.0.0-preview-a-other-1234", "preview-a")).toBe(false)
  expect(ServiceConfig.versionBelongsToChannel("1.2.3", "preview-a")).toBe(false)
})

test("preview registration migration never moves stable discovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-migration-"))
  const legacy = path.join(root, "service.json")
  const target = path.join(root, ServiceConfig.filename("preview-a"))
  try {
    await fs.writeFile(
      legacy,
      JSON.stringify({ id: "old-preview", version: "0.0.0-preview-a-1234", url: "http://localhost:4096", pid: 1 }),
    )
    await Effect.runPromise(
      ServiceConfig.migrateRegistration(legacy, target, "preview-a", "0.0.0-preview-a-5678").pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(legacy).exists()).toBe(true)
    expect(await Bun.file(target).json()).toMatchObject({ id: "old-preview" })

    await fs.rm(target)
    await fs.writeFile(legacy, JSON.stringify({ id: "stable", version: "1.2.3", url: "http://localhost:4096", pid: 1 }))
    await Effect.runPromise(
      ServiceConfig.migrateRegistration(legacy, target, "preview-a", "0.0.0-preview-a-5678").pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(legacy).exists()).toBe(true)
    expect(await Bun.file(target).exists()).toBe(false)

    await fs.writeFile(
      legacy,
      JSON.stringify({ id: "old-preview", version: "0.0.0-preview-a-1234", url: "http://localhost:4096", pid: 1 }),
    )
    await fs.writeFile(target, JSON.stringify({ id: "current-preview" }))
    await Effect.runPromise(
      ServiceConfig.migrateRegistration(legacy, target, "preview-a", "0.0.0-preview-a-5678").pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(legacy).exists()).toBe(true)
    expect(await Bun.file(target).json()).toMatchObject({ id: "current-preview" })
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
  const registration = path.join(root, "state", "opencode", "service-local.json")
  const processes = Array.from({ length: 10 }, () => Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" }))

  try {
    const info = await waitForInfo(registration)
    const winner = processes.find((process) => process.pid === info.pid)
    const losers = processes.filter((process) => process.pid !== info.pid)
    const exited = await Promise.all(
      losers.map((process) => Promise.race([process.exited.then(() => true), Bun.sleep(10_000).then(() => false)])),
    )

    expect(exited).toEqual(losers.map(() => true))
    expect(winner?.exitCode).toBe(null)
    expect(
      await fetch(new URL("/api/health", info.url), {
        headers: { authorization: "Basic " + btoa(`opencode:${info.password}`) },
      }).then((response) => response.json()),
    ).toMatchObject({
      healthy: true,
      pid: info.pid,
      instanceID: info.id,
      status: { type: "ready" },
    })
    const blockedTemp = registration + "." + info.id + ".tmp"
    await fs.mkdir(blockedTemp)
    await fs.rm(registration)
    await Bun.sleep(6_000)
    expect(await Bun.file(registration).exists()).toBe(false)
    await fs.rm(blockedTemp, { recursive: true })
    const restored = await waitForInfo(registration)
    expect(restored.id).toBe(info.id)
    expect(restored.pid).toBe(info.pid)
    await fs.writeFile(registration, "not-json")
    const repaired = await waitForInfo(registration)
    expect(repaired.id).toBe(info.id)
    expect(repaired.pid).toBe(info.pid)

    const contender = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })
    try {
      const contenderExited = await Promise.race([
        contender.exited.then(() => true),
        Bun.sleep(10_000).then(() => false),
      ])
      expect(contenderExited).toBe(true)
      expect((await waitForInfo(registration)).id).toBe(info.id)
    } finally {
      contender.kill("SIGTERM")
      await contender.exited
    }
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
    await Effect.runPromise(
      Service.stop({ file: registration }, { targetVersion: "next" }).pipe(Effect.provide(NodeFileSystem.layer)),
    )
    await winner?.exited
  } finally {
    processes.forEach((process) => process.kill("SIGTERM"))
    await Promise.all(processes.map((process) => process.exited))
    try {
      expect(await Bun.file(registration).exists()).toBe(false)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }
}, 60_000)

test("a failed service stays registered and owns the lock until stopped", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-failed-"))
  const database = path.join(root, "database")
  await fs.mkdir(database)
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
  const command = [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"]
  const registration = path.join(root, "state", "opencode", "service-local.json")
  const owner = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })

  try {
    const info = await waitForInfo(registration)
    const status = await Effect.runPromise(
      Service.status({ file: registration }).pipe(
        Effect.filterOrFail((status) => status.type === "failed"),
        Effect.retry(Schedule.spaced("50 millis").pipe(Schedule.both(Schedule.recurs(200)))),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(status).toEqual({
      type: "failed",
      version: info.version,
      message: "The background service could not start.",
      action: "Run `opencode service restart` after checking the service logs.",
    })
    expect(owner.exitCode).toBe(null)

    const contender = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })
    expect(await Promise.race([contender.exited.then(() => true), Bun.sleep(10_000).then(() => false)])).toBe(true)
    expect((await waitForInfo(registration)).id).toBe(info.id)
    expect(owner.exitCode).toBe(null)

    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    await owner.exited
    expect(await Bun.file(registration).exists()).toBe(false)
  } finally {
    owner.kill("SIGTERM")
    await owner.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

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
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = await Bun.file(file)
      .json()
      .catch(() => undefined)
    if (value !== undefined) return Schema.decodeUnknownPromise(Service.Info)(value)
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for service registration")
}
