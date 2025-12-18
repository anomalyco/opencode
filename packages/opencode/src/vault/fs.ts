import fs from "fs/promises"
import path from "path"

export namespace VaultFS {
  export async function ensureDir(dir: string) {
    await fs.mkdir(dir, { recursive: true })
  }

  export async function exists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath)
      return true
    } catch {
      return false
    }
  }

  export async function readJson<T = unknown>(filePath: string): Promise<T | undefined> {
    try {
      const text = await fs.readFile(filePath, "utf8")
      return JSON.parse(text) as T
    } catch {
      return undefined
    }
  }

  export async function atomicWriteJson(filePath: string, value: unknown, mode: number = 0o600): Promise<void> {
    await atomicWriteText(filePath, JSON.stringify(value, null, 2), mode)
  }

  export async function atomicWriteText(filePath: string, text: string, mode: number = 0o600): Promise<void> {
    const dir = path.dirname(filePath)
    await ensureDir(dir)

    const tmpPath = `${filePath}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`

    const handle = await fs.open(tmpPath, "w", mode)
    try {
      await handle.writeFile(text, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }

    await fs.rename(tmpPath, filePath)
    await fs.chmod(filePath, mode)
  }
}

