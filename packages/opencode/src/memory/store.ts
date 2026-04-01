import { Storage } from "../storage/storage"
import { Memory } from "./memory"

export namespace MemoryStore {
  function key(id: string, projectID: string): string[] {
    return ["memory", projectID, id]
  }

  export async function save(entry: Memory.Entry): Promise<void> {
    await Storage.write(key(entry.id, entry.projectID), entry)
  }

  export async function get(id: string, projectID: string): Promise<Memory.Entry | null> {
    try {
      return await Storage.read<Memory.Entry>(key(id, projectID))
    } catch (e) {
      if (!(e instanceof Error)) throw e
      const error = e as Error & { name?: string }
      if (error.name === "NotFoundError") return null
      throw e
    }
  }

  export async function list(projectID: string): Promise<Memory.Entry[]> {
    const keys = await Storage.list(["memory", projectID])
    const entries = await Promise.all(keys.map((k) => Storage.read<Memory.Entry>(k)))
    return entries.filter((e): e is Memory.Entry => e !== null)
  }

  export async function search(query: string, projectID: string, limit: number = 10): Promise<Memory.Entry[]> {
    const allMemories = await list(projectID)
    return Memory.search(allMemories, query, limit)
  }

  export async function remove(id: string, projectID: string): Promise<void> {
    const entry = await get(id, projectID)
    if (!entry) return
    await Storage.remove(key(id, projectID))
  }

  export async function touch(id: string, projectID: string): Promise<void> {
    const entry = await get(id, projectID)
    if (!entry) return

    entry.time.accessed = Date.now()
    entry.accessCount++
    await save(entry)
  }

  export async function getRecentForPrompt(projectID: string, limit: number = 5): Promise<string[]> {
    const allMemories = await list(projectID)
    const sorted = allMemories.sort((a, b) => b.time.accessed - a.time.accessed)
    const recent = sorted.slice(0, limit)
    return recent.map((m) => `[Memory: ${m.content} (tags: ${m.tags.join(", ")})]`)
  }
}
