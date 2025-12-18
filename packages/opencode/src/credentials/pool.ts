import path from "path"
import { Global } from "@/global"
import { VaultFS } from "@/vault/fs"
import { VaultLock } from "@/vault/lock"

export namespace CredentialPool {
  const ROOT = path.join(Global.Path.data, "credentials")
  const POOLS_DIR = path.join(ROOT, "pools")
  const LOCK_PATH = path.join(ROOT, ".lock")

  function poolPath(providerId: string, namespace: string) {
    const safeProvider = encodeURIComponent(providerId)
    const safeNamespace = encodeURIComponent(namespace)
    return path.join(POOLS_DIR, safeProvider, `${safeNamespace}.json`)
  }

  async function loadIds(filePath: string): Promise<string[] | undefined> {
    const json = await VaultFS.readJson<unknown>(filePath)
    if (!Array.isArray(json)) return undefined
    return json.filter((x) => typeof x === "string") as string[]
  }

  export async function getOrderedIds(providerId: string, namespace: string, eligibleIds: string[]): Promise<string[]> {
    const filePath = poolPath(providerId, namespace)
    const eligible = new Set(eligibleIds)

    return VaultLock.withLock(LOCK_PATH, async () => {
      await VaultFS.ensureDir(path.dirname(filePath))
      const current = (await loadIds(filePath)) ?? []

      const next: string[] = []
      for (const id of current) {
        if (eligible.has(id)) next.push(id)
      }
      for (const id of eligibleIds) {
        if (!next.includes(id)) next.push(id)
      }

      await VaultFS.atomicWriteJson(filePath, next, 0o600)
      return next
    })
  }

  export async function moveToBack(providerId: string, namespace: string, id: string): Promise<void> {
    const filePath = poolPath(providerId, namespace)
    await VaultLock.withLock(LOCK_PATH, async () => {
      await VaultFS.ensureDir(path.dirname(filePath))
      const current = (await loadIds(filePath)) ?? []
      const filtered = current.filter((x) => x !== id)
      filtered.push(id)
      await VaultFS.atomicWriteJson(filePath, filtered, 0o600)
    })
  }
}

