import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import * as nodefs from "fs"
import { Global } from "../global"
import { lazy } from "../util/lazy"
import { Lock } from "../util/lock"
import { $ } from "bun"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  type Migration = (dir: string) => Promise<void>

  export const NotFoundError = NamedError.create(
    "NotFoundError",
    z.object({
      message: z.string(),
    }),
  )

  export const DiskFullError = NamedError.create(
    "DiskFullError",
    z.object({
      message: z.string(),
    }),
  )

  const MIGRATIONS: Migration[] = [
    async (dir) => {
      const project = path.resolve(dir, "../project")
      if (!fs.exists(project)) return
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
          if (!(await fs.exists(worktree))) continue
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
    await fs.mkdir(dir, { recursive: true }).catch(() => {})
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
      const result = await Bun.file(target).json()
      return result as T
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
        throw new NotFoundError({ message: `Resource not found: ${errnoException.path}` })
      }
      if (errnoException.code === "ENOSPC") {
        throw new DiskFullError({ message: `No space left on device while writing storage: ${errnoException.path}` })
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
      ).then((results) => (results as string[]).map((x) => [...prefix, ...x.slice(0, -5).split(path.sep)]))
      result.sort()
      return result
    } catch {
      return []
    }
  }

  async function atomicWrite(target: string, data: string) {
    const dir = path.dirname(target)
    await fs.mkdir(dir, { recursive: true })
    const tmp = path.join(
      dir,
      `.oc-${path.basename(target)}.${process.pid}.${Date.now()}.tmp`,
    )
    const fh = await fs.open(tmp, "w")
    try {
      await fh.writeFile(data)
      const syncFn = (fh as any).sync as (() => Promise<void>) | undefined
      if (typeof syncFn === "function") {
        await syncFn.call(fh)
      } else {
        const fd = (fh as any).fd as number | undefined
        if (typeof fd === "number") {
          await new Promise<void>((resolve, reject) => nodefs.fsync(fd, (err) => (err ? reject(err) : resolve())))
        }
      }
    } finally {
      await fh.close().catch(() => {})
    }
    try {
      await fs.rename(tmp, target)
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
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw e
    }
  }

  export async function repair(options?: {
    dryRun?: boolean
    prefix?: string[]
    maxFiles?: number
    maxMiB?: number
    reportPath?: string
  }) {
    const dir = await state().then((x) => x.dir)
    const ts = Date.now()
    const quarantineRoot = path.join(dir, "quarantine", String(ts))
    const dryRun = !!options?.dryRun
    const base = options?.prefix?.length ? path.join(dir, ...options.prefix) : dir
    const maxFiles = options?.maxFiles && options.maxFiles > 0 ? options.maxFiles : Infinity
    const maxBytes = options?.maxMiB && options.maxMiB > 0 ? Math.floor(options.maxMiB * 1024 * 1024) : Infinity

    let quarantined = 0
    let tempRemoved = 0
    let skippedLocked = 0
    let processedFiles = 0
    let processedBytes = 0
    const report: { action: string; from: string; to?: string; reason?: string }[] = []

    if (!dryRun) await fs.mkdir(quarantineRoot, { recursive: true }).catch(() => {})

    for await (const file of new Bun.Glob("**/*.json").scan({ cwd: base, absolute: true })) {
      if (processedFiles >= maxFiles || processedBytes >= maxBytes) break
      const stat = await fs.stat(file).catch(() => null as any)
      const size = stat?.size ?? 0
      if (processedBytes + size > maxBytes) break
      processedFiles++
      processedBytes += size
      try {
        await Bun.file(file).json()
      } catch {
        const lock = Lock.tryWrite(file)
        if (!lock) {
          skippedLocked++
          report.push({ action: "skip", from: file, reason: "locked" })
          continue
        }
        try {
          const rel = path.relative(dir, file)
          const dest = path.join(quarantineRoot, rel)
          report.push({ action: dryRun ? "would-move" : "move", from: file, to: dest, reason: "invalid-json" })
          if (!dryRun) {
            await fs.mkdir(path.dirname(dest), { recursive: true })
            await fs.rename(file, dest).catch(async () => {
              const content = await Bun.file(file).arrayBuffer().catch(() => new ArrayBuffer(0))
              await Bun.write(dest, new Uint8Array(content))
              await fs.rm(file, { force: true }).catch(() => {})
            })
          }
          quarantined++
        } finally {
          ;(lock as any)?.[Symbol.dispose]?.()
        }
      }
    }

    const walk = async function* (p: string): AsyncGenerator<string> {
      const s = await fs.stat(p).catch(() => null as any)
      if (!s) return
      if (s.isDirectory()) {
        for (const entry of await fs.readdir(p).catch(() => [] as string[])) {
          yield* walk(path.join(p, entry))
        }
        return
      }
      yield p
    }

    for await (const file of walk(base)) {
      const baseName = path.basename(file)
      if (baseName.startsWith(".oc-") && baseName.endsWith(".tmp")) {
        report.push({ action: dryRun ? "would-remove" : "remove", from: file, reason: "leftover-temp" })
        if (!dryRun) await fs.rm(file, { force: true }).catch(() => {})
        tempRemoved++
      }
    }

    const finalReportPath = options?.reportPath || path.join(quarantineRoot, "repair-report.json")
    await fs.mkdir(path.dirname(finalReportPath), { recursive: true }).catch(() => {})
    await Bun.write(
      finalReportPath,
      JSON.stringify(
        {
          time: ts,
          base,
          quarantined,
          tempRemoved,
          skippedLocked,
          processedFiles,
          processedBytes,
          entries: report,
        },
        null,
        2,
      ),
    )

    log.info("storage.repair complete", { quarantined, tempRemoved, skippedLocked })
    return { quarantined, tempRemoved, skippedLocked, quarantineRoot, reportPath: finalReportPath }
  }

  export async function restore(input: { path: string; dryRun?: boolean }) {
    const dir = await state().then((x) => x.dir)
    const abs = path.resolve(input.path)
    const parts = abs.split(path.sep)
    const qIndex = parts.lastIndexOf("quarantine")
    if (qIndex < 0 || qIndex + 1 >= parts.length) return { restored: 0, skippedLocked: 0 }
    const qRoot = parts.slice(0, qIndex + 2).join(path.sep)
    const restoredFiles: string[] = []
    let restored = 0
    let skippedLocked = 0

    const walker = async function* (p: string): AsyncGenerator<string> {
      const s = await fs.stat(p)
      if (s.isDirectory()) {
        for await (const item of await fs.readdir(p)) yield* walker(path.join(p, item))
        return
      }
      yield p
    }

    for await (const src of walker(abs)) {
      const rel = path.relative(qRoot, src)
      if (rel.startsWith("..")) continue
      const dest = path.join(dir, rel)
      const lock = Lock.tryWrite(dest)
      if (!lock) {
        skippedLocked++
        continue
      }
      try {
        await fs.mkdir(path.dirname(dest), { recursive: true })
        if (!input.dryRun) await fs.rename(src, dest).catch(async () => {
          const content = await Bun.file(src).arrayBuffer().catch(() => new ArrayBuffer(0))
          await Bun.write(dest, new Uint8Array(content))
          await fs.rm(src, { force: true }).catch(() => {})
        })
        restored++
        restoredFiles.push(dest)
      } finally {
        ;(lock as any)?.[Symbol.dispose]?.()
      }
    }

    log.info("storage.restore complete", { restored, skippedLocked })
    return { restored, skippedLocked, files: restoredFiles }
  }
}
