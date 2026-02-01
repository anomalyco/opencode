import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import * as nodefs from "fs"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { lazy } from "../util/lazy"
import { Lock } from "../util/lock"
import { $ } from "bun"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"

export namespace Storage {
  const log = Log.create({ service: "storage" })
  async function delay(ms: number) {
    await new Promise<void>((r) => setTimeout(r, ms))
  }
  function isTransientFsError(e: any) {
    const code = (e as any)?.code as string | undefined
    const msg = (e as any)?.message as string | undefined
    return code === "EBUSY" || code === "EACCES" || code === "EPERM" || code === "UNKNOWN" || (msg ? msg.includes("UV_UNKNOWN") : false)
  }

  type Migration = (dir: string) => Promise<void>

  export const NotFoundError = NamedError.create(
    "NotFoundError",
    z.object({
      message: z.string(),
    }),
  )

  const MIGRATIONS: Migration[] = [
    async (dir) => {
      const project = path.resolve(dir, "../project")
      if (!(await Filesystem.isDir(project))) return
      for await (const projectDir of new Bun.Glob("*").scan({
        cwd: project,
        onlyFiles: false,
      })) {
        log.info(`migrating project ${projectDir}`)
        let projectID = projectDir
        const fullProjectDir = path.join(project, projectDir)
        let worktree = "/"

        if (projectID !== "global") {
          for await (const msgFile of new Bun.Glob("storage/session/message/*/*.json").scan({
            cwd: path.join(project, projectDir),
            absolute: true,
          })) {
            const json = await Bun.file(msgFile).json()
            worktree = json.path?.root
            if (worktree) break
          }
          if (!worktree) continue
          if (!(await Filesystem.isDir(worktree))) continue
          const [id] = await $`git rev-list --max-parents=0 --all`
            .quiet()
            .nothrow()
            .cwd(worktree)
            .text()
            .then((x) =>
              x
                .split("\n")
                .filter(Boolean)
                .map((x) => x.trim())
                .toSorted(),
            )
          if (!id) continue
          projectID = id

          await Bun.write(
            path.join(dir, "project", projectID + ".json"),
            JSON.stringify({
              id,
              vcs: "git",
              worktree,
              time: {
                created: Date.now(),
                initialized: Date.now(),
              },
            }),
          )

          log.info(`migrating sessions for project ${projectID}`)
          for await (const sessionFile of new Bun.Glob("storage/session/info/*.json").scan({
            cwd: fullProjectDir,
            absolute: true,
          })) {
            const dest = path.join(dir, "session", projectID, path.basename(sessionFile))
            log.info("copying", {
              sessionFile,
              dest,
            })
            const session = await Bun.file(sessionFile).json()
            await Bun.write(dest, JSON.stringify(session))
            log.info(`migrating messages for session ${session.id}`)
            for await (const msgFile of new Bun.Glob(`storage/session/message/${session.id}/*.json`).scan({
              cwd: fullProjectDir,
              absolute: true,
            })) {
              const dest = path.join(dir, "message", session.id, path.basename(msgFile))
              log.info("copying", {
                msgFile,
                dest,
              })
              const message = await Bun.file(msgFile).json()
              await Bun.write(dest, JSON.stringify(message))

              log.info(`migrating parts for message ${message.id}`)
              for await (const partFile of new Bun.Glob(`storage/session/part/${session.id}/${message.id}/*.json`).scan(
                {
                  cwd: fullProjectDir,
                  absolute: true,
                },
              )) {
                const dest = path.join(dir, "part", message.id, path.basename(partFile))
                const part = await Bun.file(partFile).json()
                log.info("copying", {
                  partFile,
                  dest,
                })
                await Bun.write(dest, JSON.stringify(part))
              }
            }
          }
        }
      }
    },
    async (dir) => {
      for await (const item of new Bun.Glob("session/*/*.json").scan({
        cwd: dir,
        absolute: true,
      })) {
        const session = await Bun.file(item).json()
        if (!session.projectID) continue
        if (!session.summary?.diffs) continue
        const { diffs } = session.summary
        await Bun.file(path.join(dir, "session_diff", session.id + ".json")).write(JSON.stringify(diffs))
        await Bun.file(path.join(dir, "session", session.projectID, session.id + ".json")).write(
          JSON.stringify({
            ...session,
            summary: {
              additions: diffs.reduce((sum: any, x: any) => sum + x.additions, 0),
              deletions: diffs.reduce((sum: any, x: any) => sum + x.deletions, 0),
            },
          }),
        )
      }
    },
  ]

  const state = lazy(async () => {
    const dir = path.join(Global.Path.data, "storage")
    const migration = await Bun.file(path.join(dir, "migration"))
      .json()
      .then((x) => parseInt(x))
      .catch(() => 0)
    for (let index = migration; index < MIGRATIONS.length; index++) {
      log.info("running migration", { index })
      const migration = MIGRATIONS[index]
      await migration(dir).catch(() => log.error("failed to run migration", { index }))
      await Bun.write(path.join(dir, "migration"), (index + 1).toString())
    }
    return {
      dir,
    }
  })

