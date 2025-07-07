import { Log } from "../util/log"
import { App } from "../app/app"
import { Bus } from "../bus"
import path from "path"
import z from "zod"
import fs from "fs/promises"
import { MessageV2 } from "../session/message-v2"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  export const Event = {
    Write: Bus.event("storage.write", z.object({ key: z.string(), content: z.any() })),
  }

  type Migration = (dir: string) => Promise<void>

  const MIGRATIONS: Migration[] = [
    async (dir: string) => {
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
          await Bun.write(file, JSON.stringify(result, null, 2))
        } catch (e) {
          await fs.rename(file, file.replace("storage", "broken"))
        }
      }
    },
  ]

  const state = App.state("storage", async () => {
    const app = App.info()
    const dir = path.join(app.path.data, "storage")
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
  export async function* list(prefix: string) {
    const dir = await state().then((x) => x.dir)
    try {
      for await (const item of glob.scan({
        cwd: path.join(dir, prefix),
        onlyFiles: true,
      })) {
        const result = path.join(prefix, item.slice(0, -5))
        yield result
      }
    } catch {
      return
    }
  }
}
