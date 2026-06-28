export * as TaskService from "./task"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Ref, Schema, Stream, PubSub } from "effect"
import { Task } from "@opencode-ai/schema/task"
import { Database } from "./database/database"
import { Global } from "./global"
import { Shell } from "./shell"
import { TaskTable } from "./task/sql"
import { makeGlobalNode, makeLocationNode } from "./effect/node"
import { SystemContext } from "./system-context"
import { SystemContextRegistry } from "./system-context/registry"
import { spawn, type ChildProcess } from "child_process"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "fs"

type ActiveProcess = {
  readonly proc: ChildProcess
  readonly pubsub: PubSub.PubSub<string>
}

export interface Interface {
  readonly start: (input: {
    readonly name: string
    readonly command: string
    readonly cwd?: string
    readonly port?: number
    readonly metadata?: Record<string, unknown>
  }) => Effect.Effect<Task.Info, Error>

  readonly stop: (id: Task.ID) => Effect.Effect<Task.Info, Error>
  readonly restart: (id: Task.ID) => Effect.Effect<Task.Info, Error>
  readonly kill: (id: Task.ID) => Effect.Effect<Task.Info, Error>
  readonly list: () => Effect.Effect<Task.Info[], Error>
  readonly get: (id: Task.ID) => Effect.Effect<Task.Info | undefined, Error>
  readonly delete: (id: Task.ID) => Effect.Effect<void, Error>
  readonly logs: (id: Task.ID, options?: { lines?: number }) => Effect.Effect<string, Error>
  readonly streamLogs: (id: Task.ID) => Stream.Stream<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Task") {}

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    return err.code === "EPERM"
  }
}

