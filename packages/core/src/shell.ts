export * as Shell from "./shell"

import path from "path"
import { Context, Deferred, Duration, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { produce } from "immer"
import { Shell } from "@opencode-ai/schema/shell"
import { makeLocationNode } from "./effect/app-node"
import { AppProcess } from "./process"
import { Config } from "./config"
import { EventV2 } from "./event"
import { Location } from "./location"
import { Global } from "./global"
import { ShellSelect } from "./shell/select"

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Shell.NotFoundError", {
  id: Shell.ID,
}) {}

// Exited processes stay observable (status, exit code, retained output) until removed explicitly.
// Cap retention so abandoned commands do not accumulate unbounded state and output files.
const EXITED_LIMIT = 25

type Info = Shell.Info

type Active = {
  // Immutable snapshot; lifecycle updates replace it via immer `produce`.
  info: Info
  file: string
  size: number
  // Resolves with the terminal Info once the command exits, times out, or is killed. A wait
  // started after termination resolves immediately from the already-completed deferred.
  done: Deferred.Deferred<Info, NotFoundError>
  timeoutFiber?: Fiber.Fiber<void>
}

/**
 * Location-owned non-interactive shell command process service.
 *
 * Each `create` spawns one shell command, captures combined stdout/stderr to a
 * file, and returns an ID. Clients poll `get` for status and `output` for
 * file-backed output by cursor. No session, message, or permission state lives
 * here; callers (e.g. `ShellTool`) own that association and store the shell ID.
 */
export interface Interface {
  readonly create: (input: Shell.CreateInput) => Effect.Effect<Shell.Info>
  // Currently running commands only; exited shells are retained for get/output but excluded here.
  readonly list: () => Effect.Effect<Shell.Info[]>
  readonly get: (id: Shell.ID) => Effect.Effect<Shell.Info, NotFoundError>
  // Resolves once the command reaches a terminal status, returning its final Info. Fails with
  // NotFoundError if the command is unknown or is removed before it terminates.
  readonly wait: (id: Shell.ID) => Effect.Effect<Shell.Info, NotFoundError>
  readonly output: (id: Shell.ID, input?: Shell.OutputInput) => Effect.Effect<Shell.Output, NotFoundError>
  readonly remove: (id: Shell.ID) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Shell") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const config = yield* Config.Service
    const global = yield* Global.Service
    const appProcess = yield* AppProcess.Service
    const context = yield* Effect.context()
    const runFork = Effect.runForkWith(context)
    const sessions = new Map<string, Active>()
    const exitOrder: string[] = []

