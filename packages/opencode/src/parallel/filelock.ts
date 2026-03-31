import { Log } from "@/util/log"

export namespace FileLock {
  const log = Log.create({ service: "filelock" })
  const locks = new Map<string, string>()

  export function acquire(filePath: string, workerID: string): boolean {
    const normalized = normalize(filePath)
    const current = locks.get(normalized)
    if (current && current !== workerID) {
      log.warn("file lock contention", { file: normalized, owner: current, requester: workerID })
      return false
    }
    locks.set(normalized, workerID)
    return true
  }

  export function release(filePath: string, workerID: string): void {
    const normalized = normalize(filePath)
    const current = locks.get(normalized)
    if (current === workerID) {
      locks.delete(normalized)
    }
  }

  export function releaseAll(workerID: string): void {
    for (const [file, owner] of locks) {
      if (owner === workerID) locks.delete(file)
    }
  }

  export function isLocked(filePath: string): boolean {
    return locks.has(normalize(filePath))
  }

  export function owner(filePath: string): string | undefined {
    return locks.get(normalize(filePath))
  }

  function normalize(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "")
  }
}
