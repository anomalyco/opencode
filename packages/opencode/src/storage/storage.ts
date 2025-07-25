import { Log } from "../util/log"
import { App } from "../app/app"
import { Bus } from "../bus"
import path from "path"
import z from "zod"
import fs from "fs/promises"
import { StreamHandler } from "./stream-handler"
import { MigrationManager } from "./migration-manager"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  export const Event = {
    Write: Bus.event("storage.write", z.object({ key: z.string(), content: z.any() })),
  }

  const streamHandler = new StreamHandler.JsonStreamHandler()
  const atomicWriter = new StreamHandler.AtomicFileWriter(streamHandler)
  const migrationManager = new MigrationManager.Manager()

  // Register default migrations and new mode migration
  MigrationManager.defaultMigrations.forEach(m => migrationManager.register(m))
  
  // Add the new mode migration
  migrationManager.register(async (dir: string) => {
    const files = new Bun.Glob("session/message/*/*.json").scanSync({
      cwd: dir,
      absolute: true,
    })
    for (const file of files) {
      try {
        const content = await Bun.file(file).json()
        if (content.role === "assistant" && !content.mode) {
          log.info("adding mode field to message", { file })
          content.mode = "build"
          await Bun.write(file, JSON.stringify(content, null, 2))
        }
      } catch (e) {}
    }
  })

  const state = App.state("storage", async () => {
    const app = App.info()
    const dir = path.normalize(path.join(app.path.data, "storage"))
    await fs.mkdir(dir, { recursive: true })
    
    // Run migrations
    await migrationManager.runMigrations(dir)
    
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

  export async function readJSON<T>(key: string): Promise<T> {
    const dir = await state().then((x) => x.dir)
    const filePath = path.join(dir, key + ".json")
    return streamHandler.read<T>(filePath)
  }

  export async function writeJSON<T>(key: string, content: T) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, key + ".json")
    
    await atomicWriter.write(target, content)
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
