import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { lazy } from "../util/lazy"
import { Lock } from "../util/lock"
import { $ } from "bun"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { SQLiteStorage } from "./sqlite"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  // Re-export SQLite storage for direct access to optimized methods
  export const SQLite = SQLiteStorage

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
    // Migration 2: Populate SQLite from existing file-based storage
    // This runs incrementally, indexing sessions/messages for fast queries
    async (dir) => {
      log.info("migrating file storage to SQLite index")

      // Migrate sessions
      const sessionsDir = path.join(dir, "session")
      if (await fs.exists(sessionsDir)) {
        for await (const projectDir of new Bun.Glob("*").scan({
          cwd: sessionsDir,
          onlyFiles: false,
        })) {
          const projectPath = path.join(sessionsDir, projectDir)
          const stat = await fs.stat(projectPath).catch(() => null)
          if (!stat?.isDirectory()) continue

          for await (const sessionFile of new Bun.Glob("*.json").scan({
            cwd: projectPath,
            absolute: true,
          })) {
            try {
              const session = await Bun.file(sessionFile).json()
              if (session.id && session.projectID) {
                await SQLiteStorage.writeSession(session)
                log.info("migrated session to SQLite", { id: session.id })
              }
            } catch (e) {
              log.error("failed to migrate session", { file: sessionFile, error: e })
            }
          }
        }
      }

      // Migrate messages
      const messagesDir = path.join(dir, "message")
      if (await fs.exists(messagesDir)) {
        for await (const sessionDir of new Bun.Glob("*").scan({
          cwd: messagesDir,
          onlyFiles: false,
        })) {
          const sessionPath = path.join(messagesDir, sessionDir)
          const stat = await fs.stat(sessionPath).catch(() => null)
          if (!stat?.isDirectory()) continue

          for await (const messageFile of new Bun.Glob("*.json").scan({
            cwd: sessionPath,
            absolute: true,
          })) {
            try {
              const message = await Bun.file(messageFile).json()
              if (message.id && message.sessionID) {
                await SQLiteStorage.writeMessage(message)
              }
            } catch (e) {
              log.error("failed to migrate message", { file: messageFile, error: e })
            }
          }
        }
      }

      // Migrate parts
      const partsDir = path.join(dir, "part")
      if (await fs.exists(partsDir)) {
        for await (const messageDir of new Bun.Glob("*").scan({
          cwd: partsDir,
          onlyFiles: false,
        })) {
          const messagePath = path.join(partsDir, messageDir)
          const stat = await fs.stat(messagePath).catch(() => null)
          if (!stat?.isDirectory()) continue

          for await (const partFile of new Bun.Glob("*.json").scan({
            cwd: messagePath,
            absolute: true,
          })) {
            try {
              const part = await Bun.file(partFile).json()
              if (part.id && part.messageID) {
                await SQLiteStorage.writePart(part)
              }
            } catch (e) {
              log.error("failed to migrate part", { file: partFile, error: e })
            }
          }
        }
      }

      log.info("SQLite migration complete")
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
      await Bun.write(target, JSON.stringify(content, null, 2))
      return content as T
    })
  }

  export async function write<T>(key: string[], content: T) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _ = await Lock.write(target)
      await Bun.write(target, JSON.stringify(content, null, 2))
    })
  }

  async function withErrorHandling<T>(body: () => Promise<T>) {
    return body().catch((e) => {
      if (!(e instanceof Error)) throw e
      const errnoException = e as NodeJS.ErrnoException
      if (errnoException.code === "ENOENT") {
        throw new NotFoundError({ message: `Resource not found: ${errnoException.path}` })
      }
      throw e
    })
  }

  const glob = new Bun.Glob("**/*")

  /**
   * List keys matching a prefix.
   * Note: This loads all keys into memory. For large datasets, use listStream instead.
   */
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

  /**
   * Stream keys matching a prefix without loading all into memory.
   * This is memory-efficient for large datasets.
   */
  export async function* listStream(prefix: string[]): AsyncGenerator<string[]> {
    const dir = await state().then((x) => x.dir)
    const prefixPath = path.join(dir, ...prefix)

    try {
      for await (const file of glob.scan({
        cwd: prefixPath,
        onlyFiles: true,
      })) {
        yield [...prefix, ...file.slice(0, -5).split(path.sep)]
      }
    } catch {
      // Directory doesn't exist, yield nothing
    }
  }

  /**
   * Count items matching a prefix without loading them.
   * Uses SQLite for optimized counting when available.
   */
  export async function count(prefix: string[]): Promise<number> {
    // Use SQLite for session/message counts when available
    if (prefix[0] === "session" && prefix.length === 2) {
      return SQLiteStorage.countSessions(prefix[1])
    }
    if (prefix[0] === "message" && prefix.length === 2) {
      return SQLiteStorage.countMessages(prefix[1])
    }

    // Fallback to counting files
    const dir = await state().then((x) => x.dir)
    let count = 0
    try {
      for await (const _ of glob.scan({
        cwd: path.join(dir, ...prefix),
        onlyFiles: true,
      })) {
        count++
      }
    } catch {
      // Directory doesn't exist
    }
    return count
  }

  /**
   * Write a session with automatic SQLite indexing.
   */
  export async function writeSession<T extends { id: string; projectID: string; time: { created: number; updated: number; archived?: number }; title: string; directory: string; version: string; parentID?: string }>(
    key: string[],
    content: T,
  ) {
    // Write to file storage
    await write(key, content)
    // Index in SQLite for fast queries
    await SQLiteStorage.writeSession(content)
  }

  /**
   * Write a message with automatic SQLite indexing.
   */
  export async function writeMessage<T extends { id: string; sessionID: string; role: string; time: { created: number } }>(
    key: string[],
    content: T,
  ) {
    // Write to file storage
    await write(key, content)
    // Index in SQLite for fast queries
    await SQLiteStorage.writeMessage(content)
  }

  /**
   * Write a part with automatic SQLite indexing.
   */
  export async function writePart<T extends { id: string; messageID: string; type: string }>(key: string[], content: T) {
    // Write to file storage
    await write(key, content)
    // Index in SQLite for fast queries
    await SQLiteStorage.writePart(content)
  }

  /**
   * Remove a session with automatic SQLite cleanup.
   */
  export async function removeSession(key: string[], sessionId: string) {
    await remove(key)
    await SQLiteStorage.deleteSession(sessionId)
  }

  /**
   * Remove a message with automatic SQLite cleanup.
   */
  export async function removeMessage(key: string[], messageId: string) {
    await remove(key)
    await SQLiteStorage.deleteMessage(messageId)
  }

  /**
   * Remove a part with automatic SQLite cleanup.
   */
  export async function removePart(key: string[], partId: string) {
    await remove(key)
    await SQLiteStorage.deletePart(partId)
  }
}
