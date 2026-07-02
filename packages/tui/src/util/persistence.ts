import path from "path"
import { appendFile, mkdir, readdir, rename, rm } from "fs/promises"

export function readText(filePath: string) {
  return Bun.file(filePath).text()
}

export function readJson<T>(filePath: string) {
  return Bun.file(filePath).json() as Promise<T>
}

export async function writeText(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await Bun.write(filePath, content)
}

export async function appendText(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, content)
}

async function cleanStaleTempFiles(dir: string, targetName: string) {
  try {
    const entries = await readdir(dir)
    const pattern = `${targetName}.`
    for (const entry of entries) {
      if (entry.startsWith(pattern) && entry.endsWith(".tmp")) {
        await rm(path.join(dir, entry), { force: true }).catch(() => {})
      }
    }
  } catch {
    // directory doesn't exist yet — nothing to clean
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await cleanStaleTempFiles(path.dirname(filePath), path.basename(filePath))
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  await Bun.write(temporary, JSON.stringify(value)).catch(async (error) => {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
  await rename(temporary, filePath).catch(async (error) => {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
}
