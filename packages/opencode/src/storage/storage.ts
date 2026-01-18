import { Log } from "../util/log"
import path from "path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { lazy } from "../util/lazy"
import { $ } from "bun"
import { StorageProvider } from "./provider"
import { JsonStorageProvider } from "./json-provider"
import { SqliteStorageProvider, SqliteConfigSchema } from "./sqlite-provider"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  type Migration = (dir: string) => Promise<void>

  // Re-export NotFoundError from provider
  export const NotFoundError = StorageProvider.NotFoundError

  // Provider instance
  let provider: StorageProvider.Interface | null = null

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

  /**
   * Initialize storage provider based on config
   */
  export async function init() {
    // Load config directly from file to avoid circular dependency with Config.state()
    // which depends on Instance which depends on Storage
    const { Global } = await import("../global")
    const configPath = path.join(Global.Path.config, "opencode.json")

    let config: any = {}
    if (await Bun.file(configPath).exists()) {
      config = await Bun.file(configPath).json()
    }

    const backend = config.storage?.backend || "json"

    if (backend === "sqlite") {
      log.info("Initializing SQLite storage backend")

      // Load sqlite config
      const sqliteConfigPath = config.storage?.sqlite?.config || path.join(Global.Path.config, "sqlite-storage.json")

      let sqliteConfig: any
      if (await Bun.file(sqliteConfigPath).exists()) {
        const json = await Bun.file(sqliteConfigPath).json()
        sqliteConfig = SqliteConfigSchema.parse(json)
      } else {
        // Use default database path from config or default with minimal schema
        sqliteConfig = {
          database: config.storage?.sqlite?.database || path.join(Global.Path.data, "storage.db"),
          tables: {
            message: {
              columns: {
                id: "TEXT PRIMARY KEY",
                sessionID: "TEXT",
                role: "TEXT",
                "time.created": "INTEGER",
                data: "TEXT",
              },
              extract: ["sessionID", "role", "time.created"],
              indices: ["sessionID", "time.created"],
            },
            part: {
              columns: { id: "TEXT PRIMARY KEY", messageID: "TEXT", type: "TEXT", data: "TEXT" },
              extract: ["messageID", "type"],
              indices: ["messageID"],
            },
            session: {
              columns: {
                id: "TEXT PRIMARY KEY",
                projectID: "TEXT",
                title: "TEXT",
                "time.created": "INTEGER",
                "time.updated": "INTEGER",
                data: "TEXT",
              },
              extract: ["projectID", "title", "time.updated"],
              indices: ["projectID", "time.updated"],
            },
            project: {
              columns: {
                id: "TEXT PRIMARY KEY",
                worktree: "TEXT",
                vcs: "TEXT",
                "time.created": "INTEGER",
                "time.updated": "INTEGER",
                data: "TEXT",
              },
              extract: ["worktree", "vcs", "time.created", "time.updated"],
              indices: ["worktree", "time.created", "time.updated"],
            },
            todo: {
              columns: { id: "TEXT PRIMARY KEY", sessionID: "TEXT", data: "TEXT" },
              extract: ["sessionID"],
              indices: ["sessionID"],
            },
            session_diff: {
              columns: { id: "TEXT PRIMARY KEY", data: "TEXT" },
              extract: [],
              indices: [],
            },
            session_share: {
              columns: { id: "TEXT PRIMARY KEY", secret: "TEXT", url: "TEXT", data: "TEXT" },
              extract: ["secret", "url"],
              indices: [],
            },
          },
        }
        log.warn("No SQLite config found, using minimal schema", {
          path: sqliteConfigPath,
          database: sqliteConfig.database,
        })
      }

      const dbPath = sqliteConfig.database.replace(/^~/, Global.Path.home)
      const resolvedDbPath = path.resolve(dbPath)

      provider = new SqliteStorageProvider(resolvedDbPath, sqliteConfig)
      log.info("SQLite storage provider initialized", { dbPath: resolvedDbPath })
    } else {
      log.info("Using default JSON storage backend")
      // Initialize JSON provider immediately
      const { dir } = await state()
      provider = new JsonStorageProvider(dir)
      log.info("JSON storage provider initialized", { dir })
    }
  }

  /**
   * Set the storage provider (JsonStorageProvider or SqliteStorageProvider)
   */
  export function setProvider(p: StorageProvider.Interface) {
    provider = p
    log.info("Storage provider set", { provider: p.constructor.name })
  }

  /**
   * Get the current storage provider, initializing with JsonStorageProvider if needed
   */
  async function getProvider(): Promise<StorageProvider.Interface> {
    if (!provider) {
      throw new Error("Storage provider not initialized. Call Storage.init() first.")
    }
    return provider
  }

  export async function remove(key: string[]) {
    const p = await getProvider()
    return p.remove(key)
  }

  export async function read<T>(key: string[]) {
    const p = await getProvider()
    return p.read<T>(key)
  }

  export async function update<T>(key: string[], fn: (draft: T) => void) {
    const p = await getProvider()
    return p.update<T>(key, fn)
  }

  export async function write<T>(key: string[], content: T) {
    const p = await getProvider()
    return p.write<T>(key, content)
  }

  export async function list(prefix: string[], options?: StorageProvider.ListOptions) {
    const p = await getProvider()
    return p.list(prefix, options)
  }
}