const terminateProcess = (pid: number) =>
  Effect.callback<void, Error>((resume) => {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      })
      killer.once("exit", (code) => {
        if (code === 0) resume(Effect.void)
        else resume(Effect.fail(new Error(`taskkill failed with code ${code}`)))
      })
      killer.once("error", (error) => resume(Effect.fail(error)))
    } else {
      try {
        process.kill(-pid, "SIGTERM")
        setTimeout(() => {
          try {
            process.kill(-pid, "SIGKILL")
          } catch {}
        }, 5000)
        resume(Effect.void)
      } catch (error: any) {
        resume(Effect.fail(error))
      }
    }
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const globalPath = yield* Global.Service
    const activeProcesses = yield* Ref.make(new Map<string, ActiveProcess>())

    const getTask = (id: Task.ID) =>
      Effect.gen(function* () {
        const row = yield* db.select().from(TaskTable).where(eq(TaskTable.id, id)).get().pipe(Effect.orDie)
        if (!row) return undefined
        const info: Task.Info = {
          id: row.id,
          name: row.name,
          command: row.command,
          cwd: row.cwd,
          status: row.status,
          pid: row.pid ?? undefined,
          port: row.port ?? undefined,
          exitCode: row.exit_code ?? undefined,
          error: row.error ?? undefined,
          startedAt: row.started_at,
          completedAt: row.completed_at ?? undefined,
          metadata: row.metadata ?? undefined,
        }
        return info
      })

    const start = Effect.fn("Task.start")(function* (input) {
      const id = Task.ID.create()
      const cwd = input.cwd ?? globalPath.home
      const shellPath = Shell.preferred() ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh")

      const child = yield* Effect.try({
        try: () =>
          spawn(shellPath, Shell.args(shellPath, input.command, cwd), {
            cwd,
            detached: process.platform !== "win32",
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          }),
        catch: (error) => new Error(`Failed to spawn process: ${error instanceof Error ? error.message : String(error)}`),
      })

      const pid = child.pid ?? 0
      const logDir = path.join(globalPath.log, "tasks")
      yield* Effect.tryPromise(() => fs.mkdir(logDir, { recursive: true }))
      const logFile = path.join(logDir, `${id}.log`)

      const pubsub = yield* PubSub.unbounded<string>()

      const handleData = (data: Buffer) => {
        const text = data.toString("utf8")
        fs.appendFile(logFile, text).catch(() => {})
        const lines = text.split(/\r?\n/)
        for (const line of lines) {
          if (line) {
            Effect.runFork(PubSub.publish(pubsub, line))
          }
        }
      }

      child.stdout?.on("data", handleData)
      child.stderr?.on("data", handleData)

      child.on("exit", (code, signal) => {
        const exitCode = code ?? (signal ? -1 : 0)
        const completedAt = Date.now()

        Effect.runPromise(
          Effect.gen(function* () {
            const current = yield* db
              .select({ status: TaskTable.status })
              .from(TaskTable)
              .where(eq(TaskTable.id, id))
              .get()
              .pipe(Effect.orDie)

            const status = current?.status === "stopped" ? "stopped" : (exitCode === 0 ? "completed" : "failed")

            yield* db
              .update(TaskTable)
              .set({
                status,
                exit_code: exitCode,
                completed_at: completedAt,
                error: status === "failed" ? `Process exited with code ${exitCode} or signal ${signal}` : undefined,
              })
              .where(eq(TaskTable.id, id))
              .run()
              .pipe(Effect.orDie)
          })
        )

        Effect.runFork(PubSub.shutdown(pubsub))
        Effect.runFork(
          Ref.update(activeProcesses, (map) => {
            const next = new Map(map)
            next.delete(id)
            return next
          })
        )
      })

      yield* Ref.update(activeProcesses, (map) => {
        const next = new Map(map)
        next.set(id, { proc: child, pubsub })
        return next
      })

      const taskInfo: Task.Info = {
        id,
        name: input.name,
        command: input.command,
        cwd,
        status: "running",
        pid,
        port: input.port,
        startedAt: Date.now(),
        metadata: input.metadata,
      }

      yield* db
        .insert(TaskTable)
        .values({
          id: taskInfo.id,
          name: taskInfo.name,
          command: taskInfo.command,
          cwd: taskInfo.cwd,
          status: taskInfo.status,
          pid: taskInfo.pid,
          port: taskInfo.port,
          started_at: taskInfo.startedAt,
          metadata: taskInfo.metadata,
        })
        .run()
        .pipe(Effect.orDie)

      return taskInfo
    })

    const stop = Effect.fn("Task.stop")(function* (id) {
      const task = yield* getTask(id)
      if (!task) return yield* Effect.fail(new Error("Task not found"))
      if (task.status !== "running" || !task.pid) return task

      const activeMap = yield* Ref.get(activeProcesses)
      const active = activeMap.get(id)

      if (active) {
        yield* db
          .update(TaskTable)
          .set({ status: "stopped" })
          .where(eq(TaskTable.id, id))
          .run()
          .pipe(Effect.orDie)
        yield* terminateProcess(task.pid).pipe(Effect.catch(() => Effect.void))
      } else {
        yield* db
          .update(TaskTable)
          .set({ status: "stopped", completed_at: Date.now() })
          .where(eq(TaskTable.id, id))
          .run()
          .pipe(Effect.orDie)
        yield* terminateProcess(task.pid).pipe(Effect.catch(() => Effect.void))
      }

      const updated = yield* getTask(id)
      return updated ?? task
    })

    const kill = Effect.fn("Task.kill")(function* (id) {
      const task = yield* getTask(id)
      if (!task) return yield* Effect.fail(new Error("Task not found"))
      if (task.status !== "running" || !task.pid) return task

      yield* db
        .update(TaskTable)
        .set({ status: "stopped" })
        .where(eq(TaskTable.id, id))
        .run()
        .pipe(Effect.orDie)
      yield* terminateProcess(task.pid).pipe(Effect.catch(() => Effect.void))

      const activeMap = yield* Ref.get(activeProcesses)
      const active = activeMap.get(id)
      if (active) {
        Effect.runFork(PubSub.shutdown(active.pubsub))
        yield* Ref.update(activeProcesses, (map) => {
          const next = new Map(map)
          next.delete(id)
          return next
        })
      }

      const updated = yield* getTask(id)
      return updated ?? task
    })

    const restart = Effect.fn("Task.restart")(function* (id) {
      const task = yield* getTask(id)
      if (!task) return yield* Effect.fail(new Error("Task not found"))

      if (task.status === "running") {
        yield* stop(id)
      }

      return yield* start({
        name: task.name,
        command: task.command,
        cwd: task.cwd,
        port: task.port,
        metadata: task.metadata,
      })
    })

    const list = Effect.fn("Task.list")(function* () {
      const rows = yield* db.select().from(TaskTable).all().pipe(Effect.orDie)
      return rows.map((row) => {
        const info: Task.Info = {
          id: row.id,
          name: row.name,
          command: row.command,
          cwd: row.cwd,
          status: row.status,
          pid: row.pid ?? undefined,
          port: row.port ?? undefined,
          exitCode: row.exit_code ?? undefined,
          error: row.error ?? undefined,
          startedAt: row.started_at,
          completedAt: row.completed_at ?? undefined,
          metadata: row.metadata ?? undefined,
        }
        return info
      })
    })

    const remove = Effect.fn("Task.delete")(function* (id) {
      const task = yield* getTask(id)
      if (!task) return
      if (task.status === "running") {
        yield* stop(id)
      }

      yield* db.delete(TaskTable).where(eq(TaskTable.id, id)).run().pipe(Effect.orDie)
      const logFile = path.join(globalPath.log, "tasks", `${id}.log`)
      yield* Effect.tryPromise(() => fs.rm(logFile, { force: true })).pipe(Effect.ignore)
    })

    const logs = Effect.fn("Task.logs")(function* (id, options) {
      const logFile = path.join(globalPath.log, "tasks", `${id}.log`)
      if (!existsSync(logFile)) return ""
      const text = yield* Effect.tryPromise(() => fs.readFile(logFile, "utf8"))
      if (options?.lines) {
        const lines = text.split(/\r?\n/)
        return lines.slice(-options.lines).join("\n")
      }
      return text
    })

    const streamLogs = (id: Task.ID): Stream.Stream<string, Error> => {
      const backlogStream = Stream.unwrap(
        Effect.gen(function* () {
          const logFile = path.join(globalPath.log, "tasks", `${id}.log`)
          if (!existsSync(logFile)) return Stream.empty
          const text = yield* Effect.tryPromise(() => fs.readFile(logFile, "utf8"))
          const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
          return Stream.fromIterable(lines)
        }).pipe(Effect.catch(() => Effect.succeed(Stream.empty)))
      )

      const liveStream = Stream.unwrap(
        Effect.gen(function* () {
          const activeMap = yield* Ref.get(activeProcesses)
          const active = activeMap.get(id)
          if (!active) return Stream.empty
          return Stream.fromPubSub(active.pubsub)
        })
      )

      return Stream.concat(backlogStream, liveStream)
    }

    const checkHealth = Effect.gen(function* () {
      const runningTasks = yield* db
        .select()
        .from(TaskTable)
        .where(eq(TaskTable.status, "running"))
        .all()
        .pipe(Effect.orDie)

      for (const row of runningTasks) {
        if (row.pid) {
          const alive = isPidAlive(row.pid)
          if (!alive) {
            yield* db
              .update(TaskTable)
              .set({
                status: "failed",
                completed_at: Date.now(),
                error: "Process terminated unexpectedly",
              })
              .where(eq(TaskTable.id, row.id))
              .run()
              .pipe(Effect.orDie)

            yield* Ref.update(activeProcesses, (map) => {
              const next = new Map(map)
              const active = next.get(row.id)
              if (active) {
                Effect.runFork(PubSub.shutdown(active.pubsub))
                next.delete(row.id)
              }
              return next
            })
          }
        }
      }
    })

    yield* checkHealth
    yield* checkHealth.pipe(
      Effect.delay("10 seconds"),
      Effect.forever,
      Effect.forkScoped,
    )

    return Service.of({
      start,
      stop,
      restart,
      kill,
      list,
      get: getTask,
      delete: remove,
      logs,
      streamLogs,
    })
  })
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer), Layer.provide(Global.defaultLayer))

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Global.node] })

