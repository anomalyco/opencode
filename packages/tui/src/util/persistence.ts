import path from "path"
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "fs/promises"

export function readText(filePath: string) {
  return readFile(filePath, "utf8")
}

export async function readJson<T>(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as T
}

// Written to a temporary file and renamed into place, so a reader sees the old or the new content, never part of it.
export function writeText(filePath: string, content: string) {
  return serialized(filePath, async () => {
    await mkdir(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
    await writeFile(temporary, content).catch(async (error) => {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    })
    await rename(temporary, filePath).catch(async (error) => {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    })
  })
}

export function appendText(filePath: string, content: string) {
  return serialized(filePath, async () => {
    await mkdir(path.dirname(filePath), { recursive: true })
    await appendFile(filePath, content)
  })
}

export async function writeJsonAtomic(filePath: string, value: unknown) {
  await writeText(filePath, JSON.stringify(value))
}

const writes = new Map<string, Promise<void>>()

// Writes to one file run one at a time, in call order. An append made during a rewrite would otherwise go to the file
// the rename replaces, and be lost.
function serialized(filePath: string, write: () => Promise<void>) {
  const key = path.resolve(filePath)
  const result = (writes.get(key) ?? Promise.resolve()).then(write)
  const tail = result.catch(() => undefined)
  writes.set(key, tail)
  void tail.then(() => {
    if (writes.get(key) === tail) writes.delete(key)
  })
  return result
}
