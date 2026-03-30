import { Log } from "../util/log"
import path from "path"
import { Global } from "../global"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { git } from "@/util/git"
import { AppFileSystem } from "@/filesystem"
import { makeRuntime } from "@/effect/run-service"
import { Effect, Layer, ServiceMap, SynchronizedRef, TxReentrantLock } from "effect"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  type Migration = (dir: string, fs: AppFileSystem.Interface) => Effect.Effect<void, AppFileSystem.Error>

  export const NotFoundError = NamedError.create(
    "NotFoundError",
    z.object({
      message: z.string(),
    }),
  )

  export type Error = AppFileSystem.Error | InstanceType<typeof NotFoundError>

  const RootFile = z
    .object({
      path: z
        .object({
          root: z.string().optional(),
        })
        .optional(),
    })
    .passthrough()

  const SessionFile = z
    .object({
      id: z.string(),
    })
    .passthrough()

  const MessageFile = z
    .object({
      id: z.string(),
    })
    .passthrough()

  const DiffFile = z
    .object({
      additions: z.number(),
      deletions: z.number(),
    })
    .passthrough()

  const SummaryFile = z
    .object({
      id: z.string(),
      projectID: z.string(),
      summary: z.object({ diffs: z.array(DiffFile) }),
    })
    .passthrough()

  export interface Interface {
    readonly remove: (key: string[]) => Effect.Effect<void, AppFileSystem.Error>
    readonly read: <T>(key: string[]) => Effect.Effect<T, Error>
    readonly update: <T>(key: string[], fn: (draft: T) => void) => Effect.Effect<T, Error>
    readonly write: <T>(key: string[], content: T) => Effect.Effect<void, AppFileSystem.Error>
    readonly list: (prefix: string[]) => Effect.Effect<string[][], AppFileSystem.Error>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Storage") {}

  function file(dir: string, key: string[]) {
    return path.join(dir, ...key) + ".json"
  }

  function missing(err: unknown) {
    if (!err || typeof err !== "object") return false
    if ("code" in err && err.code === "ENOENT") return true
    if ("reason" in err && err.reason && typeof err.reason === "object" && "_tag" in err.reason) {
      return err.reason._tag === "NotFound"
    }
    return false
  }

  const MIGRATIONS: Migration[] = [
    Effect.fn("Storage.migration.1")(function* (dir: string, fs: AppFileSystem.Interface) {
      const project = path.resolve(dir, "../project")
      if (!(yield* fs.isDir(project))) return
      const projectDirs = yield* fs.glob("*", {
        cwd: project,
        include: "all",
      })
      for (const projectDir of projectDirs) {
        const full = path.join(project, projectDir)
        if (!(yield* fs.isDir(full))) continue
        log.info(`migrating project ${projectDir}`)
        let projectID = projectDir
        let worktree = "/"

        if (projectID !== "global") {
          for (const msgFile of yield* fs.glob("storage/session/message/*/*.json", {
            cwd: full,
            absolute: true,
          })) {
            const json = RootFile.parse(yield* fs.readJson(msgFile))
            const root = json.path?.root
            if (!root) continue
            worktree = root
            break
          }
          if (!worktree) continue
          if (!(yield* fs.isDir(worktree))) continue
          const result = yield* Effect.promise(() =>
            git(["rev-list", "--max-parents=0", "--all"], {
              cwd: worktree,
            }),
          )
          const [id] = result
            .text()
            .split("\n")
            .filter(Boolean)
            .map((x) => x.trim())
            .toSorted()
          if (!id) continue
          projectID = id

          yield* fs.writeWithDirs(
            path.join(dir, "project", projectID + ".json"),
            JSON.stringify(
              {
                id,
                vcs: "git",
                worktree,
                time: {
                  created: Date.now(),
                  initialized: Date.now(),
                },
              },
              null,
              2,
            ),
          )

          log.info(`migrating sessions for project ${projectID}`)
          for (const sessionFile of yield* fs.glob("storage/session/info/*.json", {
            cwd: full,
            absolute: true,
          })) {
            const dest = path.join(dir, "session", projectID, path.basename(sessionFile))
            log.info("copying", { sessionFile, dest })
            const session = SessionFile.parse(yield* fs.readJson(sessionFile))
            yield* fs.writeWithDirs(dest, JSON.stringify(session, null, 2))
            log.info(`migrating messages for session ${session.id}`)
            for (const msgFile of yield* fs.glob(`storage/session/message/${session.id}/*.json`, {
              cwd: full,
              absolute: true,
            })) {
              const next = path.join(dir, "message", session.id, path.basename(msgFile))
              log.info("copying", {
                msgFile,
                dest: next,
              })
              const message = MessageFile.parse(yield* fs.readJson(msgFile))
              yield* fs.writeWithDirs(next, JSON.stringify(message, null, 2))

              log.info(`migrating parts for message ${message.id}`)
              for (const partFile of yield* fs.glob(`storage/session/part/${session.id}/${message.id}/*.json`, {
                cwd: full,
                absolute: true,
              })) {
                const out = path.join(dir, "part", message.id, path.basename(partFile))
                const part = yield* fs.readJson(partFile)
                log.info("copying", {
                  partFile,
                  dest: out,
                })
                yield* fs.writeWithDirs(out, JSON.stringify(part, null, 2))
              }
            }
          }
        }
      }
    }),
    Effect.fn("Storage.migration.2")(function* (dir: string, fs: AppFileSystem.Interface) {
      for (const item of yield* fs.glob("session/*/*.json", {
        cwd: dir,
        absolute: true,
      })) {
        const session = SummaryFile.safeParse(yield* fs.readJson(item))
        if (!session.success) continue
        const diffs = session.data.summary.diffs
        yield* fs.writeWithDirs(
          path.join(dir, "session_diff", session.data.id + ".json"),
          JSON.stringify(diffs, null, 2),
        )
        yield* fs.writeWithDirs(
          path.join(dir, "session", session.data.projectID, session.data.id + ".json"),
          JSON.stringify(
            {
              ...session.data,
              summary: {
                additions: diffs.reduce((sum, x) => sum + x.additions, 0),
                deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
              },
            },
            null,
            2,
          ),
        )
      }
    }),
  ]

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const locks = yield* SynchronizedRef.make(new Map<string, TxReentrantLock.TxReentrantLock>())
      const load = Effect.fn("Storage.state")(function* () {
        const dir = path.join(Global.Path.data, "storage")
        const marker = path.join(dir, "migration")
        const migration = yield* fs.readFileString(marker).pipe(
          Effect.map((x) => Number.parseInt(x, 10)),
          Effect.catchIf(missing, () => Effect.succeed(0)),
          Effect.orElseSucceed(() => 0),
        )
        for (let i = migration; i < MIGRATIONS.length; i++) {
          log.info("running migration", { index: i })
          const step = MIGRATIONS[i]!
          yield* step(dir, fs).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                log.error("failed to run migration", { index: i, cause })
              }),
            ),
          )
          yield* fs.writeWithDirs(marker, String(i + 1))
        }
        return { dir }
      })
      const state = yield* Effect.cached(load())

      const get = Effect.fn("Storage.lock")(function* (key: string) {
        return yield* SynchronizedRef.modifyEffect(locks, (map) =>
          Effect.gen(function* () {
            const existing = map.get(key)
            if (existing) return [existing, map]
            const next = yield* TxReentrantLock.make()
            map.set(key, next)
            return [next, map]
          }),
        )
      })

      const fail = (target: string): Effect.Effect<never, InstanceType<typeof NotFoundError>> =>
        Effect.fail(new NotFoundError({ message: `Resource not found: ${target}` }))

      const wrap = <A>(target: string, body: Effect.Effect<A, AppFileSystem.Error>) =>
        body.pipe(Effect.catchIf(missing, () => fail(target)))

      const writeJson = Effect.fnUntraced(function* (target: string, content: unknown) {
        yield* fs.writeWithDirs(target, JSON.stringify(content, null, 2))
      })

      const resolve = Effect.fnUntraced(function* (key: string[]) {
        const dir = (yield* state).dir
        const target = file(dir, key)
        return [target, yield* get(target)] as const
      })

      const remove: Interface["remove"] = Effect.fn("Storage.remove")(function* (key: string[]) {
        const [target, rw] = yield* resolve(key)
        yield* TxReentrantLock.withWriteLock(rw, fs.remove(target).pipe(Effect.catchIf(missing, () => Effect.void)))
      })

      const read: Interface["read"] = <T>(key: string[]) =>
        Effect.gen(function* () {
          const [target, rw] = yield* resolve(key)
          const value = yield* TxReentrantLock.withReadLock(rw, wrap(target, fs.readJson(target)))
          return value as T
        })

      const update: Interface["update"] = <T>(key: string[], fn: (draft: T) => void) =>
        Effect.gen(function* () {
          const [target, rw] = yield* resolve(key)
          const value = yield* TxReentrantLock.withWriteLock(
            rw,
            Effect.gen(function* () {
              const content = yield* wrap(target, fs.readJson(target))
              fn(content as T)
              yield* writeJson(target, content)
              return content
            }),
          )
          return value as T
        })

      const write: Interface["write"] = (key: string[], content: unknown) =>
        Effect.gen(function* () {
          const [target, rw] = yield* resolve(key)
          yield* TxReentrantLock.withWriteLock(rw, writeJson(target, content))
        })

      const list: Interface["list"] = Effect.fn("Storage.list")(function* (prefix: string[]) {
        const dir = (yield* state).dir
        const cwd = path.join(dir, ...prefix)
        const result = yield* fs
          .glob("**/*", {
            cwd,
            include: "file",
          })
          .pipe(Effect.catch(() => Effect.succeed<string[]>([])))
        return result
          .map((x) => [...prefix, ...x.slice(0, -5).split(path.sep)])
          .toSorted((a, b) => a.join("/").localeCompare(b.join("/")))
      })

      return Service.of({
        remove,
        read,
        update,
        write,
        list,
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function remove(key: string[]) {
    return runPromise((svc) => svc.remove(key))
  }

  export async function read<T>(key: string[]) {
    return runPromise((svc) => svc.read<T>(key))
  }

  export async function update<T>(key: string[], fn: (draft: T) => void) {
    return runPromise((svc) => svc.update<T>(key, fn))
  }

  export async function write<T>(key: string[], content: T) {
    return runPromise((svc) => svc.write(key, content))
  }

  export async function list(prefix: string[]) {
    return runPromise((svc) => svc.list(prefix))
  }
}