  export async function remove(key: string[]) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      await fs.unlink(target).catch(() => {})
    })
  }

  export async function read<T>(key: string[]) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _ = await Lock.read(target)
      let lastErr: any
      for (let i = 0; i < 6; i++) {
        try {
          const result = await Bun.file(target).json()
          return result as T
        } catch (e) {
          lastErr = e
          if (!isTransientFsError(e)) break
          await delay(Math.min(1600, 50 * 2 ** i))
        }
      }
      queueMicrotask(async () => {
        using _w = await Lock.write(target)
        const ts = Date.now()
        const rel = path.relative(dir, target)
        const dest = path.join(dir, "quarantine", String(ts), rel)
        await fs.mkdir(path.dirname(dest), { recursive: true }).catch(() => {})
        await fs.rename(target, dest).catch(async () => {
          const content = await Bun.file(target).arrayBuffer().catch(() => new ArrayBuffer(0))
          await Bun.write(dest, new Uint8Array(content))
          await fs.rm(target, { force: true }).catch(() => {})
        })
      })
      throw new NotFoundError({ message: `Resource not found: ${target}` })
    })
  }

  export async function update<T>(key: string[], fn: (draft: T) => void) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _ = await Lock.write(target)
      const content = await Bun.file(target).json()
      fn(content)
      await atomicWrite(target, JSON.stringify(content, null, 2))
      return content as T
    })
  }

  export async function write<T>(key: string[], content: T) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _ = await Lock.write(target)
      await atomicWrite(target, JSON.stringify(content, null, 2))
    })
  }

  async function withErrorHandling<T>(body: () => Promise<T>) {
    return body().catch((e) => {
      if (!(e instanceof Error)) throw e
      const errnoException = e as NodeJS.ErrnoException
      if (errnoException.code === "ENOENT") {
        const p = (errnoException as any).path as string | undefined
        if (!p || (!p.includes(".oc-") && !p.endsWith(".tmp"))) {
          throw new NotFoundError({ message: `Resource not found: ${errnoException.path}` })
        }
      }
      throw e
    })
  }

  const glob = new Bun.Glob("**/*")
  export async function list(prefix: string[]) {
    const dir = await state().then((x) => x.dir)
    try {
      const result = await Array.fromAsync(
        glob.scan({
          cwd: path.join(dir, ...prefix),
          onlyFiles: true,
        }),
      ).then((results) => results.map((x) => [...prefix, ...x.slice(0, -5).split(path.sep)]))
      result.sort()
      return result
    } catch {
      return []
    }
  }

  async function atomicWrite(target: string, data: string) {
    const dir = path.dirname(target)
    let lastErr: any
    for (let i = 0; i < 6; i++) {
      await fs.mkdir(dir, { recursive: true }).catch(() => {})
      const tmp = path.join(dir, `.oc-${path.basename(target)}.${process.pid}.${Date.now()}.${i}.tmp`)
      const fh = await fs.open(tmp, "w").catch((e) => {
        lastErr = e
        return null as any
      })
      if (!fh) {
        const code = (lastErr as any)?.code as string | undefined
        const transient = isTransientFsError(lastErr) || code === "ENOENT"
        if (!transient) break
        await delay(Math.min(1600, 50 * 2 ** i))
        continue
      }
      try {
        await fh.writeFile(data)
        const syncFn = (fh as any).sync as (() => Promise<void>) | undefined
        if (typeof syncFn === "function") {
          await (syncFn.call(fh) as Promise<void>).catch((err: any) => {
            if (!(process.platform === "win32" && (err as any)?.code === "EPERM")) throw err
          })
        } else {
          const fd = (fh as any).fd as number | undefined
          if (typeof fd === "number") {
            await new Promise<void>((resolve, reject) =>
              nodefs.fsync(fd, (err: any) => {
                if (err && process.platform === "win32" && (err as any)?.code === "EPERM") return resolve()
                if (err) return reject(err)
                resolve()
              }),
            )
          }
        }
      } finally {
        await fh.close().catch(() => {})
      }
      try {
        await fs.rename(tmp, target)
        if (process.platform !== "win32") {
          const dirFh = await fs.open(dir, "r").catch(() => null as any)
          try {
            const dirSync = (dirFh as any)?.sync as (() => Promise<void>) | undefined
            if (typeof dirSync === "function") await dirSync.call(dirFh)
            else {
              const dfd = (dirFh as any)?.fd as number | undefined
              if (typeof dfd === "number") {
                await new Promise<void>((resolve, reject) => nodefs.fsync(dfd, (err) => (err ? reject(err) : resolve())))
              }
            }
          } finally {
            await dirFh?.close?.().catch?.(() => {})
          }
        }
        return
      } catch (e) {
        lastErr = e
        await fs.rm(tmp, { force: true }).catch(() => {})
        const code = (e as any)?.code as string | undefined
        const transient = isTransientFsError(e) || code === "ENOENT"
        if (!transient) break
        await delay(Math.min(1600, 50 * 2 ** i))
      }
    }
    try {
      const root = await state().then((x) => x.dir)
      const rel = path.relative(root, target)
      const dest = path.join(root, "quarantine", String(Date.now()), rel)
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await Bun.write(dest, data)
    } catch {}
    throw lastErr
  }
}
