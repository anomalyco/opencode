import { Log } from "../util/log"
import { App } from "../app/app"
import { Bus } from "../bus"
import path from "path"
import z from "zod"
import fs from "fs/promises"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  export const Event = {
    Write: Bus.event("storage.write", z.object({ key: z.string(), content: z.any() })),
  }

  type Migration = (dir: string) => Promise<void>

  const MIGRATIONS: Migration[] = [
    async (dir: string) => {
      try {
        const files = new Bun.Glob("session/message/*/*.json").scanSync({
          cwd: dir,
          absolute: true,
        })
        for (const file of files) {
          const content = await Bun.file(file).json()
          if (!content.metadata) continue
          log.info("migrating to v2 message", { file })
          try {
            const result = MessageV2.fromV1(content)
            await Bun.write(
              file,
              JSON.stringify(
                {
                  ...result.info,
                  parts: result.parts,
                },
                null,
                2,
              ),
            )
          } catch (e) {
            await fs.rename(file, file.replace("storage", "broken"))
          }
        }
      } catch {}
    },
    async (dir: string) => {
      const files = new Bun.Glob("session/message/*/*.json").scanSync({
        cwd: dir,
        absolute: true,
      })
      for (const file of files) {
        try {
          const { parts, ...info } = await Bun.file(file).json()
          if (!parts) continue
          for (const part of parts) {
            const id = Identifier.ascending("part")
            await Bun.write(
              [dir, "session", "part", info.sessionID, info.id, id + ".json"].join("/"),
              JSON.stringify({
                ...part,
                id,
                sessionID: info.sessionID,
                messageID: info.id,
                ...(part.type === "tool" ? { callID: part.id } : {}),
              }),
            )
          }
          await Bun.write(file, JSON.stringify(info, null, 2))
        } catch (e) {}
      }
    },
  ]

  const state = App.state("storage", async () => {
    const app = App.info()
    const dir = path.normalize(path.join(app.path.data, "storage"))
    await fs.mkdir(dir, { recursive: true })
    const migration = await Bun.file(path.join(dir, "migration"))
      .json()
      .then((x) => parseInt(x))
      .catch(() => 0)
    for (let index = migration; index < MIGRATIONS.length; index++) {
      log.info("running migration", { index })
      const migration = MIGRATIONS[index]
      await migration(dir)
      await Bun.write(path.join(dir, "migration"), (index + 1).toString())
    }
    return {
      dir,
    }
  })

  export async function remove(key: string) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, key + ".json")
    await fs.unlink(target).catch(() => {})
  }

  export async function removeDir(key: string) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, key)
    await fs.rm(target, { recursive: true, force: true }).catch(() => {})
  }

  export async function readJSON<T>(key: string) {
    const dir = await state().then((x) => x.dir)
    return Bun.file(path.join(dir, key + ".json")).json() as Promise<T>
  }

  export async function writeJSON<T>(key: string, content: T) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, key + ".json")
    const tmp = target + Date.now() + ".tmp"
    await Bun.write(tmp, JSON.stringify(content, null, 2))
    await fs.rename(tmp, target).catch(() => {})
    await fs.unlink(tmp).catch(() => {})
    Bus.publish(Event.Write, { key, content })
  }

  const glob = new Bun.Glob("**/*")
  export async function list(prefix: string) {
    const dir = await state().then((x) => x.dir)
    try {
      const result = await Array.fromAsync(
        glob.scan({
          cwd: path.join(dir, prefix),
          onlyFiles: true,
        }),
      ).then((items) => items.map((item) => path.join(prefix, item.slice(0, -5))))
      result.sort()
      return result
    } catch {
      return []
    }
  }
}