    const outputDir = path.join(global.data, "shell", location.project.id)
    const { mkdir, unlink } = yield* Effect.promise(() => import("fs/promises"))
    const { createWriteStream, createReadStream } = yield* Effect.promise(() => import("fs"))
    yield* Effect.promise(() => mkdir(outputDir, { recursive: true }))

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        for (const session of sessions.values()) {
          if (session.timeoutFiber) yield* Fiber.interrupt(session.timeoutFiber)
          // Unblock waiters still pending at teardown; succeed is a no-op once already resolved.
          yield* Deferred.fail(session.done, new NotFoundError({ id: Shell.ID.make(session.info.id) }))
        }
        sessions.clear()
        exitOrder.length = 0
      }),
    )

    const require = Effect.fn("Shell.require")(function* (id: Shell.ID) {
      const session = sessions.get(id)
      if (!session) return yield* new NotFoundError({ id })
      return session
    })

    const removeSession = Effect.fnUntraced(function* (id: Shell.ID) {
      const session = sessions.get(id)
      if (!session) return
      sessions.delete(id)
      const index = exitOrder.indexOf(id)
      if (index !== -1) exitOrder.splice(index, 1)
      if (session.timeoutFiber) yield* Fiber.interrupt(session.timeoutFiber)
      // Unblock any wait still pending when the command is removed before it terminated.
      yield* Deferred.fail(session.done, new NotFoundError({ id }))
      yield* Effect.promise(() => unlink(session.file).catch(() => {}))
      yield* events.publish(Shell.Event.Deleted, { id })
    })

    const remove = Effect.fn("Shell.remove")(function* (id: Shell.ID) {
      yield* require(id)
      yield* removeSession(id)
    })

    const list = Effect.fn("Shell.list")(function* () {
      return Array.from(sessions.values())
        .filter((session) => session.info.status === "running")
        .map((session) => session.info)
    })

    const get = Effect.fn("Shell.get")(function* (id: Shell.ID) {
      return (yield* require(id)).info
    })

    const wait = Effect.fn("Shell.wait")(function* (id: Shell.ID) {
      return yield* Deferred.await((yield* require(id)).done)
    })

    const output = Effect.fn("Shell.output")(function* (id: Shell.ID, input?: Shell.OutputInput) {
      const session = yield* require(id)
      const cursor = input?.cursor ?? 0
      const limit = input?.limit ?? 65536
      if (cursor >= session.size) return { output: "", cursor: session.size, size: session.size, truncated: false }
      const start = Math.max(0, cursor)
      const length = Math.min(limit, session.size - start)
      const buffer = Buffer.alloc(length)
      const bytesRead = yield* Effect.promise(
        () =>
          new Promise<number>((resolve) => {
            const stream = createReadStream(session.file, { start, end: start + length - 1 })
            let offset = 0
            stream.on("data", (chunk: string | Buffer) => {
              const bytes = Buffer.from(chunk)
              bytes.copy(buffer, offset)
              offset += bytes.length
            })
            stream.on("end", () => resolve(offset))
            stream.on("error", () => resolve(0))
          }),
      )
      return {
        output: buffer.subarray(0, bytesRead).toString("utf8"),
        cursor: start + bytesRead,
        size: session.size,
        truncated: false,
      }
    })

    const create = Effect.fn("Shell.create")(function* (input: Shell.CreateInput) {
      const id = Shell.ID.ascending()
      const cwd = input.cwd ?? location.directory
      const configShell = Config.latest(yield* config.entries(), "shell")
      const shell = ShellSelect.preferred(configShell)
      const args = ShellSelect.args(shell, input.command)
      const file = path.join(outputDir, `${id}.out`)
      const env = {
        ...process.env,
        TERM: "xterm-256color",
        OPENCODE_TERMINAL: "1",
      } as Record<string, string>

      const info: Info = {
        id,
        status: "running",
        command: input.command,
        cwd,
        shell,
        file,
        metadata: input.metadata ?? {},
        time: { started: Date.now() },
      }

      // Spawn via AppProcess and stream combined output to the file. The handle is scope-bound, so
      // the managing fiber keeps its scope open until the command terminates (it awaits `done` at the
      // end). `create` returns once `ready` resolves with the registered session.
      const ready = Deferred.makeUnsafe<Active>()
      runFork(
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* appProcess.spawn(
              ChildProcess.make(shell, args, {
                cwd,
                env,
                stdin: "ignore",
                detached: process.platform !== "win32",
                forceKillAfter: Duration.seconds(3),
              }),
            )
            const session: Active = {
              info: produce(info, (draft) => {
                draft.pid = handle.pid
              }),
              file,
              size: 0,
              done: Deferred.makeUnsafe<Info, NotFoundError>(),
            }
            sessions.set(id, session)

            const stream = createWriteStream(file)
            const outputDone = Deferred.makeUnsafe<void>()
            const pump = handle.all.pipe(
              Stream.runForEach((chunk: Uint8Array) =>
                Effect.sync(() => {
                  stream.write(chunk)
                  session.size += chunk.length
                }),
              ),
            )
            runFork(
              Effect.gen(function* () {
                yield* pump.pipe(Effect.catch(() => Effect.void))
                yield* Effect.promise(
                  () =>
                    new Promise<void>((resolve) => {
                      stream.end(() => resolve())
                    }),
                )
                yield* Deferred.succeed(outputDone, undefined)
              }).pipe(Effect.catch(() => Deferred.succeed(outputDone, undefined))),
            )
            yield* Effect.promise(
              () =>
                new Promise<void>((resolve) => {
                  stream.once("open", () => resolve())
                  stream.once("error", () => resolve())
                }),
            )

            const finish = (status: Info["status"], exit?: number, beforeWait = Effect.void) =>
              Effect.gen(function* () {
                if (session.info.status !== "running") return
                session.info = produce(session.info, (draft) => {
                  draft.status = status
                  if (exit !== undefined) draft.exit = exit
                  draft.time.completed = Date.now()
                })
                yield* beforeWait
                yield* Deferred.await(outputDone)
                // Resolve waiters with the terminal Info before any retention eviction, so an evicted
                // session still reports success rather than the removal NotFoundError. This runs before
                // the timeout-fiber interrupt below, which on the timeout path would otherwise cancel
                // this very fiber (finish is invoked by the timeout fiber) before waiters are resolved.
                yield* Deferred.succeed(session.done, session.info)
                yield* events.publish(Shell.Event.Exited, {
                  id,
                  ...(exit !== undefined ? { exit } : {}),
                  status,
                })
                exitOrder.push(id)
                while (exitOrder.length > EXITED_LIMIT) {
                  const oldest = exitOrder[0]
                  if (!oldest) break
                  yield* removeSession(Shell.ID.make(oldest))
                }
                // Cancel a pending timeout once the command exits on its own. Interrupting last avoids
                // aborting finish when finish itself runs on the timeout fiber.
                if (session.timeoutFiber) yield* Fiber.interrupt(session.timeoutFiber)
              })

            if (input.timeout) {
              session.timeoutFiber = runFork(
                Effect.sleep(Duration.millis(input.timeout)).pipe(
                  Effect.flatMap(() =>
                    finish("timeout", undefined, handle.kill().pipe(Effect.catch(() => Effect.void))),
                  ),
                  Effect.catch(() => Effect.void),
                ),
              )
            }

            runFork(
              handle.exitCode.pipe(
                Effect.flatMap((code) => finish("exited", code)),
                Effect.catch(() => Effect.void),
              ),
            )

            yield* events.publish(Shell.Event.Created, { info })
            yield* Deferred.succeed(ready, session)
            // Hold the handle's scope open until the command terminates; closing it earlier would
            // release (kill) the process before its exit is observed.
            yield* Deferred.await(session.done).pipe(Effect.catch(() => Effect.void))
          }),
        ).pipe(Effect.catch(() => Effect.void)),
      )

      const session = yield* Deferred.await(ready)
      return session.info
    })

    return Service.of({ create, list, get, wait, output, remove })
  }),
)

export const locationLayer = layer.pipe(Layer.provide(Config.locationLayer))

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [EventV2.node, Location.node, Config.node, Global.node, AppProcess.node],
})