export const contextSourceNode = makeLocationNode({
  name: "task-context-source",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const taskService = yield* Service

      const loadTasksContext = Effect.gen(function* () {
        const list = yield* taskService.list().pipe(
          Effect.catch(() => Effect.succeed([] as Task.Info[]))
        )
        if (list.length === 0) return "No background tasks have been registered."

        const lines = ["Here are the background tasks running or recently executed in this workspace:"]
        for (const t of list) {
          lines.push(`- ${t.id}: "${t.name}"`)
          lines.push(`  Status: ${t.status}${t.pid ? ` (PID ${t.pid})` : ""}`)
          lines.push(`  Command: ${t.command}`)
          lines.push(`  WorkingDirectory: ${t.cwd}`)
          if (t.port) lines.push(`  ListeningPort: ${t.port}`)
          if (t.exitCode !== undefined) lines.push(`  ExitCode: ${t.exitCode}`)
          if (t.error) lines.push(`  Error: ${t.error}`)
        }
        return lines.join("\n")
      })

      const context = SystemContext.make({
        key: SystemContext.Key.make("core/tasks"),
        codec: Schema.toCodecJson(Schema.String),
        load: loadTasksContext,
        baseline: (text) => text,
        update: (_previous, current) => current,
      })

      yield* registry.register({ key: SystemContext.Key.make("core/tasks"), load: Effect.succeed(context) })
    })
  ),
  deps: [SystemContextRegistry.node, node],
})
