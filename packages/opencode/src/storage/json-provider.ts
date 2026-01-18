import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Lock } from "../util/lock"
import { StorageProvider } from "./provider"

const log = Log.create({ service: "storage:json" })

export class JsonStorageProvider implements StorageProvider.Interface {
  constructor(private dir: string) {}

  async read<T>(key: string[]): Promise<T> {
    const target = path.join(this.dir, ...key) + ".json"
    return this.withErrorHandling(async () => {
      using _ = await Lock.read(target)
      const result = await Bun.file(target).json()
      return result as T
    })
  }

  async write<T>(key: string[], content: T): Promise<void> {
    const target = path.join(this.dir, ...key) + ".json"
    return this.withErrorHandling(async () => {
      using _ = await Lock.write(target)
      await Bun.write(target, JSON.stringify(content, null, 2))
    })
  }

  async update<T>(key: string[], fn: (draft: T) => void): Promise<T> {
    const target = path.join(this.dir, ...key) + ".json"
    return this.withErrorHandling(async () => {
      using _ = await Lock.write(target)
      const content = await Bun.file(target).json()
      fn(content)
      await Bun.write(target, JSON.stringify(content, null, 2))
      return content as T
    })
  }

  async remove(key: string[]): Promise<void> {
    const target = path.join(this.dir, ...key) + ".json"
    return this.withErrorHandling(async () => {
      await fs.unlink(target).catch(() => {})
    })
  }

  async list(prefix: string[], options?: StorageProvider.ListOptions): Promise<string[][]> {
    const glob = new Bun.Glob("**/*")
    try {
      const result = await Array.fromAsync(
        glob.scan({
          cwd: path.join(this.dir, ...prefix),
          onlyFiles: true,
        }),
      ).then((results) => results.map((x) => [...prefix, ...x.slice(0, -5).split(path.sep)]))
      result.sort()

      // Apply orderBy if specified (requires reading data)
      if (options?.orderBy) {
        const { field, desc } = this.parseOrderBy(options.orderBy)
        const withData = await Promise.all(
          result.map(async (key) => ({
            key,
            data: await this.read(key),
          })),
        )
        withData.sort((a, b) => {
          const aVal = this.getNestedValue(a.data, field)
          const bVal = this.getNestedValue(b.data, field)
          const cmp = aVal > bVal ? 1 : aVal < bVal ? -1 : 0
          return desc ? -cmp : cmp
        })
        const sorted = withData.map((x) => x.key)
        return options.limit ? sorted.slice(0, options.limit) : sorted
      }

      // Apply limit without orderBy
      return options?.limit ? result.slice(0, options.limit) : result
    } catch {
      return []
    }
  }

  private parseOrderBy(orderBy: string): { field: string; desc: boolean } {
    const desc = orderBy.startsWith("-")
    const field = desc ? orderBy.slice(1) : orderBy
    return { field, desc }
  }

  private getNestedValue(obj: any, path: string): any {
    const parts = path.split(".")
    let current = obj
    for (const part of parts) {
      if (current === undefined || current === null) return undefined
      current = current[part]
    }
    return current
  }

  private async withErrorHandling<T>(body: () => Promise<T>): Promise<T> {
    return body().catch((e) => {
      if (!(e instanceof Error)) throw e
      const errnoException = e as NodeJS.ErrnoException
      if (errnoException.code === "ENOENT") {
        throw new StorageProvider.NotFoundError({ message: `Resource not found: ${errnoException.path}` })
      }
      throw e
    })
  }
}
