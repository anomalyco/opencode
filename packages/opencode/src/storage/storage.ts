import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { Lock } from "../util/lock"
import { $ } from "bun"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  type Migration = (dir: string) => Promise<void>

  const MIGRATIONS: Migration[] = [
    async (dir) => {
      const project = path.resolve(dir, "../project")
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
  ]

  /**
   * Get storage directory, respecting Instance context if available.
   * Tests run in Instance.provide() will get isolated storage.
   */
  function getStorageDir(): string {
    try {
      const { Instance } = require("../project/instance")
      const pending = Instance.pending
      if (pending) {
        return path.join(pending, ".opencode-storage")
      }
      const instanceDir = Instance.directory
      if (instanceDir) {
        return path.join(instanceDir, ".opencode-storage")
      }
    } catch {
      // Not in Instance context, use global storage
    }
    return path.join(Global.Path.data, "storage")
  }

  // Cache migrations per directory to avoid re-running
  const migrationCache = new Map<string, Promise<void>>()

  async function ensureMigrations(dir: string): Promise<void> {
    if (migrationCache.has(dir)) {
      return migrationCache.get(dir)!
    }

    const promise = (async () => {
      const migration = await Bun.file(path.join(dir, "migration"))
        .json()
        .then((x) => parseInt(x))
        .catch(() => 0)
      for (let index = migration; index < MIGRATIONS.length; index++) {
        log.info("running migration", { index, dir })
        const migration = MIGRATIONS[index]
        await migration(dir).catch((e) => {
          log.error("failed to run migration", { error: e, index, dir })
        })
        await Bun.write(path.join(dir, "migration"), (index + 1).toString())
      }
    })()

    migrationCache.set(dir, promise)
    return promise
  }

  async function getDir(): Promise<string> {
    const dir = getStorageDir()
    await ensureMigrations(dir)
    return dir
  }

  export async function remove(key: string[]) {
    const dir = await getDir()
    const target = path.join(dir, ...key) + ".json"
    await fs.unlink(target).catch(() => {})
  }

  export async function read<T>(key: string[]) {
    const dir = await getDir()
    const target = path.join(dir, ...key) + ".json"
    using _ = await Lock.read(target)
    return Bun.file(target).json() as Promise<T>
  }

  export async function update<T>(key: string[], fn: (draft: T) => void) {
    const dir = await getDir()
    const target = path.join(dir, ...key) + ".json"
    using _ = await Lock.write("storage")
    const content = await Bun.file(target).json()
    fn(content)
    await Bun.write(target, JSON.stringify(content, null, 2))
    return content as T
  }

  export async function write<T>(key: string[], content: T) {
    const dir = await getDir()
    const target = path.join(dir, ...key) + ".json"
    using _ = await Lock.write("storage")
    await fs.mkdir(path.dirname(target), { recursive: true }).catch(() => {})
    await Bun.write(target, JSON.stringify(content, null, 2))
  }

  const glob = new Bun.Glob("**/*")
  export async function list(prefix: string[]) {
    const dir = await getDir()
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
}
